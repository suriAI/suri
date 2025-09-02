# -*- coding: utf-8 -*-
from collections import defaultdict
import os
import sys

# Set environment variables for UTF-8 encoding on Windows
if sys.platform.startswith('win'):
    os.environ['PYTHONIOENCODING'] = 'utf-8'

# Add the workspace root directory to the path so we can import models
workspace_root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
sys.path.insert(0, workspace_root)

import base64
import json
from fastapi import FastAPI, File, UploadFile, HTTPException, Form, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import cv2
import numpy as np
import time
import threading
from datetime import datetime, timezone

# Import the new SCRFD + EdgeFace pipeline
from models import SCRFD, EdgeFace, FaceDatabase

import queue
import logging

# Import the new WebSocket implementation
from src.websocket import connection_manager, websocket_endpoint, set_attendance_system

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("suri.api")

# Initialize FastAPI app
app = FastAPI(
    title="🎯 Enterprise Face Recognition API",
    description="Production-ready Face Recognition Attendance System with SCRFD + EdgeFace",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize the new SCRFD + EdgeFace pipeline
class AttendanceSystem:
    def __init__(self):
        self.detector = None
        self.recognizer = None
        self.face_db = None
        self.attendance_log = []
        self._initialize_models()
        self._load_attendance_log()
    
    def _initialize_models(self):
        """Initialize SCRFD detection and EdgeFace recognition models"""
        try:
            print("Loading SCRFD detection model...")
            self.detector = SCRFD(
                model_path="weights/det_500m.onnx",
                conf_thres=0.5,
                iou_thres=0.4
            )
            
            print("Loading EdgeFace recognition model...")
            self.recognizer = EdgeFace(model_path="weights/edgeface-recognition.onnx")
            
            print("Initializing face database...")
            self.face_db = FaceDatabase(similarity_threshold=0.6)
            
            print("Attendance system initialized with SCRFD + EdgeFace pipeline!")
        except Exception as e:
            print(f"Failed to initialize attendance system: {e}")
            raise
    
    def _load_attendance_log(self):
        """Load attendance log from disk"""
        try:
            if os.path.exists("attendance_log.json"):
                with open("attendance_log.json", 'r') as f:
                    self.attendance_log = json.load(f)
        except Exception as e:
            print(f"Failed to load attendance log: {e}")
            self.attendance_log = []
    
    def get_today_attendance(self):
        """Get today's attendance records"""
        today = datetime.now().strftime('%Y-%m-%d')
        return [record for record in self.attendance_log 
                if record.get('date', '').startswith(today)]
    
    def log_attendance(self, person_id, similarity, method="scrfd_edgeface"):
        """Log attendance for a person"""
        try:
            record = {
                'person_id': person_id,
                'name': person_id,  # For backward compatibility
                'timestamp': datetime.now().isoformat(),
                'date': datetime.now().strftime('%Y-%m-%d'),
                'time': datetime.now().strftime('%H:%M:%S'),
                'similarity': float(similarity),
                'confidence': float(similarity),  # For backward compatibility
                'method': method
            }
            self.attendance_log.append(record)
            
            # Save to disk
            with open("attendance_log.json", 'w') as f:
                json.dump(self.attendance_log, f, indent=2)
            
            return True
        except Exception as e:
            print(f"Failed to log attendance: {e}")
            return False

    def process_image_for_recognition(self, image: np.ndarray):
        """Process image for face recognition using SCRFD + EdgeFace"""
        results = []
        
        try:
            # Detect faces using SCRFD
            detections, keypoints = self.detector.detect(image)
            
            if detections is None or len(detections) == 0:
                return results
                
            # Process each detected face
            for i, (detection, kps) in enumerate(zip(detections, keypoints)):
                x1, y1, x2, y2, conf = detection
                x1, y1, x2, y2 = map(int, [x1, y1, x2, y2])
                
                result = {
                    'bbox': [x1, y1, x2, y2],
                    'confidence': float(conf),
                    'person_id': None,
                    'similarity': 0.0,
                    'status': 'unknown'
                }
                
                # Perform face recognition if keypoints are available
                if kps is not None and len(kps) >= 5:
                    try:
                        # Extract face embedding
                        embedding = self.recognizer(image, kps)
                        
                        # Identify face
                        person_id, similarity = self.face_db.identify_face(embedding)
                        
                        if person_id is not None:
                            result['person_id'] = person_id
                            result['similarity'] = float(similarity)
                            result['status'] = 'recognized'
                        else:
                            result['status'] = 'unknown'
                            
                    except Exception as e:
                        print(f"Recognition error: {e}")
                        result['status'] = 'error'
                
                results.append(result)
        
        except Exception as e:
            print(f"Image processing error: {e}")
        
        return results

    def add_person_to_database(self, person_id: str, image: np.ndarray):
        """Add a new person to the face database"""
        try:
            # Detect face in the image
            detections, keypoints = self.detector.detect(image)
            
            if detections is None or len(detections) == 0:
                return False, "No face detected in image"
            
            # Use the first (largest) detection
            detection, kps = detections[0], keypoints[0]
            
            if kps is None or len(kps) < 5:
                return False, "Insufficient facial landmarks detected"
            
            # Extract embedding
            embedding = self.recognizer(image, kps)
            
            # Add to database
            self.face_db.add_person(person_id, embedding)
            
            return True, "Person added successfully"
            
        except Exception as e:
            return False, f"Failed to add person: {str(e)}"

    def get_all_persons(self):
        """Get list of all registered persons"""
        return self.face_db.get_all_persons()

    def remove_person(self, person_id: str):
        """Remove a person from the database"""
        return self.face_db.remove_person(person_id)

# Initialize the new attendance system globally
attendance_system = AttendanceSystem()

# Set the attendance system for WebSocket handlers
set_attendance_system(attendance_system)

# Pydantic models for request/response
class ApiResponse(BaseModel):
    success: bool
    message: str
    data: Optional[Dict[str, Any]] = None
    timestamp: str

class FaceRecognitionResponse(BaseModel):
    success: bool
    faces: List[Dict[str, Any]]
    processing_time: float
    timestamp: str

class AttendanceRecord(BaseModel):
    person_id: str
    name: str
    timestamp: str
    similarity: float
    method: str

# API Routes

@app.get("/", response_model=ApiResponse)
async def root():
    """Root endpoint - API status"""
    return ApiResponse(
        success=True,
        message="🎯 Suri Face Recognition API v2.0 - SCRFD + EdgeFace Pipeline",
        data={
            "version": "2.0.0",
            "pipeline": "SCRFD + EdgeFace",
            "status": "active"
        },
        timestamp=datetime.now().isoformat()
    )

@app.get("/health", response_model=ApiResponse)
async def health_check():
    """Health check endpoint"""
    try:
        # Check if models are loaded
        models_ready = (attendance_system.detector is not None and 
                       attendance_system.recognizer is not None and 
                       attendance_system.face_db is not None)
        
        return ApiResponse(
            success=True,
            message="API is healthy",
            data={
                "models_loaded": models_ready,
                "people_in_database": len(attendance_system.get_all_persons()),
                "total_attendance_records": len(attendance_system.attendance_log)
            },
            timestamp=datetime.now().isoformat()
        )
    except Exception as e:
        return ApiResponse(
            success=False,
            message=f"Health check failed: {str(e)}",
            timestamp=datetime.now().isoformat()
        )

@app.post("/recognize", response_model=FaceRecognitionResponse)
async def recognize_face(file: UploadFile = File(...)):
    """
    Recognize faces in uploaded image using SCRFD + EdgeFace
    """
    try:
        # Read image
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if image is None:
            raise HTTPException(status_code=400, detail="Invalid image format")
        
        start_time = time.time()
        
        # Process image for recognition
        results = attendance_system.process_image_for_recognition(image)
        
        processing_time = time.time() - start_time
        
        return FaceRecognitionResponse(
            success=True,
            faces=results,
            processing_time=processing_time,
            timestamp=datetime.now().isoformat()
        )
        
    except Exception as e:
        logger.error(f"Face recognition error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/add_person", response_model=ApiResponse)
async def add_person(
    person_id: str = Form(...),
    file: UploadFile = File(...)
):
    """
    Add a new person to the face database
    """
    try:
        # Read image
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if image is None:
            raise HTTPException(status_code=400, detail="Invalid image format")
        
        success, message = attendance_system.add_person_to_database(person_id, image)
        
        if success:
            return ApiResponse(
                success=True,
                message=message,
                data={"person_id": person_id},
                timestamp=datetime.now().isoformat()
            )
        else:
            raise HTTPException(status_code=400, detail=message)
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Add person error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/people", response_model=ApiResponse)
async def get_all_people():
    """
    Get list of all registered people
    """
    try:
        people = attendance_system.get_all_persons()
        return ApiResponse(
            success=True,
            message=f"Retrieved {len(people)} registered people",
            data={"people": people, "count": len(people)},
            timestamp=datetime.now().isoformat()
        )
    except Exception as e:
        logger.error(f"Get people error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/people/{person_id}", response_model=ApiResponse)
async def remove_person(person_id: str):
    """
    Remove a person from the database
    """
    try:
        success = attendance_system.remove_person(person_id)
        
        if success:
            return ApiResponse(
                success=True,
                message=f"Person '{person_id}' removed successfully",
                data={"person_id": person_id},
                timestamp=datetime.now().isoformat()
            )
        else:
            raise HTTPException(status_code=404, detail=f"Person '{person_id}' not found")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Remove person error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/attendance/today", response_model=ApiResponse)
async def get_today_attendance():
    """
    Get today's attendance records
    """
    try:
        today_records = attendance_system.get_today_attendance()
        unique_people = set(record['person_id'] for record in today_records)
        
        return ApiResponse(
            success=True,
            message=f"Retrieved {len(today_records)} attendance records for today",
            data={
                "date": datetime.now().strftime('%Y-%m-%d'),
                "total_records": len(today_records),
                "unique_people": len(unique_people),
                "people_present": list(unique_people),
                "records": today_records
            },
            timestamp=datetime.now().isoformat()
        )
    except Exception as e:
        logger.error(f"Get attendance error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/attendance/all", response_model=ApiResponse)
async def get_all_attendance():
    """
    Get all attendance records
    """
    try:
        all_records = attendance_system.attendance_log
        
        return ApiResponse(
            success=True,
            message=f"Retrieved {len(all_records)} total attendance records",
            data={
                "total_records": len(all_records),
                "records": all_records
            },
            timestamp=datetime.now().isoformat()
        )
    except Exception as e:
        logger.error(f"Get all attendance error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/models/warmup", response_model=ApiResponse)
async def warmup_models():
    """
    Warm up the SCRFD + EdgeFace models for faster inference
    """
    try:
        # Do a quick dummy inference to warm up the models
        if attendance_system.detector and attendance_system.recognizer:
            dummy_frame = np.zeros((480, 640, 3), dtype=np.uint8)
            detections, keypoints = attendance_system.detector.detect(dummy_frame)
            
            # Try recognition if we have dummy keypoints
            if keypoints is not None and len(keypoints) > 0:
                dummy_kps = np.array([[30, 30], [80, 30], [55, 55], [35, 75], [75, 75]], dtype=np.float32)
                try:
                    _ = attendance_system.recognizer(dummy_frame, dummy_kps)
                except:
                    pass  # Expected to fail on dummy data
            
            return ApiResponse(
                success=True,
                message="Models warmed up successfully",
                data={"pipeline": "SCRFD + EdgeFace"},
                timestamp=datetime.now().isoformat()
            )
        else:
            raise HTTPException(status_code=500, detail="Models not properly initialized")
            
    except Exception as e:
        logger.error(f"Model warmup error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/stats", response_model=ApiResponse)
async def get_system_stats():
    """
    Get comprehensive system statistics
    """
    try:
        people_count = len(attendance_system.get_all_persons())
        total_records = len(attendance_system.attendance_log)
        today_records = len(attendance_system.get_today_attendance())
        
        # Get unique people seen today
        today_people = set()
        for record in attendance_system.get_today_attendance():
            today_people.add(record['person_id'])
        
        return ApiResponse(
            success=True,
            message="System statistics retrieved successfully",
            data={
                "database_stats": {
                    "total_people": people_count,
                    "pipeline": "SCRFD + EdgeFace"
                },
                "attendance_stats": {
                    "total_records": total_records,
                    "today_records": today_records,
                    "unique_people_today": len(today_people)
                },
                "system_info": {
                    "api_version": "2.0.0",
                    "detection_model": "SCRFD",
                    "recognition_model": "EdgeFace-S"
                }
            },
            timestamp=datetime.now().isoformat()
        )
    except Exception as e:
        logger.error(f"Get stats error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# WebSocket endpoint
@app.websocket("/ws")
async def websocket_endpoint_handler(websocket: WebSocket):
    """WebSocket endpoint for real-time communication"""
    await websocket_endpoint(websocket)

# Startup event
@app.on_event("startup")
async def startup_event():
    """Initialize system on startup"""
    logger.info("🎯 Suri Face Recognition API v2.0 starting up...")
    logger.info("✅ SCRFD + EdgeFace pipeline initialized")
    logger.info(f"📊 Database: {len(attendance_system.get_all_persons())} people registered")
    logger.info("🚀 API ready for requests")

# Shutdown event
@app.on_event("shutdown")
async def shutdown_event():
    """Clean up on shutdown"""
    logger.info("🛑 Suri Face Recognition API shutting down...")
    # Any cleanup code here
    logger.info("✅ Shutdown complete")
