"""
FastAPI Backend for Face Detection Pipeline
Supports face detection, liveness detection, and face recognition models
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

from models.detector import FaceDetector
from models.validator import LivenessValidator
from models.recognizer import FaceRecognizer
from models.tracker import FaceTracker
from utils.image_utils import decode_base64_image, encode_image_to_base64
from utils.websocket_manager import manager, handle_websocket_message
from utils.attendance_database import AttendanceDatabaseManager
from routes import attendance
from config import FACE_DETECTOR_MODEL_PATH, FACE_DETECTOR_CONFIG, LIVENESS_DETECTOR_CONFIG, FACE_RECOGNIZER_MODEL_PATH, FACE_RECOGNIZER_CONFIG, CORS_CONFIG, FACE_TRACKER_CONFIG, DATA_DIR, MODEL_CONFIGS

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Face Detection API",
    description="High-performance async face detection pipeline with face detection, liveness detection, and face recognition",
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
face_detector = None
liveness_detector = None
face_recognizer = None
face_tracker = None

# Initialize attendance database
attendance_database = None

# Include attendance routes
app.include_router(attendance.router)

# Pydantic models for request/response
class DetectionRequest(BaseModel):
    image: str  # Base64 encoded image
    model_type: str = "face_detector"
    confidence_threshold: float = 0.6
    nms_threshold: float = 0.3
    enable_liveness_detection: bool = True

class DetectionResponse(BaseModel):
    success: bool
    faces: List[Dict]
    processing_time: float
    model_used: str
    suggested_skip: int = 0

class StreamingRequest(BaseModel):
    session_id: str
    model_type: str = "face_detector"
    confidence_threshold: float = 0.6
    nms_threshold: float = 0.3
    enable_liveness_detection: bool = True

class FaceRecognitionRequest(BaseModel):
    image: str  # Base64 encoded image
    bbox: List[float]  # Face bounding box [x, y, width, height]
    landmarks_5: Optional[List[List[float]]] = None  # Optional 5-point landmarks from face detector (FAST!)
    group_id: Optional[str] = None  # Optional group ID to filter recognition to specific group members
    enable_liveness_detection: bool = True  # Enable/disable liveness detection for spoof protection

class FaceRegistrationRequest(BaseModel):
    person_id: str
    image: str  # Base64 encoded image
    bbox: List[float]  # Face bounding box [x, y, width, height]
    enable_liveness_detection: bool = True  # Enable/disable liveness detection for spoof protection
    landmarks_5: Optional[List[List[float]]] = None  # Optional 5-point landmarks from face detector (FAST!)

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
    global face_detector, liveness_detector, face_recognizer, face_tracker, attendance_database
    try:
        face_detector = FaceDetector(
            model_path=str(FACE_DETECTOR_MODEL_PATH),
            input_size=tuple(FACE_DETECTOR_CONFIG["input_size"]),
            conf_threshold=FACE_DETECTOR_CONFIG["score_threshold"],
            nms_threshold=FACE_DETECTOR_CONFIG["nms_threshold"],
            top_k=FACE_DETECTOR_CONFIG["top_k"],
            min_face_size=FACE_DETECTOR_CONFIG["min_face_size"]
        )
        
        liveness_detector = LivenessValidator(
            model_path=str(LIVENESS_DETECTOR_CONFIG["model_path"]),
            model_img_size=LIVENESS_DETECTOR_CONFIG["model_img_size"],
            confidence_threshold=LIVENESS_DETECTOR_CONFIG["confidence_threshold"],
            config=LIVENESS_DETECTOR_CONFIG
        )
        
        # Initialize face recognizer (uses face detector landmarks for alignment)
        face_recognizer = FaceRecognizer(
            model_path=str(FACE_RECOGNIZER_MODEL_PATH),
            input_size=FACE_RECOGNIZER_CONFIG["input_size"],
            similarity_threshold=FACE_RECOGNIZER_CONFIG["similarity_threshold"],
            providers=FACE_RECOGNIZER_CONFIG["providers"],
            database_path=str(FACE_RECOGNIZER_CONFIG["database_path"]),
            session_options=FACE_RECOGNIZER_CONFIG["session_options"]
        )
        
        # Initialize face tracker (appearance + motion features)
        # Initializing face tracker with appearance features
        matching_weights = FACE_TRACKER_CONFIG["matching_weights"]
        face_tracker = FaceTracker(
            max_age=FACE_TRACKER_CONFIG["max_age"],
            n_init=FACE_TRACKER_CONFIG["n_init"],
            max_iou_distance=FACE_TRACKER_CONFIG["max_iou_distance"],
            max_cosine_distance=FACE_TRACKER_CONFIG["max_cosine_distance"],
            nn_budget=FACE_TRACKER_CONFIG["nn_budget"],
            matching_weights=matching_weights
        )
        
        # Initialize attendance database (auto-handles dev/prod paths)
        attendance_database = AttendanceDatabaseManager(str(DATA_DIR / "attendance.db"))
        
        # Set global variables for attendance routes
        attendance.attendance_db = attendance_database
        attendance.face_detector = face_detector
        attendance.face_recognizer = face_recognizer
        
    except Exception as e:
        logger.error(f"Failed to initialize models: {e}")
        raise

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    logger.info("🛑 Shutting down backend server...")
    
    # Cleanup models and resources
    global face_detector, liveness_detector, face_recognizer, face_tracker, attendance_database
    
    try:
        # Database connections use context managers - no explicit close needed
        logger.info("Releasing model references...")
        
        # Clear model references to free memory
        face_detector = None
        liveness_detector = None
        face_recognizer = None
        face_tracker = None
        attendance_database = None
        
        logger.info("✅ Cleanup complete")
        
    except Exception as e:
        logger.error(f"❌ Error during shutdown cleanup: {e}")


async def process_liveness_detection(faces: List[Dict], image: np.ndarray, enable: bool) -> List[Dict]:
    """Helper to process liveness detection across all endpoints"""
    if not (enable and faces and liveness_detector):
        return faces
    
    try:
        logger.info(f"process_liveness_detection: Input {len(faces)} faces")
        for i, face in enumerate(faces):
            bbox = face.get('bbox', {})
            conf = face.get('confidence', 0)
            logger.info(f"Input face {i}: bbox={bbox}, confidence={conf}")
        
        # Use simple liveness detector
        faces_with_liveness = liveness_detector.detect_faces(image, faces)
        
        logger.info(f"process_liveness_detection: {len(faces_with_liveness)} faces processed")
        for i, face in enumerate(faces_with_liveness):
            if 'liveness' in face:
                liveness = face['liveness']
                logger.info(f"Face {i} result: is_real={liveness['is_real']}, live_score={liveness['live_score']:.3f}, spoof_score={liveness['spoof_score']:.3f}, predicted_class={liveness.get('predicted_class', 'N/A')}")
        
        return faces_with_liveness
        
    except Exception as e:
        logger.warning(f"Liveness detection failed: {e}")
        # Mark ALL faces as FAKE on error for security
        for face in faces:
            face['liveness'] = {
                'is_real': False,
                'live_score': 0.0,
                'spoof_score': 1.0,
                'confidence': 0.0,
                'status': 'error',
                'label': 'Error',
                'message': f'Liveness detection error: {str(e)}'
            }
    
    return faces

async def process_face_tracking(faces: List[Dict], image: np.ndarray) -> List[Dict]:
    """
    Process face tracking with Deep SORT
    - Extracts embeddings for all frames for consistent tracking
    - Frontend controls frame rate, so no need for backend frame skipping
    """
    if not (faces and face_tracker and face_recognizer):
        return faces
    
    try:
        # Extract embeddings for all faces (batch processing for efficiency)
        loop = asyncio.get_event_loop()
        embeddings = await loop.run_in_executor(
            None,
            face_recognizer.extract_embeddings_for_tracking,
            image,
            faces
        )
        
        # Update Deep SORT tracker with faces and embeddings
        tracked_faces = await loop.run_in_executor(
            None,
            face_tracker.update,
            faces,
            embeddings
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
    
    if face_detector:
        models_info["face_detector"] = {
            "available": True,
            "info": face_detector.get_model_info()
        }
    else:
        models_info["face_detector"] = {"available": False}
    
    if liveness_detector:
        models_info["liveness_detector"] = {
            "available": True,
            "info": liveness_detector.get_model_info()
        }
    else:
        models_info["liveness_detector"] = {"available": False}
    
    if face_recognizer:
        models_info["face_recognizer"] = {
            "available": True,
            "info": face_recognizer.get_model_info()
        }
    else:
        models_info["face_recognizer"] = {"available": False}
    
    return {
        "models": models_info
    }

class OptimizationRequest(BaseModel):
    cache_duration: float = 1.0
    clear_cache: bool = False

@app.post("/optimize/liveness")
async def configure_liveness_optimization(request: OptimizationRequest):
    """Configure liveness detection optimization settings"""
    if not liveness_detector:
        raise HTTPException(status_code=500, detail="Liveness detector not available")
    
    try:
        if request.clear_cache:
            liveness_detector.clear_cache()
        
        liveness_detector.cache_duration = request.cache_duration
        
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

@app.post("/optimize/face_detector")
async def configure_face_detector_optimization(request: dict):
    """Configure face detector optimization settings including minimum face size"""
    try:
        if face_detector:
            if "min_face_size" in request:
                min_size = int(request["min_face_size"])
                face_detector.set_min_face_size(min_size)
                return {
                    "success": True,
                    "message": "Face detector settings updated successfully",
                    "new_settings": {
                        "min_face_size": min_size
                    }
                }
            else:
                return {"success": False, "message": "min_face_size parameter required"}
        else:
            return {"success": False, "message": "Face detector not available"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update face detector settings: {e}")

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
        
        if request.model_type == "face_detector":
            if not face_detector:
                raise HTTPException(status_code=500, detail="Face detector model not available")
            
            face_detector.set_confidence_threshold(request.confidence_threshold)
            face_detector.set_nms_threshold(request.nms_threshold)
            
            # When liveness detection is disabled, remove minimum face size limit
            # When enabled, restore default minimum face size (80px for liveness compatibility)
            if not request.enable_liveness_detection:
                face_detector.set_min_face_size(0)  # No limit when spoof detection is off
            else:
                default_min_size = MODEL_CONFIGS.get("face_detector", {}).get("min_face_size", 80)
                face_detector.set_min_face_size(default_min_size)
            
            faces = face_detector.detect_faces(image)
            
            # CRITICAL: Add face tracking for consistent track_id (Deep SORT with embeddings)
            faces = await process_face_tracking(faces, image)
            
            faces = await process_liveness_detection(faces, image, request.enable_liveness_detection)
            
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
        
        processing_time_ms = processing_time * 1000
        suggested_skip = 2 if processing_time_ms > 50 else (1 if processing_time_ms > 30 else 0)
        
        return DetectionResponse(
            success=True,
            faces=faces,
            processing_time=processing_time,
            model_used=request.model_type,
            suggested_skip=suggested_skip
        )
        
    except Exception as e:
        logger.error(f"Detection error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/detect/upload")
async def detect_faces_upload(
    file: UploadFile = File(...),
    model_type: str = "face_detector",
    confidence_threshold: float = 0.6,
    nms_threshold: float = 0.3,
    enable_liveness_detection: bool = True
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
        
        if model_type == "face_detector":
            if not face_detector:
                raise HTTPException(status_code=500, detail="Face detector model not available")
            
            face_detector.set_confidence_threshold(confidence_threshold)
            face_detector.set_nms_threshold(nms_threshold)
            
            # When liveness detection is disabled, remove minimum face size limit
            # When enabled, restore default minimum face size (80px for liveness compatibility)
            if not enable_liveness_detection:
                face_detector.set_min_face_size(0)  # No limit when spoof detection is off
            else:
                default_min_size = MODEL_CONFIGS.get("face_detector", {}).get("min_face_size", 80)
                face_detector.set_min_face_size(default_min_size)
            
            faces = face_detector.detect_faces(image)
            
            # CRITICAL: Add face tracking for consistent track_id (Deep SORT with embeddings)
            faces = await process_face_tracking(faces, image)
            
            faces = await process_liveness_detection(faces, image, enable_liveness_detection)
            
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
        
        processing_time_ms = processing_time * 1000
        suggested_skip = 2 if processing_time_ms > 50 else (1 if processing_time_ms > 30 else 0)
        
        return {
            "success": True,
            "faces": faces,
            "processing_time": processing_time,
            "model_used": model_type,
            "suggested_skip": suggested_skip
        }
        
    except Exception as e:
            logger.error(f"Detection error: {e}")
            raise HTTPException(status_code=500, detail=str(e))

# Face Recognition Endpoints

@app.post("/face/recognize", response_model=FaceRecognitionResponse)
async def recognize_face(request: FaceRecognitionRequest):
    """
    Recognize a face using face recognizer with liveness detection validation
    """
    import time
    start_time = time.time()
    
    try:
        if not face_recognizer:
            raise HTTPException(status_code=500, detail="Face recognizer not available")
        
        # OPTIMIZATION: Keep BGR format (no conversion needed)
        image = decode_base64_image(request.image)
        
        # Only perform liveness detection if enabled
        if liveness_detector and request.enable_liveness_detection:
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
            
            liveness_results = await liveness_detector.detect_faces_async(image, [temp_face])
            
            if liveness_results and len(liveness_results) > 0:
                liveness_data = liveness_results[0].get('liveness', {})
                is_real = liveness_data.get('is_real', False)
                status = liveness_data.get('status', 'unknown')
                
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
        
        # Use landmarks from frontend (face detection)
        landmarks_5 = request.landmarks_5
        if landmarks_5 is None:
            raise HTTPException(status_code=400, detail="Landmarks required from frontend face detection")
        
        # Get person_ids for group filtering (if group_id provided)
        allowed_person_ids = None
        if request.group_id and attendance_database:
            allowed_person_ids = attendance_database.get_group_person_ids(request.group_id)
            logger.debug(f"Group filter active: {len(allowed_person_ids)} members in group {request.group_id}")
        
        result = await face_recognizer.recognize_face_async(
            image, 
            request.bbox,
            landmarks_5,
            allowed_person_ids
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
    Register a new person in the face database with liveness detection validation
    """
    import time
    start_time = time.time()
    
    try:
        if not face_recognizer:
            raise HTTPException(status_code=500, detail="Face recognizer not available")
        
        # OPTIMIZATION: Keep BGR format (no conversion needed)
        image = decode_base64_image(request.image)
        
        # Only perform liveness detection if enabled
        if liveness_detector and request.enable_liveness_detection:
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
            
            liveness_results = await liveness_detector.detect_faces_async(image, [temp_face])
            
            if liveness_results and len(liveness_results) > 0:
                liveness_data = liveness_results[0].get('liveness', {})
                is_real = liveness_data.get('is_real', False)
                status = liveness_data.get('status', 'unknown')
                
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
        
        # Use landmarks from frontend (face detection)
        landmarks_5 = request.landmarks_5
        if landmarks_5 is None:
            raise HTTPException(status_code=400, detail="Landmarks required from frontend face detection")
        
        result = await face_recognizer.register_person_async(
            request.person_id, 
            image, 
            request.bbox,
            landmarks_5
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
        if not face_recognizer:
            raise HTTPException(status_code=500, detail="Face recognizer not available")
        
        result = face_recognizer.remove_person(person_id)
        
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
        if not face_recognizer:
            raise HTTPException(status_code=500, detail="Face recognizer not available")
        
        # Validate input
        if not request.old_person_id.strip() or not request.new_person_id.strip():
            raise HTTPException(status_code=400, detail="Both old and new person IDs must be provided")
        
        if request.old_person_id.strip() == request.new_person_id.strip():
            raise HTTPException(status_code=400, detail="Old and new person IDs must be different")
        
        # Update person ID using face recognizer method
        result = face_recognizer.update_person_id(
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
        if not face_recognizer:
            raise HTTPException(status_code=500, detail="Face recognizer not available")
        
        persons = face_recognizer.get_all_persons()
        stats = face_recognizer.get_stats()
        
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
        if not face_recognizer:
            raise HTTPException(status_code=500, detail="Face recognizer not available")
        
        if not (0.0 <= request.threshold <= 1.0):
            raise HTTPException(status_code=400, detail="Threshold must be between 0.0 and 1.0")
        
        face_recognizer.set_similarity_threshold(request.threshold)
        
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
        if not face_recognizer:
            raise HTTPException(status_code=500, detail="Face recognizer not available")
        
        result = face_recognizer.clear_database()
        
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
        if not face_recognizer:
            raise HTTPException(status_code=500, detail="Face recognizer not available")
        
        stats = face_recognizer.get_stats()
        
        # Return stats directly in the format expected by the Settings component
        return stats
        
    except Exception as e:
        logger.error(f"Get stats error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get stats: {e}")

@app.websocket("/ws/detect/{client_id}")
async def websocket_detect_endpoint(websocket: WebSocket, client_id: str):
    await websocket.accept()
    # WebSocket detection connected
    
    # Store enable_liveness_detection per client (default to True)
    enable_liveness_detection = True
    
    # Initialize min_face_size based on default enable_liveness_detection state
    # This ensures correct face size limiting from the first frame
    if face_detector:
        default_min_size = MODEL_CONFIGS.get("face_detector", {}).get("min_face_size", 80)
        face_detector.set_min_face_size(default_min_size)
    
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
                        # Update enable_liveness_detection from config
                        if "enable_liveness_detection" in message:
                            enable_liveness_detection = message.get("enable_liveness_detection", True)
                            # When liveness detection is disabled, remove minimum face size limit
                            # When enabled, restore default minimum face size (80px for liveness compatibility)
                            if face_detector:
                                if not enable_liveness_detection:
                                    face_detector.set_min_face_size(0)  # No limit when spoof detection is off
                                else:
                                    default_min_size = MODEL_CONFIGS.get("face_detector", {}).get("min_face_size", 80)
                                    face_detector.set_min_face_size(default_min_size)
                        
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
                    
                    if not face_detector:
                        raise HTTPException(status_code=500, detail="Face detector model not available")
                    
                    faces = face_detector.detect_faces(image)
                    faces = await process_face_tracking(faces, image)
                    faces = await process_liveness_detection(faces, image, enable_liveness_detection)
                    
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
                        "model_used": "face_detector",
                        "processing_time": processing_time,
                        "timestamp": time.time(),
                        "success": True,
                        "suggested_skip": 2 if processing_time * 1000 > 50 else (1 if processing_time * 1000 > 30 else 0)
                    }))
                    
            except Exception as e:
                logger.error(f"Detection processing error: {e}")
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": f"Detection failed: {str(e)}",
                    "timestamp": time.time()
                }))
                    
    except WebSocketDisconnect:
        pass  # WebSocket detection disconnected
    except Exception as e:
        logger.error(f"WebSocket detection error: {e}")

@app.websocket("/ws/notifications/{client_id}")
async def websocket_notifications_endpoint(websocket: WebSocket, client_id: str):
    await manager.connect(websocket, client_id)
    # Notification client connected
    
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
        # Notification client disconnected
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