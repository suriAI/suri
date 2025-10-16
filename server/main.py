"""
FastAPI Backend for Face Detection Pipeline
Supports YuNet, SCRFD, anti-spoof, and alignment models
"""

import asyncio
import base64
import io
import json
import logging
from typing import Dict, List, Optional, Union
import uuid
import time

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from models.yunet_detector import YuNet
from models.antispoof_detector import AntiSpoof
from models.edgeface_detector import EdgeFaceDetector
from models.deep_sort_tracker import DeepSortFaceTracker
from utils.image_utils import decode_base64_image, encode_image_to_base64
from utils.websocket_manager import manager, handle_websocket_message
from utils.attendance_database import AttendanceDatabaseManager
from routes import attendance
from config import YUNET_MODEL_PATH, YUNET_CONFIG, ANTISPOOFING_CONFIG, EDGEFACE_MODEL_PATH, EDGEFACE_CONFIG, MODEL_CONFIGS, CORS_CONFIG, DEEP_SORT_CONFIG, DATA_DIR

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Face Detection API",
    description="High-performance async face detection pipeline with YuNet, SCRFD, anti-spoof, and alignment",
    version="1.0.0"
)

# Configure CORS - Use configuration from config.py
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_CONFIG["allow_origins"],
    allow_credentials=CORS_CONFIG["allow_credentials"],
    allow_methods=CORS_CONFIG["allow_methods"],
    allow_headers=CORS_CONFIG["allow_headers"],
    expose_headers=CORS_CONFIG.get("expose_headers", []),
)

# WebSocket manager is imported as 'manager' from utils.websocket_manager

# Initialize models
yunet_detector = None
optimized_antispoofing_detector = None
edgeface_detector = None
face_tracker = None

# Initialize attendance database
attendance_database = None

# Include attendance routes
app.include_router(attendance.router)

# Pydantic models for request/response
class DetectionRequest(BaseModel):
    image: str  # Base64 encoded image
    model_type: str = "yunet"
    confidence_threshold: float = 0.6
    nms_threshold: float = 0.3
    enable_antispoofing: bool = True

class DetectionResponse(BaseModel):
    success: bool
    faces: List[Dict]
    processing_time: float
    model_used: str

class StreamingRequest(BaseModel):
    session_id: str
    model_type: str = "yunet"
    confidence_threshold: float = 0.6
    nms_threshold: float = 0.3
    enable_antispoofing: bool = True

class FaceRecognitionRequest(BaseModel):
    image: str  # Base64 encoded image
    bbox: List[float]  # Face bounding box [x, y, width, height]

class FaceRegistrationRequest(BaseModel):
    person_id: str
    image: str  # Base64 encoded image
    bbox: List[float]  # Face bounding box [x, y, width, height]

class FaceRecognitionResponse(BaseModel):
    success: bool
    person_id: Optional[str] = None
    similarity: float
    processing_time: float
    error: Optional[str] = None

class FaceRegistrationResponse(BaseModel):
    success: bool
    person_id: str
    total_persons: int
    processing_time: float
    error: Optional[str] = None

class PersonRemovalRequest(BaseModel):
    person_id: str

class SimilarityThresholdRequest(BaseModel):
    threshold: float

class PersonUpdateRequest(BaseModel):
    old_person_id: str
    new_person_id: str

