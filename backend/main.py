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

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from models.yunet_detector import YuNetDetector
from models.dual_minifasnet_detector import DualMiniFASNetDetector
from models.edgeface_detector import EdgeFaceDetector
from models.facemesh_detector import FaceMeshDetector
from models.sort_tracker import FaceTracker
from utils.image_utils import decode_base64_image, encode_image_to_base64
from utils.websocket_manager import manager, handle_websocket_message
from utils.attendance_database import AttendanceDatabaseManager
from routes import attendance
from config import YUNET_MODEL_PATH, YUNET_CONFIG, ANTISPOOFING_CONFIG, ANTISPOOFING_V2_CONFIG, ANTISPOOFING_V1SE_CONFIG, EDGEFACE_MODEL_PATH, EDGEFACE_CONFIG, MODEL_CONFIGS

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Face Detection API",
    description="High-performance async face detection pipeline with YuNet, SCRFD, anti-spoof, and alignment",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# WebSocket manager is imported as 'manager' from utils.websocket_manager

# Initialize models
yunet_detector = None
optimized_antispoofing_detector = None
edgeface_detector = None
facemesh_detector = None
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
    global yunet_detector, optimized_antispoofing_detector, edgeface_detector, facemesh_detector, face_tracker, attendance_database
    try:
        yunet_detector = YuNetDetector(
            model_path=str(YUNET_MODEL_PATH),
            input_size=list(YUNET_CONFIG["input_size"]),
            conf_threshold=YUNET_CONFIG["score_threshold"],
            nms_threshold=YUNET_CONFIG["nms_threshold"],
            backend_id=YUNET_CONFIG.get("backend_id", 0),
            target_id=YUNET_CONFIG.get("target_id", 0)
        )
        # Initialize Dual MiniFASNet detector (ensemble of V2 and V1SE)
        optimized_antispoofing_detector = DualMiniFASNetDetector(
            model_v2_path=str(ANTISPOOFING_V2_CONFIG["model_path"]),
            model_v1se_path=str(ANTISPOOFING_V1SE_CONFIG["model_path"]),
            input_size=ANTISPOOFING_V2_CONFIG["input_size"],
            threshold=ANTISPOOFING_CONFIG["threshold"],
            providers=ANTISPOOFING_V2_CONFIG["providers"],
            max_batch_size=ANTISPOOFING_V2_CONFIG.get("max_batch_size", 8),
            session_options=ANTISPOOFING_V2_CONFIG.get("session_options"),
            v2_weight=ANTISPOOFING_V2_CONFIG.get("weight", 0.6),
            v1se_weight=ANTISPOOFING_V1SE_CONFIG.get("weight", 0.4)
        )
        
        # Initialize shared FaceMesh detector first
        facemesh_detector = FaceMeshDetector(
            model_path=str(MODEL_CONFIGS["facemesh"]["model_path"]),
            input_size=MODEL_CONFIGS["facemesh"]["input_size"],
            score_threshold=MODEL_CONFIGS["facemesh"]["score_threshold"],
            margin_ratio=MODEL_CONFIGS["facemesh"]["margin_ratio"],
            providers=MODEL_CONFIGS["facemesh"]["providers"],
            session_options=MODEL_CONFIGS["facemesh"]["session_options"]
        )
        
        # Initialize EdgeFace detector with shared FaceMesh instance
        edgeface_detector = EdgeFaceDetector(
            model_path=str(EDGEFACE_MODEL_PATH),
            input_size=EDGEFACE_CONFIG["input_size"],
            similarity_threshold=EDGEFACE_CONFIG["similarity_threshold"],
            providers=EDGEFACE_CONFIG["providers"],
            database_path=str(EDGEFACE_CONFIG["database_path"]),
            session_options=EDGEFACE_CONFIG.get("session_options"),
            facemesh_alignment=EDGEFACE_CONFIG.get("facemesh_alignment", False),
            facemesh_detector=facemesh_detector if EDGEFACE_CONFIG.get("facemesh_alignment", False) else None,
            # DEPRECATED parameters - kept for backward compatibility
            facemesh_model_path=str(MODEL_CONFIGS.get("facemesh", {}).get("model_path", "")) if EDGEFACE_CONFIG.get("facemesh_alignment") else None,
            facemesh_config=MODEL_CONFIGS.get("facemesh", {}) if EDGEFACE_CONFIG.get("facemesh_alignment") else None
        )
        
        # Initialize SORT face tracker
        face_tracker = FaceTracker(
            max_age=30,  # Keep tracks alive for 30 frames without detection
            min_hits=1,  # Require only 1 detection for immediate tracking (faster, more responsive)
            iou_threshold=0.3  # IOU threshold for matching faces to tracks
        )
        logger.info("Face tracker initialized successfully")
        
        # Initialize attendance database
        attendance_database = AttendanceDatabaseManager("data/attendance.db")
        
        # Set the database instance in the attendance routes module
        attendance.attendance_db = attendance_database
        
    except Exception as e:
        logger.error(f"Failed to initialize models: {e}")
        raise

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""

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
        # Decode base64 image
        image = decode_base64_image(request.image)
        
        # Select detector based on model type
        if request.model_type == "yunet":
            if not yunet_detector:
                raise HTTPException(status_code=500, detail="YuNet model not available")
            
            # Update detector parameters
            yunet_detector.set_confidence_threshold(request.confidence_threshold)
            yunet_detector.set_nms_threshold(request.nms_threshold)
            
            # Perform face detection
            faces = await yunet_detector.detect_async(image)
            
            # Apply anti-spoofing if enabled and faces detected
            if request.enable_antispoofing and faces and optimized_antispoofing_detector:
                optimized_antispoofing_detector.set_threshold(ANTISPOOFING_CONFIG['threshold'])
                
                try:
                    # Use the optimized batch processing method
                    antispoofing_results = await optimized_antispoofing_detector.detect_faces_async(image, faces)
                    
                    # Add anti-spoofing results to each face
                    for i, (face, result) in enumerate(zip(faces, antispoofing_results)):
                        
                        # The result contains antispoofing data nested under 'antispoofing' key
                        antispoofing_data = result.get('antispoofing', {})
                        
                        # Convert numpy types to Python native types for JSON serialization
                        is_real_value = antispoofing_data.get('is_real', None)
                        if is_real_value is not None:
                            is_real_value = bool(is_real_value)  # Convert numpy.bool_ to Python bool
                        
                        face['antispoofing'] = {
                            'is_real': is_real_value,
                            'confidence': float(antispoofing_data.get('confidence', 0.0)),
                            'real_score': float(antispoofing_data.get('real_score', 0.0)),
                            'fake_score': float(antispoofing_data.get('fake_score', 0.0)),
                            'status': 'real' if is_real_value else 'fake'
                        }
                        
                except Exception as e:
                    logger.error(f"Anti-spoofing processing failed: {e}")
                    # Don't add anti-spoofing data when processing fails to prevent accumulation
                    # Just return the original face detections without anti-spoofing
                    logger.warning("Anti-spoofing failed - returning faces without anti-spoofing data to prevent accumulation")
            
            # Add FaceMesh 468 landmarks for frontend visualization
            if faces and facemesh_detector:
                try:
                    for face in faces:
                        bbox = face['bbox']  # [x, y, width, height]
                        
                        # Convert bbox to format expected by FaceMesh: [x1, y1, x2, y2]
                        x, y, w, h = bbox
                        face_bbox = [x, y, x + w, y + h]
                        
                        # Detect FaceMesh landmarks for this face (run in executor for async)
                        loop = asyncio.get_event_loop()
                        facemesh_result = await loop.run_in_executor(None, facemesh_detector.detect_landmarks, image, face_bbox)
                        
                        if facemesh_result and 'landmarks_468' in facemesh_result:
                            # Add 468-point landmarks for frontend visualization
                            face['landmarks_468'] = facemesh_result['landmarks_468']
                        else:
                            # If FaceMesh fails, set empty landmarks array
                            face['landmarks_468'] = []
                            
                except Exception as e:
                    logger.error(f"FaceMesh processing failed: {e}")
                    # If FaceMesh fails, add empty landmarks arrays to all faces
                    for face in faces:
                        face['landmarks_468'] = []
            
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported model type: {request.model_type}")
        
        processing_time = time.time() - start_time

        
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
        # Read uploaded file
        contents = await file.read()
        
        # Convert to OpenCV image
        nparr = np.frombuffer(contents, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if image is None:
            raise HTTPException(status_code=400, detail="Invalid image file")
        
        # Select detector based on model type
        if model_type == "yunet":
            if not yunet_detector:
                raise HTTPException(status_code=500, detail="YuNet model not available")
            
            # Update detector parameters
            yunet_detector.set_confidence_threshold(confidence_threshold)
            yunet_detector.set_nms_threshold(nms_threshold)
            
            # Perform face detection
            faces = await yunet_detector.detect_async(image)
            
            # Apply anti-spoofing if enabled and faces detected
            if enable_antispoofing and faces and optimized_antispoofing_detector:
                optimized_antispoofing_detector.set_threshold(ANTISPOOFING_CONFIG['threshold'])
                
                # Process all detected faces for anti-spoofing using optimized batch method
                try:
                    antispoofing_results = await optimized_antispoofing_detector.detect_faces_async(image, faces)
                    
                    # Add anti-spoofing results to each face
                    for i, (face, result) in enumerate(zip(faces, antispoofing_results)):
                        # The result contains antispoofing data nested under 'antispoofing' key
                        antispoofing_data = result.get('antispoofing', {})
                        
                        # Convert numpy types to Python native types for JSON serialization
                        is_real_value = antispoofing_data.get('is_real', None)
                        if is_real_value is not None:
                            is_real_value = bool(is_real_value)  # Convert numpy.bool_ to Python bool
                        
                        face['antispoofing'] = {
                            'is_real': is_real_value,
                            'confidence': float(antispoofing_data.get('confidence', 0.0)),
                            'real_score': float(antispoofing_data.get('real_score', 0.0)),
                            'fake_score': float(antispoofing_data.get('fake_score', 0.0)),
                            'status': 'real' if is_real_value else 'fake'
                        }
                        
                except Exception as e:
                    logger.warning(f"Anti-spoofing failed for all faces: {e}")
                    # Don't add anti-spoofing data when processing fails
                    # Just return the original face detections without anti-spoofing
            
            # Add FaceMesh 468 landmarks for frontend visualization
            if facemesh_detector and faces:
                for face in faces:
                    try:
                        # Convert YuNet bbox format to FaceMesh expected format
                        bbox = face.get('bbox', [])
                        if len(bbox) >= 4:
                            x, y, w, h = bbox
                            face_bbox = [x, y, x + w, y + h]
                            
                            # Detect FaceMesh landmarks for this face (run in executor for async)
                            loop = asyncio.get_event_loop()
                            facemesh_result = await loop.run_in_executor(None, facemesh_detector.detect_landmarks, image, face_bbox)
                            
                            if facemesh_result and 'landmarks_468' in facemesh_result:
                                face['landmarks_468'] = facemesh_result['landmarks_468']
                            else:
                                face['landmarks_468'] = []  # Empty array if detection failed
                    except Exception as e:
                        logger.warning(f"FaceMesh detection failed for face: {e}")
                        face['landmarks_468'] = []  # Empty array on error
            
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported model type: {model_type}")
        
        processing_time = time.time() - start_time
        
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
    Recognize a face using EdgeFace model
    """
    import time
    start_time = time.time()
    
    try:
        if not edgeface_detector:
            raise HTTPException(status_code=500, detail="EdgeFace detector not available")
        
        # Decode base64 image
        image = decode_base64_image(request.image)
        
        # Perform face recognition
        result = await edgeface_detector.recognize_face_async(image, request.bbox)
        
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
    Register a new person in the face database
    """
    import time
    start_time = time.time()
    
    try:
        if not edgeface_detector:
            raise HTTPException(status_code=500, detail="EdgeFace detector not available")
        
        # Decode base64 image
        image = decode_base64_image(request.image)
        
        # Register person
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

@app.websocket("/ws/{client_id}")
async def websocket_stream_endpoint(websocket: WebSocket, client_id: str):
    """
    WebSocket endpoint for real-time face detection streaming with adaptive processing
    """
    await manager.connect(websocket, client_id)
    session_id = client_id
    
    # Performance monitoring (simplified - no delays)
    processing_times = []
    max_samples = 15  # Rolling window for performance tracking
    overload_counter = 0   # Track consecutive overload situations
    
    # Queue management for overload prevention
    processing_queue = []
    max_queue_size = 10  # Increased for better burst processing
    is_processing = False
    dropped_frames = 0
    
    # NO DELAY FUNCTION - Removed for maximum performance
    
    try:
        while True:
            # Receive data from client
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message.get("type") == "detection_request":
                # Queue management - prevent overload
                if is_processing and len(processing_queue) >= max_queue_size:
                    # Drop frame if queue is full
                    dropped_frames += 1
                    logger.warning(f"Frame dropped due to queue overload. Total dropped: {dropped_frames}")
                    
                    # Send immediate response to maintain flow
                    overload_response = {
                        "type": "detection_response",
                        "session_id": session_id,
                        "faces": [],
                        "model_used": message.get("model_type", "yunet"),
                        "processing_time": 0.001,  # Minimal processing time
                        "timestamp": asyncio.get_event_loop().time(),
                        "frame_dropped": True,
                        "performance_metrics": {
                            "actual_fps": 0,
                            "avg_processing_time": sum(processing_times) / len(processing_times) if processing_times else 0,
                            "overload_counter": overload_counter,
                            "samples_count": len(processing_times),
                            "queue_size": len(processing_queue),
                            "dropped_frames": dropped_frames,
                            "max_performance_mode": True
                        }
                    }
                    await websocket.send_text(json.dumps(overload_response))
                    continue
                
                # Add to queue if currently processing
                if is_processing:
                    processing_queue.append(message)
                    continue
                
                # Process detection request
                is_processing = True
                try:
                    import time
                    start_time = time.time()
                    
                    image = decode_base64_image(message["image"])
                    model_type = message.get("model_type", "yunet")
                    confidence_threshold = message.get("confidence_threshold", 0.6)
                    nms_threshold = message.get("nms_threshold", 0.3)
                    
                    # Perform detection
                    if model_type == "yunet" and yunet_detector:
                        yunet_detector.set_confidence_threshold(confidence_threshold)
                        yunet_detector.set_nms_threshold(nms_threshold)
                        faces = await yunet_detector.detect_async(image)
                    else:
                        faces = []
                    
                    # Apply face tracking to assign consistent track IDs
                    if faces and face_tracker:
                        try:
                            print(f"[MAIN] BEFORE tracker: faces={len(faces)}, first_face_keys={list(faces[0].keys()) if faces else []}")
                            # Update tracker with detected faces
                            loop = asyncio.get_event_loop()
                            faces = await loop.run_in_executor(None, face_tracker.update, faces)
                            print(f"[MAIN] AFTER tracker: faces={len(faces)}, first_face_keys={list(faces[0].keys()) if faces else []}")
                            logger.debug(f"Assigned track IDs to {len(faces)} faces")
                            
                            # Debug: Check if track_id is present
                            for i, face in enumerate(faces):
                                track_id = face.get('track_id')
                                print(f"[MAIN] Face {i}: track_id={track_id}")
                                logger.debug(f"Face {i}: track_id={track_id}, keys={list(face.keys())}")
                        except Exception as e:
                            print(f"[MAIN] TRACKER EXCEPTION: {e}")
                            import traceback
                            traceback.print_exc()
                            logger.warning(f"Face tracking failed: {e}")
                            # Continue without tracking on error
                    
                    # Apply anti-spoofing detection if enabled and faces detected
                    enable_antispoofing = message.get("enable_antispoofing", True)
                    
                    if enable_antispoofing and faces and optimized_antispoofing_detector:
                        optimized_antispoofing_detector.set_threshold(ANTISPOOFING_CONFIG['threshold'])
                        
                        # Process all detected faces for anti-spoofing
                        try:
                            # Use the optimized async method that processes all faces
                            antispoofing_results = await optimized_antispoofing_detector.detect_faces_async(image, faces)
                            
                            # Merge anti-spoofing results back into the faces
                            for i, face in enumerate(faces):
                                if i < len(antispoofing_results):
                                    antispoofing_data = antispoofing_results[i].get('antispoofing', {})
                                    face['antispoofing'] = {
                                        'is_real': bool(antispoofing_data.get('is_real', True)),
                                        'confidence': float(antispoofing_data.get('confidence', 0.0)),
                                        'real_score': float(antispoofing_data.get('real_score', 0.5)),
                                        'fake_score': float(antispoofing_data.get('fake_score', 0.5)),
                                        'status': 'real' if antispoofing_data.get('is_real', True) else 'fake'
                                    }
                                else:
                                    # Fallback if no anti-spoofing result for this face
                                    face['antispoofing'] = {
                                        'is_real': None,
                                        'confidence': 0.0,
                                        'real_score': 0.5,
                                        'fake_score': 0.5,
                                        'status': 'error'
                                    }
                                    
                        except Exception as e:
                            logger.warning(f"Anti-spoofing failed for all faces: {e}")
                            # Don't add anti-spoofing data when processing fails
                            # Just return the original face detections without anti-spoofing
                    
                    # Add FaceMesh 468-landmark detection for each face
                    if faces and facemesh_detector:
                        loop = asyncio.get_event_loop()
                        for face in faces:
                            try:
                                # Convert YuNet bbox format to FaceMesh format
                                bbox = face.get('bbox', [0, 0, 0, 0])
                                facemesh_bbox = [bbox[0], bbox[1], bbox[0] + bbox[2], bbox[1] + bbox[3]]
                                
                                # Run FaceMesh detection in executor to avoid blocking
                                landmarks_result = await loop.run_in_executor(
                                    None, 
                                    facemesh_detector.detect_landmarks, 
                                    image, 
                                    facemesh_bbox
                                )
                                
                                if landmarks_result and landmarks_result.get('landmarks_468'):
                                    face['landmarks_468'] = landmarks_result['landmarks_468']
                                else:
                                    face['landmarks_468'] = []
                                    
                            except Exception as e:
                                logger.warning(f"FaceMesh detection failed for face: {e}")
                                face['landmarks_468'] = []
                    
                    # Calculate processing time
                    processing_time = time.time() - start_time
                    
                    # Track processing times for monitoring
                    processing_times.append(processing_time)
                    if len(processing_times) > max_samples:
                        processing_times.pop(0)
                    
                    # Send response with simplified performance metrics
                    avg_processing_time = sum(processing_times) / len(processing_times) if processing_times else processing_time
                    actual_fps = 1.0 / processing_time if processing_time > 0 else 1000
                    
                    response = {
                        "type": "detection_response",
                        "session_id": session_id,
                        "faces": faces,
                        "model_used": model_type,
                        "processing_time": processing_time,
                        "timestamp": asyncio.get_event_loop().time(),
                        "frame_dropped": False,
                        "performance_metrics": {
                            "actual_fps": actual_fps,
                            "avg_processing_time": avg_processing_time,
                            "overload_counter": overload_counter,
                            "samples_count": len(processing_times),
                            "queue_size": len(processing_queue),
                            "dropped_frames": dropped_frames,
                            "max_performance_mode": True
                        }
                    }
                    
                    # Debug: Print what we're about to send AND convert numpy types
                    if faces:
                        print(f"[MAIN] SENDING {len(faces)} faces via WebSocket")
                        for i, face in enumerate(faces):
                            print(f"[MAIN] Face {i} keys in response: {list(face.keys())}")
                            print(f"[MAIN] Face {i} track_id: {face.get('track_id')}, type={type(face.get('track_id'))}")
                            
                            # Convert track_id to native Python int if it exists
                            if 'track_id' in face:
                                import numpy as np
                                track_id_value = face['track_id']
                                if isinstance(track_id_value, (np.integer, np.int32, np.int64)):
                                    face['track_id'] = int(track_id_value)
                                    print(f"[MAIN] Converted track_id from numpy to int: {face['track_id']}")
                    
                    await websocket.send_text(json.dumps(response))
                    
                    # Mark processing as complete
                    is_processing = False
                    
                    # NO DELAY - Request next frame immediately for maximum performance
                    # (Removed: await asyncio.sleep(adaptive_delay))
                    
                    # Request next frame for continuous processing
                    next_frame_request = {
                        "type": "request_next_frame",
                        "session_id": session_id,
                        "timestamp": asyncio.get_event_loop().time()
                    }
                    
                    await websocket.send_text(json.dumps(next_frame_request))
                    
                except Exception as e:
                    # Reset processing flag on error
                    is_processing = False
                    
                    error_response = {
                        "type": "error",
                        "message": str(e),
                        "session_id": session_id
                    }
                    await websocket.send_text(json.dumps(error_response))
            
            elif message.get("type") == "ping":
                # Respond to ping
                pong_response = {
                    "type": "pong",
                    "session_id": session_id,
                    "timestamp": asyncio.get_event_loop().time()
                }
                await websocket.send_text(json.dumps(pong_response))
                
    except WebSocketDisconnect:
        manager.disconnect(client_id)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(client_id)

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8700, 
        reload=False,  # Disabled to prevent log file reload loops
        log_level="info"
    )