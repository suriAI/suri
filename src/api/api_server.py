# -*- coding: utf-8 -*-
import os
import sys
import json
from datetime import datetime
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("suri.api")

# Initialize FastAPI app
app = FastAPI(
    title="🎯 Suri Attendance Management API",
    description="Lightweight API for attendance logging and database management - ML processing moved to Electron",
    version="3.0.0",
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

# Simple attendance system without ML models
class AttendanceSystem:
    def __init__(self):
        self.attendance_log = []
        self.registered_people = set()
        self._load_attendance_log()
        self._load_registered_people()
    
    def _load_attendance_log(self):
        """Load attendance log from disk"""
        try:
            # Get absolute path to attendance log
            workspace_root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
            log_path = os.path.join(workspace_root, "attendance_log.json")
            
            if os.path.exists(log_path):
                with open(log_path, 'r') as f:
                    self.attendance_log = json.load(f)
        except Exception as e:
            print(f"Failed to load attendance log: {e}")
            self.attendance_log = []
    
    def _load_registered_people(self):
        """Load registered people from attendance log"""
        try:
            for record in self.attendance_log:
                if 'person_id' in record:
                    self.registered_people.add(record['person_id'])
        except Exception as e:
            print(f"Failed to load registered people: {e}")
            self.registered_people = set()
    
    def get_today_attendance(self):
        """Get today's attendance records"""
        today = datetime.now().strftime('%Y-%m-%d')
        return [record for record in self.attendance_log 
                if record.get('date', '').startswith(today)]
    
    def log_attendance(self, person_id, similarity, method="electron_ml"):
        """Log attendance for a person (called from Electron)"""
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
            
            # Add to registered people if not already there
            self.registered_people.add(person_id)
            
            # Save to disk
            workspace_root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
            log_path = os.path.join(workspace_root, "attendance_log.json")
            with open(log_path, 'w') as f:
                json.dump(self.attendance_log, f, indent=2)
            
            return True
        except Exception as e:
            print(f"Failed to log attendance: {e}")
            return False

    def get_all_persons(self):
        """Get list of all registered persons"""
        return list(self.registered_people)

    def add_person(self, person_id: str):
        """Add a new person to the database"""
        try:
            self.registered_people.add(person_id)
            return True
        except Exception as e:
            print(f"Failed to add person: {e}")
            return False

    def remove_person(self, person_id: str):
        """Remove a person from the database"""
        try:
            self.registered_people.discard(person_id)
            return True
        except Exception as e:
            print(f"Failed to remove person: {e}")
            return False

# Initialize the attendance system
attendance_system = AttendanceSystem()

# Pydantic models for request/response
class ApiResponse(BaseModel):
    success: bool
    message: str
    data: Optional[Dict[str, Any]] = None
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
        message="🎯 Suri Attendance Management API v3.0 - ML processing moved to Electron",
        data={
            "version": "3.0.0",
            "ml_processing": "electron",
            "status": "active"
        },
        timestamp=datetime.now().isoformat()
    )

@app.get("/health", response_model=ApiResponse)
async def health_check():
    """Health check endpoint"""
    try:
        return ApiResponse(
            success=True,
            message="API is healthy",
            data={
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

@app.post("/attendance/log", response_model=ApiResponse)
async def log_attendance(person_id: str, similarity: float, method: str = "electron_ml"):
    """
    Log attendance for a person (called from Electron after ML processing)
    """
    try:
        success = attendance_system.log_attendance(person_id, similarity, method)
        
        if success:
            return ApiResponse(
                success=True,
                message=f"Attendance logged for {person_id}",
                data={"person_id": person_id, "similarity": similarity},
                timestamp=datetime.now().isoformat()
            )
        else:
            raise HTTPException(status_code=500, detail="Failed to log attendance")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Log attendance error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/people/add", response_model=ApiResponse)
async def add_person(person_id: str):
    """
    Add a new person to the database
    """
    try:
        success = attendance_system.add_person(person_id)
        
        if success:
            return ApiResponse(
                success=True,
                message=f"Person '{person_id}' added successfully",
                data={"person_id": person_id},
                timestamp=datetime.now().isoformat()
            )
        else:
            raise HTTPException(status_code=500, detail="Failed to add person")
            
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
                    "ml_processing": "electron"
                },
                "attendance_stats": {
                    "total_records": total_records,
                    "today_records": today_records,
                    "unique_people_today": len(today_people)
                },
                "system_info": {
                    "api_version": "3.0.0",
                    "ml_processing": "electron",
                    "backend_role": "attendance_management"
                }
            },
            timestamp=datetime.now().isoformat()
        )
    except Exception as e:
        logger.error(f"Get stats error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/system/stats", response_model=ApiResponse)
async def get_system_stats_endpoint():
    """
    Get system statistics for the frontend dashboard
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
                "legacy_faces": 0,  # For backward compatibility
                "template_count": people_count,  # Number of people in database
                "people_count": people_count,
                "today_attendance": today_records,
                "total_attendance": total_records,
                "ml_processing": "electron"
            },
            timestamp=datetime.now().isoformat()
        )
    except Exception as e:
        logger.error(f"Get system stats error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Startup event
@app.on_event("startup")
async def startup_event():
    """Initialize system on startup"""
    logger.info(f"📊 Database: {len(attendance_system.get_all_persons())} people registered")
    logger.info("🚀 API ready for attendance management")

# Shutdown event
@app.on_event("shutdown")
async def shutdown_event():
    """Clean up on shutdown"""
    logger.info("🛑 Suri Attendance Management API shutting down...")
    logger.info("✅ Shutdown complete")