@app.on_event("startup")
async def startup_event():
    """Initialize models on startup"""
    global yunet_detector, optimized_antispoofing_detector, edgeface_detector, face_tracker, attendance_database
    try:
        yunet_detector = YuNet(
            model_path=str(YUNET_MODEL_PATH),
            input_size=tuple(YUNET_CONFIG["input_size"]),
            conf_threshold=YUNET_CONFIG["score_threshold"],
            nms_threshold=YUNET_CONFIG["nms_threshold"],
            top_k=YUNET_CONFIG["top_k"]
        )
        
        optimized_antispoofing_detector = AntiSpoof(
            model_path=str(ANTISPOOFING_CONFIG["model_path"]),
            model_img_size=ANTISPOOFING_CONFIG.get("model_img_size", 128),
            live_threshold=ANTISPOOFING_CONFIG.get("live_threshold", 0.3)
        )
        
        # Initialize EdgeFace detector (uses FaceMesh for high-precision alignment)
        edgeface_detector = EdgeFaceDetector(
            model_path=str(EDGEFACE_MODEL_PATH),
            input_size=EDGEFACE_CONFIG["input_size"],
            similarity_threshold=EDGEFACE_CONFIG["similarity_threshold"],
            providers=EDGEFACE_CONFIG["providers"],
            database_path=str(EDGEFACE_CONFIG["database_path"]),
            session_options=EDGEFACE_CONFIG.get("session_options"),
            # Enable FaceMesh alignment for better precision
            facemesh_alignment=EDGEFACE_CONFIG.get("facemesh_alignment", True),
            facemesh_model_path=str(MODEL_CONFIGS["facemesh"]["model_path"]),
            facemesh_config=MODEL_CONFIGS["facemesh"]
        )
        
        # Initialize Deep SORT face tracker (appearance + motion features)
        logger.info("Initializing Deep SORT tracker with appearance features")
        face_tracker = DeepSortFaceTracker(
            max_age=DEEP_SORT_CONFIG.get("max_age", 30),
            n_init=DEEP_SORT_CONFIG.get("n_init", 3),
            max_iou_distance=DEEP_SORT_CONFIG.get("max_iou_distance", 0.7),
            max_cosine_distance=DEEP_SORT_CONFIG.get("max_cosine_distance", 0.3),
            nn_budget=DEEP_SORT_CONFIG.get("nn_budget", 100)
        )
        logger.info("Deep SORT tracker initialized successfully")
        
        # Initialize attendance database (auto-handles dev/prod paths)
        attendance_database = AttendanceDatabaseManager(str(DATA_DIR / "attendance.db"))
        
        # Set the database instance and models in the attendance routes module
        attendance.attendance_db = attendance_database
        attendance.yunet_detector = yunet_detector
        attendance.edgeface_detector = edgeface_detector
        
    except Exception as e:
        logger.error(f"Failed to initialize models: {e}")
        raise

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    logger.info("🛑 Shutting down backend server...")
    
    # Cleanup models and resources
    global yunet_detector, optimized_antispoofing_detector, edgeface_detector, face_tracker, attendance_database
    
    try:
        # Database connections use context managers - no explicit close needed
        logger.info("Releasing model references...")
        
        # Clear model references to free memory
        yunet_detector = None
        optimized_antispoofing_detector = None
        edgeface_detector = None
        face_tracker = None
        attendance_database = None
        
        logger.info("✅ Cleanup complete")
        
    except Exception as e:
        logger.error(f"❌ Error during shutdown cleanup: {e}")

# Helper function to eliminate code duplication
async def process_antispoofing(faces: List[Dict], image: np.ndarray, enable: bool) -> List[Dict]:
    """Helper to process anti-spoofing across all endpoints"""
    if not (enable and faces and optimized_antispoofing_detector):
        return faces
    
    try:
        # DEBUG: Log input faces before anti-spoofing
        logger.info(f"DEBUG process_antispoofing: Input {len(faces)} faces")
        for i, face in enumerate(faces):
            bbox = face.get('bbox', {})
            conf = face.get('confidence', 0)
            logger.info(f"DEBUG Input face {i}: bbox={bbox}, confidence={conf}")
        
        # Use simple anti-spoofing detector
        faces_with_antispoofing = optimized_antispoofing_detector.detect_faces(image, faces)
        
        # DEBUG: Log anti-spoofing results
        logger.info(f"DEBUG process_antispoofing: {len(faces_with_antispoofing)} faces processed")
        for i, face in enumerate(faces_with_antispoofing):
            if 'antispoofing' in face:
                antispoof = face['antispoofing']
                logger.info(f"DEBUG Face {i} result: is_real={antispoof['is_real']}, live_score={antispoof['live_score']:.3f}, spoof_score={antispoof['spoof_score']:.3f}, predicted_class={antispoof.get('predicted_class', 'N/A')}")
        
        return faces_with_antispoofing
        
    except Exception as e:
        logger.warning(f"Anti-spoofing failed: {e}")
        # Mark ALL faces as FAKE on error for security
        for face in faces:
            face['antispoofing'] = {
                'is_real': False,
                'live_score': 0.0,
                'spoof_score': 1.0,
                'confidence': 0.0,
                'status': 'error',
                'label': 'Error',
                'message': f'Anti-spoofing error: {str(e)}'
            }
    
    return faces

