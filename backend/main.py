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
from models.antispoofing_detector import OptimizedAntiSpoofingDetector
from utils.image_utils import decode_base64_image, encode_image_to_base64
from utils.websocket_manager import manager, handle_websocket_message
from config import YUNET_MODEL_PATH, YUNET_CONFIG, ANTISPOOFING_MODEL_PATH, ANTISPOOFING_CONFIG

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

# Pydantic models for request/response
class DetectionRequest(BaseModel):
    image: str  # Base64 encoded image
    model_type: str = "yunet"
    confidence_threshold: float = 0.6
    nms_threshold: float = 0.3
    enable_antispoofing: bool = True
    antispoofing_threshold: float = 0.5

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
    antispoofing_threshold: float = 0.5

@app.on_event("startup")
async def startup_event():
    """Initialize models on startup"""
    global yunet_detector, optimized_antispoofing_detector
    try:
        logger.info("Initializing YuNet detector...")
        yunet_detector = YuNetDetector(
            model_path=str(YUNET_MODEL_PATH),
            input_size=list(YUNET_CONFIG["input_size"]),
            conf_threshold=YUNET_CONFIG["score_threshold"],
            nms_threshold=YUNET_CONFIG["nms_threshold"]
        )
        
        logger.info("Initializing Optimized Anti-Spoofing detector...")
        optimized_antispoofing_detector = OptimizedAntiSpoofingDetector(
            model_path=str(ANTISPOOFING_MODEL_PATH),
            input_size=ANTISPOOFING_CONFIG["input_size"],
            threshold=ANTISPOOFING_CONFIG["threshold"],
            providers=ANTISPOOFING_CONFIG["providers"],
            max_batch_size=1,
            cache_duration=1.0,
            frame_skip=2
        )
        
        logger.info("All models initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize models: {e}")
        raise

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    logger.info("Shutting down...")

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
    
    if antispoofing_detector:
        models_info["antispoofing"] = {
            "available": True,
            "info": antispoofing_detector.get_model_info()
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
    
    return {
        "models": models_info
    }

class OptimizationRequest(BaseModel):
    frame_skip: int = 2
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
        
        optimized_antispoofing_detector.set_frame_skip(request.frame_skip)
        optimized_antispoofing_detector.cache_duration = request.cache_duration
        
        return {
            "success": True,
            "message": "Optimization settings updated",
            "settings": {
                "frame_skip": request.frame_skip,
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
    
    logger.info(f"Detection request received:")
    logger.info(f"  - Model: {request.model_type}")
    logger.info(f"  - Anti-spoofing enabled: {request.enable_antispoofing}")
    logger.info(f"  - Anti-spoofing threshold: {request.antispoofing_threshold}")
    logger.info(f"  - Image size: {len(request.image)} chars")
    
    try:
        # Decode base64 image
        image = decode_base64_image(request.image)
        logger.info(f"Image decoded successfully: {image.shape}")
        
        # Select detector based on model type
        if request.model_type == "yunet":
            if not yunet_detector:
                raise HTTPException(status_code=500, detail="YuNet model not available")
            
            # Update detector parameters
            yunet_detector.set_confidence_threshold(request.confidence_threshold)
            yunet_detector.set_nms_threshold(request.nms_threshold)
            
            # Perform face detection
            faces = await yunet_detector.detect_async(image)
            logger.info(f"YuNet detected {len(faces)} faces")
            
            # Apply anti-spoofing if enabled and faces detected
            if request.enable_antispoofing and faces and optimized_antispoofing_detector:
                logger.info(f"Starting optimized anti-spoofing processing for {len(faces)} faces")
                optimized_antispoofing_detector.set_threshold(request.antispoofing_threshold)
                
                try:
                    # Use the optimized batch processing method
                    antispoofing_results = await optimized_antispoofing_detector.detect_faces_async(image, faces)
                    logger.info(f"Optimized anti-spoofing completed for {len(antispoofing_results)} faces")
                    
                    # Add anti-spoofing results to each face
                    for i, (face, result) in enumerate(zip(faces, antispoofing_results)):
                        logger.info(f"Face {i+1} anti-spoofing result: {result}")
                        
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
                        logger.info(f"Added antispoofing data to face {i+1}: {face['antispoofing']}")
                        
                except Exception as e:
                    logger.error(f"Anti-spoofing processing failed: {e}")
                    # Don't add anti-spoofing data when processing fails to prevent accumulation
                    # Just return the original face detections without anti-spoofing
                    logger.warning("Anti-spoofing failed - returning faces without anti-spoofing data to prevent accumulation")
            
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported model type: {request.model_type}")
        
        processing_time = time.time() - start_time
        logger.info(f"Detection completed in {processing_time:.3f}s, returning {len(faces)} faces")
        
        # Log final face data for debugging
        for i, face in enumerate(faces):
            has_antispoofing = 'antispoofing' in face
            logger.info(f"Face {i+1} response: has_antispoofing={has_antispoofing}")
            if has_antispoofing:
                logger.info(f"Face {i+1} antispoofing: {face['antispoofing']}")
        
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
    enable_antispoofing: bool = True,
    antispoofing_threshold: float = 0.5
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
                optimized_antispoofing_detector.set_threshold(antispoofing_threshold)
                
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

@app.websocket("/ws/{client_id}")
async def websocket_stream_endpoint(websocket: WebSocket, client_id: str):
    """
    WebSocket endpoint for real-time face detection streaming
    """
    await manager.connect(websocket, client_id)
    session_id = client_id
    
    try:
        while True:
            # Receive data from client
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message.get("type") == "detection_request":
                # Process detection request
                try:
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
                    
                    # Apply anti-spoofing detection if enabled and faces detected
                    enable_antispoofing = message.get("enable_antispoofing", True)
                    antispoofing_threshold = message.get("antispoofing_threshold", 0.5)
                    
                    if enable_antispoofing and faces and optimized_antispoofing_detector:
                        optimized_antispoofing_detector.set_threshold(antispoofing_threshold)
                        
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
                                    logger.info(f"Added antispoofing data to face {i}: {face['antispoofing']}")
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
                    
                    # Send response
                    response = {
                        "type": "detection_response",
                        "session_id": session_id,
                        "faces": faces,
                        "model_used": model_type,
                        "timestamp": asyncio.get_event_loop().time()
                    }
                    
                    await websocket.send_text(json.dumps(response))
                    
                except Exception as e:
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
        logger.info(f"WebSocket client disconnected: {session_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(client_id)

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8001,
        reload=False,  # Disabled to prevent log file reload loops
        log_level="info"
    )