async def process_face_tracking(faces: List[Dict], image: np.ndarray) -> List[Dict]:
    """
    🚀 OPTIMIZED: Process face tracking with Deep SORT
    - Extracts embeddings only every 5th frame (PERFORMANCE BOOST)
    - Uses motion-only tracking on other frames (FAST!)
    - Maintains accuracy while achieving 5x speed improvement
    """
    if not (faces and face_tracker and edgeface_detector):
        return faces
    
    try:
        # 🚀 PERFORMANCE: Track frame count for selective embedding extraction
        if not hasattr(process_face_tracking, 'frame_counter'):
            process_face_tracking.frame_counter = 0
        
        process_face_tracking.frame_counter += 1
        
        # Extract embeddings for all faces (batch processing for efficiency)
        loop = asyncio.get_event_loop()
        
        # Extract embeddings only every 5th frame for appearance matching
        # Other frames use motion-only tracking (Kalman filter) which is MUCH faster
        if process_face_tracking.frame_counter % 5 == 0:
            # Full appearance + motion matching (slower but accurate)
            embeddings = await loop.run_in_executor(
                None,
                edgeface_detector.extract_embeddings_for_tracking,
                image,
                faces
            )
        else:
            # Motion-only tracking (5x faster!)
            embeddings = None
        
        # Update Deep SORT tracker with faces and embeddings
        tracked_faces = await loop.run_in_executor(
            None,
            face_tracker.update,
            faces,
            embeddings if embeddings and len(embeddings) == len(faces) else None
        )
        
        return tracked_faces
            
    except Exception as e:
        logger.warning(f"Deep SORT tracking failed: {e}")
        # Return original faces without tracking on error
        return faces

@app.get("/")
async def root():
    """Health check endpoint"""
    return {"message": "Face Detection API is running", "status": "healthy"}

@app.get("/models")
async def get_available_models():
    """Get information about available models"""
    models_info = {}
    
    if yunet_detector:
        models_info["yunet"] = {
            "available": True,
            "info": yunet_detector.get_model_info()
        }
    else:
        models_info["yunet"] = {"available": False}
    
    if optimized_antispoofing_detector:
        models_info["antispoofing"] = {
            "available": True,
            "info": optimized_antispoofing_detector.get_model_info()
        }
    else:
        models_info["antispoofing"] = {"available": False}
    
    if optimized_antispoofing_detector:
        models_info["optimized_antispoofing"] = {
            "available": True,
            "info": optimized_antispoofing_detector.get_model_info()
        }
    else:
        models_info["optimized_antispoofing"] = {"available": False}
    
    if edgeface_detector:
        models_info["edgeface"] = {
            "available": True,
            "info": edgeface_detector.get_model_info()
        }
    else:
        models_info["edgeface"] = {"available": False}
    
    return {
        "models": models_info
    }

class OptimizationRequest(BaseModel):
    cache_duration: float = 1.0
    clear_cache: bool = False

@app.post("/optimize/antispoofing")
async def configure_antispoofing_optimization(request: OptimizationRequest):
    """Configure antispoofing optimization settings"""
    if not optimized_antispoofing_detector:
        raise HTTPException(status_code=500, detail="Optimized antispoofing detector not available")
    
    try:
        if request.clear_cache:
            optimized_antispoofing_detector.clear_cache()
        
        optimized_antispoofing_detector.cache_duration = request.cache_duration
        
        return {
            "success": True,
            "message": "Optimization settings updated",
            "settings": {
                "cache_duration": request.cache_duration,
                "cache_cleared": request.clear_cache
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update settings: {e}")

@app.post("/detect", response_model=DetectionResponse)
async def detect_faces(request: DetectionRequest):
    """
    Detect faces in a single image
    """
    import time
    start_time = time.time()
    
    try:
        # OPTIMIZATION: Keep BGR format throughout (OpenCV native format)
        image = decode_base64_image(request.image)  # Returns BGR
        
        if request.model_type == "yunet":
            if not yunet_detector:
                raise HTTPException(status_code=500, detail="YuNet model not available")
            
            yunet_detector.set_confidence_threshold(request.confidence_threshold)
            yunet_detector.set_nms_threshold(request.nms_threshold)
            
            faces = yunet_detector.detect_faces(image)
            
            # CRITICAL: Add face tracking for consistent track_id (Deep SORT with embeddings)
            faces = await process_face_tracking(faces, image)
            
            faces = await process_antispoofing(faces, image, request.enable_antispoofing)
            
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported model type: {request.model_type}")
        
        processing_time = time.time() - start_time

        for face in faces:
            if 'bbox' in face and isinstance(face['bbox'], dict):
                bbox_orig = face.get('bbox_original', face['bbox'])
                face['bbox'] = [bbox_orig.get('x', 0), bbox_orig.get('y', 0), bbox_orig.get('width', 0), bbox_orig.get('height', 0)]
            
            if 'track_id' in face:
                import numpy as np
                track_id_value = face['track_id']
                if isinstance(track_id_value, (np.integer, np.int32, np.int64)):
                    face['track_id'] = int(track_id_value)
            
            if 'embedding' in face:
                del face['embedding']
        
        return DetectionResponse(
            success=True,
            faces=faces,
            processing_time=processing_time,
            model_used=request.model_type
        )
        
    except Exception as e:
        logger.error(f"Detection error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/detect/upload")
async def detect_faces_upload(
    file: UploadFile = File(...),
    model_type: str = "yunet",
    confidence_threshold: float = 0.6,
    nms_threshold: float = 0.3,
    enable_antispoofing: bool = True
):
    """
    Detect faces in an uploaded image file
    """
    import time
    start_time = time.time()
    
    try:
        contents = await file.read()
        
        nparr = np.frombuffer(contents, np.uint8)
        image_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if image_bgr is None:
            raise HTTPException(status_code=400, detail="Invalid image file")
        
        # OPTIMIZATION: Keep BGR format (no conversion needed)
        image = image_bgr
        
        if model_type == "yunet":
            if not yunet_detector:
                raise HTTPException(status_code=500, detail="YuNet model not available")
            
            yunet_detector.set_confidence_threshold(confidence_threshold)
            yunet_detector.set_nms_threshold(nms_threshold)
            
            faces = yunet_detector.detect_faces(image)
            
            # CRITICAL: Add face tracking for consistent track_id (Deep SORT with embeddings)
            faces = await process_face_tracking(faces, image)
            
            faces = await process_antispoofing(faces, image, enable_antispoofing)
            
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported model type: {model_type}")
        
        processing_time = time.time() - start_time
        
        for face in faces:
            if 'bbox' in face and isinstance(face['bbox'], dict):
                bbox_orig = face.get('bbox_original', face['bbox'])
                face['bbox'] = [bbox_orig.get('x', 0), bbox_orig.get('y', 0), bbox_orig.get('width', 0), bbox_orig.get('height', 0)]
            
            if 'track_id' in face:
                import numpy as np
                track_id_value = face['track_id']
                if isinstance(track_id_value, (np.integer, np.int32, np.int64)):
                    face['track_id'] = int(track_id_value)
            
            if 'embedding' in face:
                del face['embedding']
        
        return {
            "success": True,
            "faces": faces,
            "processing_time": processing_time,
            "model_used": model_type
        }
        
    except Exception as e:
            logger.error(f"Detection error: {e}")
            raise HTTPException(status_code=500, detail=str(e))

# Face Recognition Endpoints

@app.post("/face/recognize", response_model=FaceRecognitionResponse)
async def recognize_face(request: FaceRecognitionRequest):
    """
    Recognize a face using EdgeFace model with antispoofing validation
    """
    import time
    start_time = time.time()
    
    try:
        if not edgeface_detector:
            raise HTTPException(status_code=500, detail="EdgeFace detector not available")
        
        # OPTIMIZATION: Keep BGR format (no conversion needed)
        image = decode_base64_image(request.image)
        
        if optimized_antispoofing_detector:
            temp_face = {
                'bbox': {
                    'x': request.bbox[0],
                    'y': request.bbox[1], 
                    'width': request.bbox[2],
                    'height': request.bbox[3]
                },
                'confidence': 1.0,
                'track_id': -1
            }
            
            antispoofing_results = await optimized_antispoofing_detector.detect_faces_async(image, [temp_face])
            
            if antispoofing_results and len(antispoofing_results) > 0:
                antispoofing_data = antispoofing_results[0].get('antispoofing', {})
                is_real = antispoofing_data.get('is_real', False)
                status = antispoofing_data.get('status', 'unknown')
                
                # Block recognition for spoofed faces
                if not is_real or status == 'fake':
                    processing_time = time.time() - start_time
                    logger.warning(f"Recognition blocked for spoofed face: status={status}, is_real={is_real}")
                    return FaceRecognitionResponse(
                        success=False,
                        person_id=None,
                        similarity=0.0,
                        processing_time=processing_time,
                        error=f"Recognition blocked: spoofed face detected (status: {status})"
                    )
                
                # Also block other problematic statuses
                if status in ['too_small', 'error', 'processing_failed', 'invalid_bbox', 'out_of_frame']:
                    processing_time = time.time() - start_time
                    logger.warning(f"Recognition blocked for face with status: {status}")
                    return FaceRecognitionResponse(
                        success=False,
                        person_id=None,
                        similarity=0.0,
                        processing_time=processing_time,
                        error=f"Recognition blocked: face status {status}"
                    )
        
        # Use FaceMesh for high-precision face alignment
        result = await edgeface_detector.recognize_face_async(
            image, 
            request.bbox
        )
        
        processing_time = time.time() - start_time
        
        return FaceRecognitionResponse(
            success=result["success"],
            person_id=result.get("person_id"),
            similarity=result.get("similarity", 0.0),
            processing_time=processing_time,
            error=result.get("error")
        )
        
    except Exception as e:
        processing_time = time.time() - start_time
        logger.error(f"Face recognition error: {e}")
        return FaceRecognitionResponse(
            success=False,
            person_id=None,
            similarity=0.0,
            processing_time=processing_time,
            error=str(e)
        )

@app.post("/face/register", response_model=FaceRegistrationResponse)
async def register_person(request: FaceRegistrationRequest):
    """
    Register a new person in the face database with antispoofing validation
    """
    import time
    start_time = time.time()
    
    try:
        if not edgeface_detector:
            raise HTTPException(status_code=500, detail="EdgeFace detector not available")
        
        # OPTIMIZATION: Keep BGR format (no conversion needed)
        image = decode_base64_image(request.image)
        
        if optimized_antispoofing_detector:
            temp_face = {
                'bbox': {
                    'x': request.bbox[0],
                    'y': request.bbox[1], 
                    'width': request.bbox[2],
                    'height': request.bbox[3]
                },
                'confidence': 1.0,
                'track_id': -1
            }
            
            antispoofing_results = await optimized_antispoofing_detector.detect_faces_async(image, [temp_face])
            
            if antispoofing_results and len(antispoofing_results) > 0:
                antispoofing_data = antispoofing_results[0].get('antispoofing', {})
                is_real = antispoofing_data.get('is_real', False)
                status = antispoofing_data.get('status', 'unknown')
                
                # Block registration for spoofed faces
                if not is_real or status == 'fake':
                    processing_time = time.time() - start_time
                    logger.warning(f"Registration blocked for spoofed face: status={status}, is_real={is_real}")
                    return FaceRegistrationResponse(
                        success=False,
                        person_id=request.person_id,
                        total_persons=0,
                        processing_time=processing_time,
                        error=f"Registration blocked: spoofed face detected (status: {status})"
                    )
                
                # Also block other problematic statuses
                if status in ['too_small', 'error', 'processing_failed', 'invalid_bbox', 'out_of_frame']:
                    processing_time = time.time() - start_time
                    logger.warning(f"Registration blocked for face with status: {status}")
                    return FaceRegistrationResponse(
                        success=False,
                        person_id=request.person_id,
                        total_persons=0,
                        processing_time=processing_time,
                        error=f"Registration blocked: face status {status}"
                    )
        
        result = await edgeface_detector.register_person_async(
            request.person_id, 
            image, 
            request.bbox
        )
        
        processing_time = time.time() - start_time
        
        return FaceRegistrationResponse(
            success=result["success"],
            person_id=request.person_id,
            total_persons=result.get("total_persons", 0),
            processing_time=processing_time,
            error=result.get("error")
        )
        
    except Exception as e:
        processing_time = time.time() - start_time
        logger.error(f"Person registration error: {e}")
        return FaceRegistrationResponse(
            success=False,
            person_id=request.person_id,
            total_persons=0,
            processing_time=processing_time,
            error=str(e)
        )

@app.delete("/face/person/{person_id}")
async def remove_person(person_id: str):
    """
    Remove a person from the face database
    """
    try:
        if not edgeface_detector:
            raise HTTPException(status_code=500, detail="EdgeFace detector not available")
        
        result = edgeface_detector.remove_person(person_id)
        
        if result["success"]:
            return {
                "success": True,
                "message": f"Person {person_id} removed successfully",
                "total_persons": result.get("total_persons", 0)
            }
        else:
            raise HTTPException(status_code=404, detail=result.get("error", "Person not found"))
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Person removal error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to remove person: {e}")

@app.put("/face/person")
async def update_person(request: PersonUpdateRequest):
    """
    Update a person's ID in the face database
    """
    try:
        if not edgeface_detector:
            raise HTTPException(status_code=500, detail="EdgeFace detector not available")
        
        # Validate input
        if not request.old_person_id.strip() or not request.new_person_id.strip():
            raise HTTPException(status_code=400, detail="Both old and new person IDs must be provided")
        
        if request.old_person_id.strip() == request.new_person_id.strip():
            raise HTTPException(status_code=400, detail="Old and new person IDs must be different")
        
        # Update person ID using EdgeFaceDetector method
        result = edgeface_detector.update_person_id(
            request.old_person_id.strip(), 
            request.new_person_id.strip()
        )
        
        if result["success"]:
            return result
        else:
            raise HTTPException(status_code=404, detail=result.get("error", "Update failed"))
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Person update error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update person: {e}")

@app.get("/face/persons")
async def get_all_persons():
    """
    Get list of all registered persons
    """
    try:
        if not edgeface_detector:
            raise HTTPException(status_code=500, detail="EdgeFace detector not available")
        
        persons = edgeface_detector.get_all_persons()
        stats = edgeface_detector.get_stats()
        
        return {
            "success": True,
            "persons": persons,
            "total_count": len(persons),
            "stats": stats
        }
        
    except Exception as e:
        logger.error(f"Get persons error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get persons: {e}")

@app.post("/face/threshold")
async def set_similarity_threshold(request: SimilarityThresholdRequest):
    """
    Set similarity threshold for face recognition
    """
    try:
        if not edgeface_detector:
            raise HTTPException(status_code=500, detail="EdgeFace detector not available")
        
        if not (0.0 <= request.threshold <= 1.0):
            raise HTTPException(status_code=400, detail="Threshold must be between 0.0 and 1.0")
        
        edgeface_detector.set_similarity_threshold(request.threshold)
        
        return {
            "success": True,
            "message": f"Similarity threshold updated to {request.threshold}",
            "threshold": request.threshold
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Threshold update error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update threshold: {e}")

@app.delete("/face/database")
async def clear_database():
    """
    Clear all persons from the face database
    """
    try:
        if not edgeface_detector:
            raise HTTPException(status_code=500, detail="EdgeFace detector not available")
        
        result = edgeface_detector.clear_database()
        
        if result["success"]:
            return {
                "success": True,
                "message": "Face database cleared successfully",
                "total_persons": 0
            }
        else:
            raise HTTPException(status_code=500, detail=result.get("error", "Failed to clear database"))
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Database clear error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to clear database: {e}")

@app.get("/face/stats")
async def get_face_stats():
    """
    Get face recognition statistics and configuration
    """
    try:
        if not edgeface_detector:
            raise HTTPException(status_code=500, detail="EdgeFace detector not available")
        
        stats = edgeface_detector.get_stats()
        
        # Return stats directly in the format expected by the Settings component
        return stats
        
    except Exception as e:
        logger.error(f"Get stats error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get stats: {e}")

@app.websocket("/ws/detect/{client_id}")
async def websocket_detect_endpoint(websocket: WebSocket, client_id: str):
    await websocket.accept()
    logger.info(f"WebSocket detection connected: {client_id}")
    
    try:
        await websocket.send_text(json.dumps({
            "type": "connection",
            "status": "connected",
            "client_id": client_id,
            "timestamp": time.time()
        }))
        
        while True:
            try:
                message_data = await websocket.receive()
                
                if "text" in message_data:
                    message = json.loads(message_data["text"])
                    
                    if message.get("type") == "ping":
                        await websocket.send_text(json.dumps({
                            "type": "pong",
                            "client_id": client_id,
                            "timestamp": time.time()
                        }))
                        continue
                    
                    elif message.get("type") == "config":
                        await websocket.send_text(json.dumps({
                            "type": "config_ack",
                            "success": True,
                            "timestamp": time.time()
                        }))
                        continue
                
                elif "bytes" in message_data:
                    start_time = time.time()
                    frame_bytes = message_data["bytes"]
                    
                    nparr = np.frombuffer(frame_bytes, np.uint8)
                    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                    
                    if image is None:
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": "Failed to decode frame",
                            "timestamp": time.time()
                        }))
                        continue
                    
                    if not yunet_detector:
                        raise HTTPException(status_code=500, detail="YuNet model not available")
                    
                    faces = yunet_detector.detect_faces(image)
                    faces = await process_face_tracking(faces, image)
                    faces = await process_antispoofing(faces, image, True)
                    
                    serialized_faces = []
                    for face in faces:
                        if 'bbox' in face and isinstance(face['bbox'], dict):
                            bbox_orig = face.get('bbox_original', face['bbox'])
                            face['bbox'] = [
                                bbox_orig.get('x', 0), 
                                bbox_orig.get('y', 0), 
                                bbox_orig.get('width', 0), 
                                bbox_orig.get('height', 0)
                            ]
                        
                        if 'track_id' in face:
                            track_id_value = face['track_id']
                            if isinstance(track_id_value, (np.integer, np.int32, np.int64)):
                                face['track_id'] = int(track_id_value)
                        
                        if 'embedding' in face:
                            del face['embedding']
                        
                        serialized_faces.append(face)
                    
                    processing_time = time.time() - start_time
                    
                    await websocket.send_text(json.dumps({
                        "type": "detection_response",
                        "faces": serialized_faces,
                        "model_used": "yunet",
                        "processing_time": processing_time,
                        "timestamp": time.time(),
                        "success": True
                    }))
                    
            except Exception as e:
                logger.error(f"Detection processing error: {e}")
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": f"Detection failed: {str(e)}",
                    "timestamp": time.time()
                }))
                    
    except WebSocketDisconnect:
        logger.info(f"WebSocket detection disconnected: {client_id}")
    except Exception as e:
        logger.error(f"WebSocket detection error: {e}")

@app.websocket("/ws/notifications/{client_id}")
async def websocket_notifications_endpoint(websocket: WebSocket, client_id: str):
    await manager.connect(websocket, client_id)
    logger.info(f"Notification client connected: {client_id}")
    
    try:
        await websocket.send_text(json.dumps({
            "type": "connection",
            "status": "connected",
            "client_id": client_id,
            "timestamp": asyncio.get_event_loop().time()
        }))
        
        while True:
            message_data = await websocket.receive()
            
            if "text" in message_data:
                message = json.loads(message_data["text"])
                
                if message.get("type") == "ping":
                    await websocket.send_text(json.dumps({
                        "type": "pong",
                        "client_id": client_id,
                        "timestamp": asyncio.get_event_loop().time()
                    }))
                    
    except WebSocketDisconnect:
        logger.info(f"Notification client disconnected: {client_id}")
        manager.disconnect(client_id)
    except Exception as e:
        logger.error(f"WebSocket notification error: {e}")
        manager.disconnect(client_id)

if __name__ == "__main__":
    uvicorn.run(
        app,  # Pass app object directly for PyInstaller compatibility
        host="127.0.0.1",
        port=8700, 
        reload=False,  # Disabled to prevent log file reload loops
        log_level="info"
    )