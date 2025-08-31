# -*- coding: utf-8 -*-
from collections import defaultdict
import os
import sys

# Set environment variables for UTF-8 encoding on Windows
if sys.platform.startswith('win'):
    os.environ['PYTHONIOENCODING'] = 'utf-8'

# Add the workspace root directory to the path so we can import from experiments
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

# Import your optimized prototype system
from experiments.prototype.main import (
    Main, 
    preprocess_yolo,
    non_max_suppression,
    yolo_sess,
    input_size,
    conf_thresh,
    iou_thresh,
    live_camera_recognition
)

# Import your enhanced utilities
from experiments.prototype.utils import calculate_quality_score

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
    description="Production-ready Face Recognition Attendance System with advanced features",
    version="1.0.0",
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

# Initialize your attendance system globally
attendance_system = Main()

# Set the attendance system for WebSocket handlers
set_attendance_system(attendance_system)

# Pydantic models for request/response
class RecognitionResult(BaseModel):
    name: Optional[str]
    confidence: float
    bbox: List[int]
    quality: float
    method: str
    should_log: bool
    additional_info: Dict[str, Any] = {}

class AttendanceRecord(BaseModel):
    name: str
    timestamp: str
    confidence: float
    date: str
    time: str
    recognition_info: Optional[Dict[str, Any]] = None

class PersonSummary(BaseModel):
    name: str
    num_templates: int
    in_legacy: bool
    total_attempts: Optional[int] = None
    total_successes: Optional[int] = None
    overall_success_rate: Optional[float] = None

class ApiResponse(BaseModel):
    success: bool
    message: str
    data: Optional[Any] = None
    error: Optional[str] = None

class ThresholdUpdate(BaseModel):
    name: str
    threshold: float

# Utility functions
def decode_image(image_data: str) -> np.ndarray:
    """Decode base64 image to OpenCV format"""
    try:
        # Remove data URL prefix if present
        if ',' in image_data:
            image_data = image_data.split(',')[1]
        
        # Decode base64
        image_bytes = base64.b64decode(image_data)
        nparr = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        return image
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image data: {str(e)}")

def encode_image(image: np.ndarray) -> str:
    """Encode OpenCV image to base64"""
    try:
        _, buffer = cv2.imencode('.jpg', image)
        image_base64 = base64.b64encode(buffer).decode('utf-8')
        return f"data:image/jpeg;base64,{image_base64}"
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to encode image: {str(e)}")

async def process_uploaded_file(file: UploadFile) -> np.ndarray:
    """Process uploaded file to OpenCV image"""
    try:
        # Read file content
        content = await file.read()
        nparr = np.frombuffer(content, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if image is None:
            raise HTTPException(status_code=400, detail="Invalid image file")
        
        return image
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to process image: {str(e)}")

# Global variables for video streaming
frame_queue = queue.Queue(maxsize=2)
streaming_active = False
camera_thread = None
camera_lock = threading.Lock()

class CameraManager:
    """Persistent camera manager with background frame grabbing.

    Avoids reopening the camera for every request (which is slow and unstable on Windows/MSMF).
    Provides latest frame to endpoints. Uses DirectShow backend on Windows for stability.
    """
    def __init__(self):
        self.cap: Optional[cv2.VideoCapture] = None
        self.device: int = 0
        self.thread: Optional[threading.Thread] = None
        self.running: bool = False
        self.latest_frame: Optional[np.ndarray] = None
        self.last_ts: float = 0.0
        self.frame_lock = threading.Lock()

    def _open(self, device: Optional[int] = None) -> bool:
        dev = device if device is not None else self.device
        try:
            # Prefer DirectShow on Windows to avoid MSMF issues seen in logs
            if os.name == 'nt':
                cap = cv2.VideoCapture(dev, cv2.CAP_DSHOW)
            else:
                cap = cv2.VideoCapture(dev)

            if not cap or not cap.isOpened():
                return False

            configure_camera_settings(cap)
            self.cap = cap
            self.device = dev
            return True
        except Exception as e:
            print(f"[DEBUG] Camera open failed: {e}")
            return False

    def _grab_loop(self):
        consecutive_failures = 0
        while self.running:
            cap = self.cap
            if cap is None or not cap.isOpened():
                time.sleep(0.1)
                continue
            try:
                ret, frame = cap.read()
                if ret and frame is not None and frame.size > 0:
                    with self.frame_lock:
                        self.latest_frame = frame
                        self.last_ts = time.time()
                    consecutive_failures = 0
                else:
                    consecutive_failures += 1
                    if consecutive_failures >= 10:
                        # Try to reinitialize the camera
                        try:
                            cap.release()
                        except Exception:
                            pass
                        self.cap = None
                        if not self._open(self.device):
                            time.sleep(0.5)
                        consecutive_failures = 0
                    else:
                        time.sleep(0.01)
            except Exception as e:
                print(f"[DEBUG] Camera grab error: {e}")
                time.sleep(0.05)

    def start(self, device: Optional[int] = None) -> bool:
        with camera_lock:
            if self.running:
                # If device changed, try reopening
                if device is not None and device != self.device:
                    self.stop()
                else:
                    return True

            if not self._open(device):
                return False

            self.running = True
            self.thread = threading.Thread(target=self._grab_loop, name="CameraGrabber", daemon=True)
            self.thread.start()
            return True

    def ensure_started(self, device: Optional[int] = None) -> bool:
        if not self.running:
            return self.start(device)
        return True

    def get_frame(self, timeout: float = 0.5) -> Optional[np.ndarray]:
        # Wait briefly for a new frame if none yet
        t0 = time.time()
        while time.time() - t0 < timeout:
            with self.frame_lock:
                if self.latest_frame is not None:
                    # Return a copy to avoid mutation across threads
                    return self.latest_frame.copy()
            time.sleep(0.01)
        return None

    def stop(self):
        with camera_lock:
            self.running = False
            try:
                if self.thread and self.thread.is_alive():
                    self.thread.join(timeout=0.5)
            except Exception:
                pass
            try:
                if self.cap is not None:
                    self.cap.release()
            finally:
                self.cap = None
                self.thread = None
                self.latest_frame = None
                self.last_ts = 0.0

camera_manager = CameraManager()
import asyncio

# Helper function for backward compatibility with existing broadcast calls
async def ws_broadcast(event: Dict[str, Any]):
    """Broadcast event to all connected WebSocket clients using the new connection manager."""
    try:
        await connection_manager.broadcast(event)
        logger.info(f"WebSocket event broadcasted: {event.get('type', 'unknown')}")
    except Exception as e:
        logger.error(f"Failed to broadcast WebSocket event: {e}")


# Global function to broadcast attendance events from video worker
def broadcast_attendance_event(event_data: Dict[str, Any]):
    """
    Broadcast attendance events from video worker to WebSocket clients.
    This is called synchronously from video worker subprocess via stderr parsing.
    """
    try:
        # Convert to async call using the event loop
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # If we're in an async context, schedule the broadcast
            asyncio.create_task(connection_manager.broadcast(event_data))
        else:
            # If not in async context, run the broadcast
            loop.run_until_complete(connection_manager.broadcast(event_data))
    except Exception as e:
        logger.error(f"Failed to broadcast attendance event: {e}")


def process_video_worker_stderr(stderr_line: str):
    """
    Process stderr line from video worker and extract WebSocket broadcast events.
    
    This function parses stderr output from the video worker subprocess and
    extracts WebSocket broadcast events that need to be forwarded to clients.
    """
    try:
        # Check if this is a WebSocket broadcast event
        if stderr_line.startswith("WS_BROADCAST "):
            # Extract JSON data after the prefix
            json_data = stderr_line[13:]  # Remove "WS_BROADCAST " prefix
            event_wrapper = json.loads(json_data)
            
            # Extract the actual event data
            if event_wrapper.get("type") == "websocket_broadcast":
                event_data = event_wrapper.get("event", {})
                
                # Broadcast to WebSocket clients
                broadcast_attendance_event(event_data)
                logger.info(f"Forwarded video worker WebSocket event: {event_data.get('type', 'unknown')}")
        
    except Exception as e:
        logger.error(f"Failed to process video worker stderr: {e}")


# Global function to handle video worker subprocess communication
def setup_video_worker_websocket_bridge():
    """
    Setup bridge to capture video worker WebSocket events and forward them to clients.
    
    This function can be called when spawning the video worker subprocess to
    monitor its stderr for WebSocket broadcast events.
    """
    logger.info("Video worker WebSocket bridge setup complete")

# --- Camera helpers ---
# Simplified camera functions to match your prototype
def test_camera(cap: cv2.VideoCapture, retries: int = 3) -> bool:
    """Simple camera test like your prototype"""
    if not cap.isOpened():
        return False
    ret, frame = cap.read()
    return ret and frame is not None

def try_camera_index(idx: int, api_pref: Optional[int] = None) -> Optional[cv2.VideoCapture]:
    """Simple camera opening - just try the basic VideoCapture"""
    try:
        print(f"[DEBUG] Trying camera {idx}")
        cap = cv2.VideoCapture(idx)
        
        if cap.isOpened() and test_camera(cap):
            print(f"[DEBUG] Successfully opened camera {idx}")
            return cap
        
        if cap:
            cap.release()
    except Exception as e:
        print(f"[DEBUG] Failed to open camera {idx}: {e}")
    
    return None

# Use your prototype's simple camera opening approach
def open_camera(prefer: Optional[int] = None, api_pref: Optional[int] = None) -> cv2.VideoCapture:
    """Open camera with a stable backend. Prefer DirectShow on Windows."""
    device = prefer if prefer is not None else 0
    try:
        if os.name == 'nt':
            cap = cv2.VideoCapture(device, cv2.CAP_DSHOW)
        else:
            cap = cv2.VideoCapture(device)
    except Exception:
        cap = cv2.VideoCapture(device)

    if cap.isOpened():
        configure_camera_settings(cap)
    return cap

def configure_camera_settings(cap: cv2.VideoCapture) -> None:
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)
        cap.set(cv2.CAP_PROP_FPS, 30)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        
        try:
            cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc('M', 'J', 'P', 'G'))
            cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 1.0)
            print(f"[DEBUG] Camera essential settings applied (preserving user color settings)")
        except Exception as e:
            print(f"[DEBUG] Could not set essential properties: {e}")
        
        try:
            cap.set(cv2.CAP_PROP_AUTOFOCUS, 1)
        except:
            pass
        
        print(f"[DEBUG] Camera optimized for streaming - Resolution: {int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))}x{int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))}, FPS: {cap.get(cv2.CAP_PROP_FPS)}")
    except Exception as e:
        print(f"[DEBUG] Could not configure camera settings: {e}")

def robust_frame_read(cap: cv2.VideoCapture, max_retries: int = 5) -> tuple[bool, Optional[np.ndarray]]:
    """Robust frame reading with retry logic and error handling."""
    for attempt in range(max_retries):
        try:
            ret, frame = cap.read()
            if ret and frame is not None and frame.size > 0:
                # Verify frame has reasonable dimensions
                if frame.shape[0] > 10 and frame.shape[1] > 10:
                    return True, frame
            
            # Wait briefly before retry
            time.sleep(0.05)  # 50ms delay
            
        except Exception as e:
            print(f"[DEBUG] Frame read attempt {attempt + 1} failed: {e}")
            if attempt < max_retries - 1:
                time.sleep(0.1)
    
    return False, None

def detect_available_cameras(max_index: int = 10) -> list[dict]:
    """Enhanced camera detection - scans multiple indices and backends"""
    found = []
    
    # Test multiple camera indices
    for idx in range(max_index):
        camera_info = test_camera_device(idx)
        if camera_info:
            found.append(camera_info)
    
    # If no cameras found with standard method, try alternative backends on Windows
    if not found and os.name == 'nt':
        print("[DEBUG] No cameras found with default backend, trying DirectShow...")
        for idx in range(max_index):
            camera_info = test_camera_device(idx, cv2.CAP_DSHOW)
            if camera_info:
                found.append(camera_info)
    
    return found

def test_camera_device(idx: int, backend: Optional[int] = None) -> Optional[dict]:
    """Test a specific camera device and return info if it works"""
    cap = None
    try:
        print(f"[DEBUG] Testing camera {idx} with backend {backend or 'default'}")
        
        # Try to open camera with specified backend
        if backend is not None:
            cap = cv2.VideoCapture(idx, backend)
        else:
            cap = cv2.VideoCapture(idx)
        
        if not cap or not cap.isOpened():
            return None
        
        # Try to read a frame to verify camera actually works
        ret, frame = cap.read()
        if not ret or frame is None or frame.size == 0:
            return None
        
        # Get camera properties for additional info
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        
        backend_name = "default"
        if backend == cv2.CAP_DSHOW:
            backend_name = "DirectShow"
        elif backend == cv2.CAP_V4L2:
            backend_name = "V4L2"
        elif backend == cv2.CAP_GSTREAMER:
            backend_name = "GStreamer"
        
        print(f"[DEBUG] Camera {idx} working: {width}x{height} @ {fps}fps")
        
        return {
            "index": idx,
            "backend": backend_name,
            "backend_id": backend,
            "works": True,
            "width": width,
            "height": height,
            "fps": fps
        }
        
    except Exception as e:
        print(f"[DEBUG] Camera {idx} failed: {e}")
        return None
    finally:
        if cap:
            try:
                cap.release()
            except Exception:
                pass

def get_camera_friendly_names() -> dict[int, str]:
    """Get friendly names for camera devices across different platforms.
    Returns a dictionary mapping camera index to friendly name.
    """
    names = {}
    
    if os.name == 'nt':  # Windows
        names.update(get_windows_camera_names())
    elif os.name == 'posix':  # Linux/macOS
        names.update(get_unix_camera_names())
    
    return names

def get_windows_camera_names() -> dict[int, str]:
    """Enhanced Windows camera name detection with multiple fallback methods"""
    names = {}
    
    try:
        import subprocess
        # Method 1: Enhanced PowerShell query with device enumeration
        ps_cmd = [
            'powershell',
            '-NoProfile',
            '-Command',
            '''
            $cameras = Get-CimInstance Win32_PnPEntity | Where-Object { 
                $_.PNPClass -eq "Camera" -or 
                $_.Name -match "Webcam|Camera|USB Video|Integrated Camera" 
            } | Select-Object Name, DeviceID, Status | Sort-Object Name
            
            $index = 0
            foreach ($cam in $cameras) {
                if ($cam.Status -eq "OK" -or $cam.Status -eq $null) {
                    Write-Output "$index|$($cam.Name)"
                    $index++
                }
            }
            '''
        ]
        
        out = subprocess.check_output(ps_cmd, stderr=subprocess.DEVNULL, text=True, encoding='utf-8', timeout=5)
        
        for line in out.splitlines():
            if line.strip() and '|' in line:
                try:
                    index_str, name = line.strip().split('|', 1)
                    index = int(index_str)
                    clean_name = clean_camera_name(name)
                    if clean_name:
                        names[index] = clean_name
                except (ValueError, IndexError):
                    continue
                    
    except Exception as e:
        print(f"[DEBUG] Enhanced PowerShell camera query failed: {e}")
        
        # Fallback to simple method
        try:
            ps_cmd_simple = [
                'powershell',
                '-NoProfile', 
                '-Command',
                "Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPClass -eq 'Camera' -or $_.Name -match 'Webcam|Camera|USB Video' } | Select-Object -ExpandProperty Name"
            ]
            out = subprocess.check_output(ps_cmd_simple, stderr=subprocess.DEVNULL, text=True, encoding='utf-8', timeout=3)
            raw_names = [line.strip() for line in out.splitlines() if line.strip()]
            
            # Map to indices
            for i, name in enumerate(raw_names):
                clean_name = clean_camera_name(name)
                if clean_name:
                    names[i] = clean_name
                    
        except Exception as e2:
            print(f"[DEBUG] Fallback PowerShell query also failed: {e2}")
    
    # If still no names found, try WMI
    if not names:
        try:
            import subprocess
            wmic_result = subprocess.run([
                'wmic', 'path', 'Win32_PnPEntity', 'where', 
                'PNPClass="Camera" OR Name LIKE "%camera%" OR Name LIKE "%webcam%"', 
                'get', 'Name', '/format:list'
            ], capture_output=True, text=True, timeout=10)
            
            if wmic_result.returncode == 0:
                device_index = 0
                for line in wmic_result.stdout.split('\n'):
                    if line.startswith('Name=') and len(line) > 5:
                        device_name = clean_camera_name(line[5:].strip())
                        if device_name:
                            names[device_index] = device_name
                            device_index += 1
        except Exception as e:
            print(f"[DEBUG] WMI camera query failed: {e}")
    
    return names

def get_unix_camera_names() -> dict[int, str]:
    """Get camera names on Linux/macOS systems"""
    names = {}
    
    try:
        # Linux V4L2 devices
        if os.path.exists('/sys/class/video4linux'):
            device_index = 0
            for device_dir in sorted(os.listdir('/sys/class/video4linux')):
                if device_dir.startswith('video'):
                    try:
                        name_file = f'/sys/class/video4linux/{device_dir}/name'
                        if os.path.exists(name_file):
                            with open(name_file, 'r') as f:
                                device_name = f.read().strip()
                                if device_name:
                                    names[device_index] = clean_camera_name(device_name)
                                    device_index += 1
                    except Exception:
                        continue
        
        # macOS - try system_profiler
        elif hasattr(os, 'uname') and os.uname().sysname == 'Darwin':
            try:
                import subprocess
                result = subprocess.run([
                    'system_profiler', 'SPCameraDataType', '-json'
                ], capture_output=True, text=True, timeout=10)
                
                if result.returncode == 0:
                    import json
                    data = json.loads(result.stdout)
                    device_index = 0
                    for item in data.get('SPCameraDataType', []):
                        if '_name' in item:
                            device_name = clean_camera_name(item['_name'])
                            names[device_index] = device_name
                            device_index += 1
            except Exception as e:
                print(f"[DEBUG] macOS camera detection failed: {e}")
                
    except Exception as e:
        print(f"[DEBUG] Unix camera name detection failed: {e}")
    
    return names

def clean_camera_name(name: str) -> str:
    """Clean and standardize camera device names"""
    if not name or name.strip() == "":
        return ""
    
    # Remove common unnecessary parts
    name = name.strip()
    
    # Common replacements for better readability
    replacements = {
        'USB\\VID_': '',
        'USB Video Device': 'USB Camera',
        'Integrated Webcam': 'Built-in Camera',
        'Integrated Camera': 'Built-in Camera',
        'HD WebCam': 'HD Camera',
        'USB2.0 Camera': 'USB Camera',
        'UVC Camera': 'USB Camera'
    }
    
    for old, new in replacements.items():
        name = name.replace(old, new)
    
    # Remove duplicate words
    words = name.split()
    seen = set()
    cleaned_words = []
    for word in words:
        word_lower = word.lower()
        if word_lower not in seen:
            seen.add(word_lower)
            cleaned_words.append(word)
    
    cleaned_name = " ".join(cleaned_words)
    
    # Ensure it ends with "Camera" or "Webcam" for clarity
    lower_name = cleaned_name.lower()
    if not any(term in lower_name for term in ['camera', 'webcam', 'cam']):
        cleaned_name += ' Camera'
    
    return cleaned_name

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

# WebSocket Implementation using the new production-ready system
@app.websocket("/ws")
async def ws_route(websocket: WebSocket):
    """
    Production-ready WebSocket endpoint for real-time communication.
    
    Supports JSON protocol with structured requests/responses:
    {
        "id": "unique-request-id", 
        "action": "action_name",
        "payload": {}
    }
    
    Available actions: ping, get_version, sync_data, echo, get_system_status
    """
    await websocket_endpoint(websocket)

# API Endpoints

@app.get("/", response_model=ApiResponse)
async def root():
    """API health check and info"""
    return ApiResponse(
        success=True,
        message="🎯 Enterprise Face Recognition API is running!",
        data={
            "version": "1.0.0",
            "features": [
                "Face Detection & Recognition",
                "Multi-template Management",
                "Attendance Logging",
                "Real-time Processing",
                "Quality Assessment"
            ],
            "endpoints": {
                "recognition": "/recognize",
                "attendance": "/attendance",
                "management": "/person",
                "system": "/system"
            }
        }
    )

@app.post("/recognize/image", response_model=Dict[str, Any])
async def recognize_from_image(file: UploadFile = File(...)):
    """
    🖼️ Recognize faces from uploaded image
    
    Upload an image file and get face recognition results with bounding boxes.
    """
    try:
        # Process uploaded image
        frame = await process_uploaded_file(file)
        orig = frame.copy()
        h, w = frame.shape[:2]
        
        # Run YOLO detection
        input_blob, scale, dx, dy = preprocess_yolo(frame)
        preds = yolo_sess.run(None, {'images': input_blob})[0]
        faces = non_max_suppression(preds, conf_thresh, iou_thresh, 
                                   img_shape=(h, w), input_shape=(input_size, input_size), 
                                   pad=(dx, dy), scale=scale)

        scene_crowding = len(faces)
        results = []
        
        # Process each detected face
        new_records = []
        for i, box in enumerate(faces):
            x1, y1, x2, y2, conf = box
            
            if x2 <= x1 or y2 <= y1:
                continue

            face_img = orig[y1:y2, x1:x2]
            if face_img.size == 0:
                continue
            
            # Calculate quality and identify - USING YOUR EXACT LOGIC
            quality = calculate_quality_score(face_img, conf)
            identified_name, similarity, should_log, info = attendance_system.identify_face_enhanced(
                face_img, conf, scene_crowding
            )
            
            # Log attendance if recognized - USING YOUR EXACT METHOD
            attendance_logged = False
            if identified_name and should_log:
                attendance_logged = attendance_system.log_attendance(identified_name, similarity, info)
                if attendance_logged:
                    # try to capture last log entry
                    try:
                        new_records.append(attendance_system.attendance_log[-1])
                    except Exception:
                        pass
            
            # Create result
            result = {
                "face_id": i + 1,
                "name": identified_name,
                "confidence": float(similarity),
                "bbox": [int(x1), int(y1), int(x2), int(y2)],
                "quality": float(quality),
                "method": info.get('method', 'unknown'),
                "should_log": should_log,
                "attendance_logged": attendance_logged,
                "additional_info": info
            }
            results.append(result)
            
            # Draw on image for visualization - USING YOUR EXACT DRAWING STYLE
            if identified_name and should_log:
                color = (0, 255, 0)  # Green for recognized
                method_text = info.get('method', 'unknown')[:8]
                
                # Check data types like in your run.py
                person_summary = attendance_system.get_person_summary(identified_name)
                data_types = []
                if person_summary['in_legacy']:
                    data_types.append("L")
                if person_summary['num_templates'] > 0:
                    data_types.append(f"T{person_summary['num_templates']}")
                
                data_indicator = "+".join(data_types) if data_types else "?"
                label = f"{identified_name} ({similarity:.3f}) [{method_text}|{data_indicator}]"
            elif identified_name:
                color = (0, 255, 255)  # Yellow for low confidence
                label = f"{identified_name}? ({similarity:.3f})"
            else:
                color = (0, 0, 255)  # Red for unknown
                label = f"Unknown #{i+1} (Q:{quality:.2f})"
            
            cv2.rectangle(orig, (x1, y1), (x2, y2), color, 3)
            cv2.putText(orig, label, (x1, y1 - 10), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
        
        # Encode result image
        result_image = encode_image(orig)
        
        # Broadcast any new records to WS clients
        if new_records:
            try:
                await ws_broadcast({
                    "type": "attendance_logged",
                    "records": new_records,
                })
            except Exception:
                pass

        return {
            "success": True,
            "message": f"Processed {len(faces)} face(s)",
            "faces_detected": len(faces),
            "faces_recognized": sum(1 for r in results if r['should_log']),
            "results": results,
            "annotated_image": result_image,
            "processing_info": {
                "scene_crowding": scene_crowding,
                "image_size": [w, h]
            }
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Recognition failed: {str(e)}")

@app.post("/recognize/base64", response_model=Dict[str, Any])
async def recognize_from_base64(
    image_data: str = Form(...),
    return_image: bool = Form(False)
):
    """
    🔍 Recognize faces from base64 encoded image
    
    Send base64 image data and get recognition results.
    """
    try:
        # Decode image
        frame = decode_image(image_data)
        orig = frame.copy()
        h, w = frame.shape[:2]
        
        # Same processing logic as above
        input_blob, scale, dx, dy = preprocess_yolo(frame)
        preds = yolo_sess.run(None, {'images': input_blob})[0]
        faces = non_max_suppression(preds, conf_thresh, iou_thresh, 
                                   img_shape=(h, w), input_shape=(input_size, input_size), 
                                   pad=(dx, dy), scale=scale)

        scene_crowding = len(faces)
        results = []
        
        new_records = []
        for i, box in enumerate(faces):
            x1, y1, x2, y2, conf = box
            
            if x2 <= x1 or y2 <= y1:
                continue

            face_img = orig[y1:y2, x1:x2]
            if face_img.size == 0:
                continue
            
            quality = calculate_quality_score(face_img, conf)
            identified_name, similarity, should_log, info = attendance_system.identify_face_enhanced(
                face_img, conf, scene_crowding
            )
            
            attendance_logged = False
            if identified_name and should_log:
                attendance_logged = attendance_system.log_attendance(identified_name, similarity, info)
                if attendance_logged:
                    try:
                        new_records.append(attendance_system.attendance_log[-1])
                    except Exception:
                        pass
            
            result = {
                "face_id": i + 1,
                "name": identified_name,
                "confidence": float(similarity),
                "bbox": [int(x1), int(y1), int(x2), int(y2)],
                "quality": float(quality),
                "method": info.get('method', 'unknown'),
                "should_log": should_log,
                "attendance_logged": attendance_logged,
                "additional_info": info
            }
            results.append(result)
        
        response_data = {
            "success": True,
            "message": f"Processed {len(faces)} face(s)",
            "faces_detected": len(faces),
            "faces_recognized": sum(1 for r in results if r['should_log']),
            "results": results
        }
        
        if return_image:
            # Draw annotations and return image - USING YOUR EXACT STYLE
            for i, result in enumerate(results):
                x1, y1, x2, y2 = result['bbox']
                if result['should_log']:
                    color = (0, 255, 0)
                    # Get the additional info to create proper label
                    info = result.get('additional_info', {})
                    method_text = info.get('method', 'unknown')[:8]
                    
                    # Check data types
                    person_summary = attendance_system.get_person_summary(result['name'])
                    data_types = []
                    if person_summary['in_legacy']:
                        data_types.append("L")
                    if person_summary['num_templates'] > 0:
                        data_types.append(f"T{person_summary['num_templates']}")
                    
                    data_indicator = "+".join(data_types) if data_types else "?"
                    label = f"{result['name']} ({result['confidence']:.3f}) [{method_text}|{data_indicator}]"
                elif result['name']:
                    color = (0, 255, 255)
                    label = f"{result['name']}? ({result['confidence']:.3f})"
                else:
                    color = (0, 0, 255)
                    label = f"Unknown #{i+1} (Q:{result['quality']:.2f})"
                
                cv2.rectangle(orig, (x1, y1), (x2, y2), color, 3)
                cv2.putText(orig, label, (x1, y1 - 10), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
            
            response_data["annotated_image"] = encode_image(orig)
        
        # Broadcast any new records to WS clients
        if new_records:
            try:
                await ws_broadcast({
                    "type": "attendance_logged",
                    "records": new_records,
                })
            except Exception:
                pass

        return response_data
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Recognition failed: {str(e)}")

@app.post("/recognize/batch", response_model=Dict[str, Any])
async def recognize_batch_images(files: List[UploadFile] = File(...)):
    """
    📁 Batch process multiple images for face recognition
    
    Upload multiple image files and get recognition results for all.
    Replicates the prototype's batch processing functionality.
    """
    try:
        if len(files) > 50:  # Reasonable limit
            raise HTTPException(status_code=400, detail="Maximum 50 images allowed per batch")
        
        batch_results = []
        total_faces = 0
        total_recognized = 0
        start_time = time.time()
        
        for i, file in enumerate(files):
            try:
                # Process each image
                frame = await process_uploaded_file(file)
                orig = frame.copy()
                h, w = frame.shape[:2]
                
                # Run YOLO detection
                input_blob, scale, dx, dy = preprocess_yolo(frame)
                preds = yolo_sess.run(None, {'images': input_blob})[0]
                faces = non_max_suppression(preds, conf_thresh, iou_thresh, 
                                           img_shape=(h, w), input_shape=(input_size, input_size), 
                                           pad=(dx, dy), scale=scale)

                scene_crowding = len(faces)
                image_results = []
                recognized_count = 0
                
                # Process each detected face
                for j, box in enumerate(faces):
                    x1, y1, x2, y2, conf = box
                    
                    if x2 <= x1 or y2 <= y1:
                        continue

                    face_img = orig[y1:y2, x1:x2]
                    if face_img.size == 0:
                        continue
                    
                    quality = calculate_quality_score(face_img, conf)
                    identified_name, similarity, should_log, info = attendance_system.identify_face_enhanced(
                        face_img, conf, scene_crowding
                    )
                    
                    # Log attendance if recognized
                    attendance_logged = False
                    if identified_name and should_log:
                        attendance_logged = attendance_system.log_attendance(identified_name, similarity, info)
                        if attendance_logged:
                            recognized_count += 1
                    
                    result = {
                        "face_id": j + 1,
                        "name": identified_name,
                        "confidence": float(similarity),
                        "bbox": [int(x1), int(y1), int(x2), int(y2)],
                        "quality": float(quality),
                        "method": info.get('method', 'unknown'),
                        "should_log": should_log,
                        "attendance_logged": attendance_logged
                    }
                    image_results.append(result)
                
                # Store results for this image
                batch_results.append({
                    "filename": file.filename,
                    "image_index": i + 1,
                    "faces_detected": len(faces),
                    "faces_recognized": recognized_count,
                    "faces": image_results,
                    "processing_successful": True
                })
                
                total_faces += len(faces)
                total_recognized += recognized_count
                
            except Exception as e:
                # Handle individual image errors
                batch_results.append({
                    "filename": file.filename,
                    "image_index": i + 1,
                    "faces_detected": 0,
                    "faces_recognized": 0,
                    "faces": [],
                    "processing_successful": False,
                    "error": str(e)
                })
        
        processing_time = time.time() - start_time
        
        return {
            "success": True,
            "message": f"Processed {len(files)} images in {processing_time:.2f}s",
            "summary": {
                "total_images": len(files),
                "successful_images": sum(1 for r in batch_results if r["processing_successful"]),
                "total_faces_detected": total_faces,
                "total_faces_recognized": total_recognized,
                "recognition_rate": (total_recognized / max(total_faces, 1)) * 100,
                "processing_time_seconds": processing_time
            },
            "results": batch_results
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Batch processing failed: {str(e)}")

@app.post("/person/add", response_model=ApiResponse)
async def add_person(
    name: str = Form(...),
    file: UploadFile = File(...)
):
    """
    👤 Add new person to the system
    
    Upload a face image and person name to register them in the system.
    """
    try:
        # Check for duplicates
        summary = attendance_system.get_person_summary(name)
        if summary['in_legacy'] or summary['num_templates'] > 0:
            return ApiResponse(
                success=False,
                message=f"Person '{name}' already exists",
                data=summary,
                error="DUPLICATE_PERSON"
            )
        
        # Process image and detect face
        full_image = await process_uploaded_file(file)
        
        # Detect face in the uploaded image
        h, w = full_image.shape[:2]
        input_blob, scale, dx, dy = preprocess_yolo(full_image)
        preds = yolo_sess.run(None, {'images': input_blob})[0]
        faces = non_max_suppression(preds, conf_thresh, iou_thresh, 
                                   img_shape=(h, w), input_shape=(input_size, input_size), 
                                   pad=(dx, dy), scale=scale)
        
        if not faces:
            return ApiResponse(
                success=False,
                message="No face detected in the uploaded image",
                error="NO_FACE_DETECTED"
            )
        
        # Take the largest face (most prominent)
        largest_face = max(faces, key=lambda x: (x[2] - x[0]) * (x[3] - x[1]))
        x1, y1, x2, y2, conf = largest_face
        
        # Crop the face region tightly - NO PADDING for maximum EdgeFace-S accuracy
        # EdgeFace-S works best with clean, tightly cropped face images
        face_img = full_image[y1:y2, x1:x2]
        
        # Validate cropped face size
        if face_img.size == 0:
            return ApiResponse(
                success=False,
                message="Failed to crop face from image",
                error="FACE_CROP_FAILED"
            )
        
        # Check minimum face size for EdgeFace-S (should be at least 80x80 pixels)
        face_h, face_w = face_img.shape[:2]
        if face_h < 80 or face_w < 80:
            return ApiResponse(
                success=False,
                message=f"Face too small ({face_w}x{face_h}). Minimum size is 80x80 pixels. Try uploading a higher resolution image or getting closer to the camera.",
                error="FACE_TOO_SMALL"
            )
        
        # Add to system with better error handling
        try:
            success = attendance_system.add_new_face(face_img, name)
            if not success:
                logger.error(f"add_new_face returned False for {name}")
        except Exception as e:
            logger.error(f"Exception in add_new_face for {name}: {e}")
            success = False
        
        if success:
            # Broadcast WebSocket event for new person addition
            try:
                await ws_broadcast({
                    "type": "person_added",
                    "data": {
                        "name": name,
                        "added_at": datetime.now().isoformat(),
                        "method": "single_template"
                    }
                })
            except Exception as e:
                logger.warning(f"Failed to broadcast person addition: {e}")
            
            return ApiResponse(
                success=True,
                message=f"Successfully added {name} to the system",
                data={"name": name, "added_at": datetime.now().isoformat()}
            )
        else:
            return ApiResponse(
                success=False,
                message=f"Failed to add {name}",
                error="ADD_PERSON_FAILED"
            )
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to add person: {str(e)}")

@app.post("/person/add-multi", response_model=ApiResponse)
async def add_person_multi_templates(
    name: str = Form(...),
    files: List[UploadFile] = File(...)
):
    """
    👥 Add person with multiple face templates
    
    Upload multiple face images for better recognition accuracy.
    """
    try:
        if len(files) > 10:
            raise HTTPException(status_code=400, detail="Maximum 10 images allowed")
        
        # Check for duplicates
        summary = attendance_system.get_person_summary(name)
        if summary['in_legacy'] or summary['num_templates'] > 0:
            return ApiResponse(
                success=False,
                message=f"Person '{name}' already exists",
                data=summary,
                error="DUPLICATE_PERSON"
            )
        
        # Process all images and detect faces
        face_images = []
        for i, file in enumerate(files):
            full_image = await process_uploaded_file(file)
            
            # Detect face in the uploaded image
            h, w = full_image.shape[:2]
            input_blob, scale, dx, dy = preprocess_yolo(full_image)
            preds = yolo_sess.run(None, {'images': input_blob})[0]
            faces = non_max_suppression(preds, conf_thresh, iou_thresh, 
                                       img_shape=(h, w), input_shape=(input_size, input_size), 
                                       pad=(dx, dy), scale=scale)
            
            if not faces:
                return ApiResponse(
                    success=False,
                    message=f"No face detected in image {i+1}",
                    error="NO_FACE_DETECTED"
                )
            
            # Take the largest face (most prominent)
            largest_face = max(faces, key=lambda x: (x[2] - x[0]) * (x[3] - x[1]))
            x1, y1, x2, y2, conf = largest_face
            
            # Crop the face region tightly - NO PADDING for maximum EdgeFace-S accuracy
            # EdgeFace-S works best with clean, tightly cropped face images
            face_img = full_image[y1:y2, x1:x2]
            
            # Validate cropped face size
            if face_img.size == 0:
                return ApiResponse(
                    success=False,
                    message=f"Failed to crop face from image {i+1}",
                    error="FACE_CROP_FAILED"
                )
            
            # Check minimum face size for EdgeFace-S (should be at least 80x80 pixels)
            face_h, face_w = face_img.shape[:2]
            if face_h < 80 or face_w < 80:
                return ApiResponse(
                    success=False,
                    message=f"Face too small in image {i+1} ({face_w}x{face_h}). Minimum size is 80x80 pixels. Try uploading a higher resolution image or getting closer to the camera.",
                    error="FACE_TOO_SMALL"
                )
            
            face_images.append(face_img)
        
        # Add to system with enhanced templates
        success = attendance_system.add_new_face_enhanced(face_images, name)
        
        if success:
            # Broadcast WebSocket event for new person addition with multiple templates
            try:
                await ws_broadcast({
                    "type": "person_added",
                    "data": {
                        "name": name,
                        "added_at": datetime.now().isoformat(),
                        "method": "multi_template",
                        "templates_count": len(face_images)
                    }
                })
            except Exception as e:
                logger.warning(f"Failed to broadcast person addition: {e}")
            
            return ApiResponse(
                success=True,
                message=f"Successfully added {name} with {len(face_images)} templates",
                data={
                    "name": name,
                    "templates_count": len(face_images),
                    "added_at": datetime.now().isoformat()
                }
            )
        else:
            return ApiResponse(
                success=False,
                message=f"Failed to add {name}",
                error="ADD_PERSON_FAILED"
            )
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to add person: {str(e)}")

@app.post("/person/add-from-camera", response_model=ApiResponse)
async def add_person_from_camera(name: str = Form(...), device: Optional[int] = Form(None), multi_template: bool = Form(True)):
    """
    👤 Add person by capturing a frame from the live camera.
    
    Note: This endpoint requires the frontend to handle frame capture to avoid camera conflicts.
    """
    # This endpoint is now meant to be called with a pre-captured frame
    # The frontend should capture the frame and upload it instead
    raise HTTPException(
        status_code=501, 
        detail="Please use /person/add endpoint with a captured image instead. Camera capture from backend conflicts with video worker."
    )

@app.get("/person/{name}", response_model=Dict[str, Any])
async def get_person_details(name: str):
    """
    🔍 Get person details and statistics
    """
    try:
        summary = attendance_system.get_person_summary(name)
        
        if not summary['in_legacy'] and summary['num_templates'] == 0:
            raise HTTPException(status_code=404, detail=f"Person '{name}' not found")
        
        # Get recent attendance records
        today_records = [r for r in attendance_system.get_today_attendance() if r['name'] == name]
        
        return {
            "success": True,
            "person": summary,
            "today_attendance": len(today_records),
            "recent_records": today_records[-5:] if today_records else []  # Last 5 records
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get person details: {str(e)}")

@app.delete("/person/{name}", response_model=ApiResponse)
async def delete_person(name: str):
    """
    🗑️ Delete person from the system
    """
    try:
        summary = attendance_system.get_person_summary(name)
        
        if not summary['in_legacy'] and summary['num_templates'] == 0:
            raise HTTPException(status_code=404, detail=f"Person '{name}' not found")
        
        # Remove from databases
        if name in attendance_system.face_database:
            del attendance_system.face_database[name]
        if name in attendance_system.multi_templates:
            del attendance_system.multi_templates[name]
        if name in attendance_system.recognition_stats:
            del attendance_system.recognition_stats[name]
        
        # Save changes
        attendance_system.save_face_database()
        attendance_system.save_multi_templates()
        
        return ApiResponse(
            success=True,
            message=f"Successfully deleted {name} from the system"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete person: {str(e)}")

@app.get("/attendance/today", response_model=Dict[str, Any])
async def get_today_attendance():
    """
    📋 Get today's attendance records
    """
    try:
        # Reload attendance log from disk to get latest records from video worker
        attendance_system.load_attendance_log()
        records = attendance_system.get_today_attendance()
        
        # Statistics
        unique_people = set(record['name'] for record in records)
        
        return {
            "success": True,
            "date": datetime.now().strftime('%Y-%m-%d'),
            "total_records": len(records),
            "unique_people": len(unique_people),
            "people_present": list(unique_people),
            "records": records
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get attendance: {str(e)}")

@app.get("/attendance/person/{name}", response_model=Dict[str, Any])
async def get_person_attendance(name: str, days: int = 7):
    """
    👤 Get attendance history for specific person
    """
    try:
        from datetime import timedelta
        
        # Get records for the last N days
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        
        person_records = [
            record for record in attendance_system.attendance_log
            if record['name'] == name and 
            datetime.fromisoformat(record['timestamp']) >= start_date
        ]
        
        if not person_records:
            raise HTTPException(status_code=404, detail=f"No attendance records found for {name}")
        
        # Group by date
        daily_records = {}
        for record in person_records:
            date = record['date']
            if date not in daily_records:
                daily_records[date] = []
            daily_records[date].append(record)
        
        return {
            "success": True,
            "person": name,
            "period": f"Last {days} days",
            "total_records": len(person_records),
            "days_present": len(daily_records),
            "daily_records": daily_records,
            "latest_record": person_records[-1] if person_records else None
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get person attendance: {str(e)}")

@app.delete("/attendance/clear", response_model=ApiResponse)
async def clear_attendance():
    """
    🗑️ Clear all attendance records
    """
    try:
        attendance_system.attendance_log = []
        attendance_system.save_attendance_log()
        
        return ApiResponse(
            success=True,
            message="All attendance records cleared successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear attendance: {str(e)}")

@app.get("/system/status", response_model=Dict[str, Any])
async def get_system_status():
    """
    📊 Get system statistics and status
    """
    try:
        # Database statistics
        legacy_count = len(attendance_system.face_database)
        template_count = sum(len(templates) for templates in attendance_system.multi_templates.values())
        people_count = len(attendance_system.multi_templates)
        
        # Attendance statistics
        today_records = attendance_system.get_today_attendance()
        total_records = len(attendance_system.attendance_log)
        
        # Recognition statistics
        total_attempts = sum(stats['attempts'] for stats in attendance_system.recognition_stats.values())
        total_successes = sum(stats['successes'] for stats in attendance_system.recognition_stats.values())
        overall_success_rate = total_successes / max(total_attempts, 1)
        
        return {
            "success": True,
            "system_info": {
                "status": "operational",
                "version": "1.0.0",
                "uptime": "Available via system metrics"
            },
            "database_stats": {
                "legacy_faces": legacy_count,
                "enhanced_templates": template_count,
                "total_people": people_count
            },
            "attendance_stats": {
                "today_records": len(today_records),
                "total_records": total_records,
                "unique_people_today": len(set(r['name'] for r in today_records))
            },
            "recognition_stats": {
                "total_attempts": total_attempts,
                "total_successes": total_successes,
                "success_rate": overall_success_rate
            }
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get system status: {str(e)}")

@app.post("/system/preload", response_model=ApiResponse)
async def preload_models():
    """
    🚀 Preload ONNX models for instant camera startup
    """
    try:
        # Models are already loaded when attendance_system is initialized
        # This endpoint just confirms they're ready and does a quick test
        if yolo_sess is not None and attendance_system is not None:
            # Do a quick dummy inference to warm up the models
            dummy_frame = np.zeros((480, 640, 3), dtype=np.uint8)
            input_blob, scale, dx, dy = preprocess_yolo(dummy_frame)
            _ = yolo_sess.run(None, {'images': input_blob})[0]
            
            return ApiResponse(
                success=True,
                message="Models preloaded and ready for instant camera startup"
            )
        else:
            return ApiResponse(
                success=False,
                message="Models not yet initialized"
            )
            
    except Exception as e:
        return ApiResponse(
            success=False,
            message=f"Preload failed: {str(e)}"
        )

@app.get("/system/stats", response_model=Dict[str, Any])
async def get_system_stats():
    """
    📈 Get simplified system stats for frontend
    """
    try:
        # Database statistics
        legacy_count = len(attendance_system.face_database)
        template_count = sum(len(templates) for templates in attendance_system.multi_templates.values())
        people_count = len(attendance_system.multi_templates)
        
        # Attendance statistics
        today_records = attendance_system.get_today_attendance()
        total_records = len(attendance_system.attendance_log)
        
        # Recognition statistics
        total_attempts = sum(stats['attempts'] for stats in attendance_system.recognition_stats.values())
        total_successes = sum(stats['successes'] for stats in attendance_system.recognition_stats.values())
        overall_success_rate = total_successes / max(total_attempts, 1)
        
        return {
            "success": True,
            "stats": {
                "legacy_faces": legacy_count,
                "template_count": template_count,
                "people_count": people_count,
                "today_attendance": len(today_records),
                "total_attendance": total_records,
                "success_rate": overall_success_rate
            }
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get system stats: {str(e)}")

@app.get("/system/people", response_model=Dict[str, Any])
async def list_all_people():
    """
    👥 List all registered people
    """
    try:
        # Get all unique names from both databases
        all_names = set()
        all_names.update(attendance_system.face_database.keys())
        all_names.update(attendance_system.multi_templates.keys())
        
        people_list = []
        for name in sorted(all_names):
            summary = attendance_system.get_person_summary(name)
            people_list.append(summary)
        
        return {
            "success": True,
            "total_people": len(people_list),
            "people": people_list
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list people: {str(e)}")

@app.post("/person/update-threshold", response_model=ApiResponse)
async def update_person_threshold(body: ThresholdUpdate):
    """
    🔧 Update per-person recognition threshold override.
    """
    try:
        name = body.name
        thr = float(body.threshold)
        if not (0.0 < thr < 1.0):
            raise HTTPException(status_code=400, detail="Threshold must be between 0 and 1")
        # Ensure person exists
        summary = attendance_system.get_person_summary(name)
        if not summary['in_legacy'] and summary['num_templates'] == 0:
            raise HTTPException(status_code=404, detail=f"Person '{name}' not found")
        attendance_system.person_thresholds[name] = thr
        attendance_system.save_multi_templates()
        return ApiResponse(success=True, message="Threshold updated", data={"name": name, "threshold": thr})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update threshold: {str(e)}")

@app.post("/system/backup", response_model=ApiResponse)
async def system_backup():
    """
    💾 Create a simple backup of face database and stats files.
    """
    try:
        import shutil
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_dir = os.path.join('face_database', f'backup_{ts}')
        os.makedirs(backup_dir, exist_ok=True)
        copied = []
        for fname in [
            os.path.join('face_database', 'embeddings.pkl'),
            os.path.join('face_database', 'multi_templates.pkl'),
            os.path.join('face_database', 'template_stats.json'),
            'attendance_log.json',
        ]:
            if os.path.exists(fname):
                shutil.copy2(fname, os.path.join(backup_dir, os.path.basename(fname)))
                copied.append(os.path.basename(fname))
        return ApiResponse(success=True, message="Backup created", data={"backup_path": backup_dir, "files": copied})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backup failed: {str(e)}")

@app.post("/system/optimize-templates", response_model=ApiResponse)
async def optimize_templates():
    """
    🎯 Simple optimization: remove lowest quality template if too many per person.
    """
    try:
        removed = 0
        for name, templates in list(attendance_system.multi_templates.items()):
            if len(templates) > 5:
                # Sort by avg_quality ascending and remove extras to keep top 5
                templates.sort(key=lambda t: t.get('avg_quality', 0.0), reverse=True)
                removed += max(0, len(templates) - 5)
                attendance_system.multi_templates[name] = templates[:5]
        attendance_system.save_multi_templates()
        return ApiResponse(success=True, message="Templates optimized", data={"removed_count": removed})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Optimization failed: {str(e)}")

@app.get("/system/management", response_model=Dict[str, Any])
async def get_system_management_overview():
    """
    ⚙️ Get comprehensive system management overview
    
    Provides all data needed for system management dashboard.
    """
    try:
        # Get today's attendance
        today_records = attendance_system.get_today_attendance()
        
        # Get people statistics
        legacy_count = len(attendance_system.face_database)
        template_count = sum(len(templates) for templates in attendance_system.multi_templates.values())
        total_people = max(legacy_count, len(attendance_system.multi_templates))
        
        # Calculate recognition statistics
        total_attempts = sum(stats.get('attempts', 0) for stats in attendance_system.recognition_stats.values())
        total_successes = sum(stats.get('successes', 0) for stats in attendance_system.recognition_stats.values())
        success_rate = (total_successes / max(total_attempts, 1)) * 100
        
        # Get person details with performance stats
        people_details = []
        for person_name in set(list(attendance_system.face_database.keys()) + list(attendance_system.multi_templates.keys())):
            summary = attendance_system.get_person_summary(person_name)
            people_details.append(summary)
        
        return {
            "success": True,
            "data": {
                "overview": {
                    "total_people": total_people,
                    "legacy_faces": legacy_count,
                    "enhanced_templates": template_count,
                    "today_attendance": len(today_records),
                    "total_attendance": len(attendance_system.attendance_log),
                    "overall_success_rate": success_rate
                },
                "today_attendance": today_records,
                "people": people_details,
                "system_stats": {
                    "total_recognition_attempts": total_attempts,
                    "total_recognition_successes": total_successes,
                    "database_files": {
                        "legacy_db": os.path.exists(os.path.join("face_database", "embeddings.pkl")),
                        "multi_templates": os.path.exists(os.path.join("face_database", "multi_templates.pkl")),
                        "attendance_log": os.path.exists("attendance_log.json")
                    }
                }
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get management overview: {str(e)}")

@app.get("/person/search/{name}", response_model=Dict[str, Any])
async def search_person_details(name: str):
    """
    🔍 Search for detailed person information
    
    Get comprehensive details about a specific person including templates and performance.
    """
    try:
        summary = attendance_system.get_person_summary(name)
        
        if not summary['in_legacy'] and summary['num_templates'] == 0:
            raise HTTPException(status_code=404, detail=f"Person '{name}' not found")
        
        # Get recent attendance for this person
        person_attendance = [
            record for record in attendance_system.attendance_log 
            if record.get('name', '').lower() == name.lower()
        ]
        
        # Get today's attendance
        today_attendance = [
            record for record in attendance_system.get_today_attendance()
            if record.get('name', '').lower() == name.lower()
        ]
        
        # Get template details if available
        template_details = []
        if name in attendance_system.multi_templates:
            for i, template in enumerate(attendance_system.multi_templates[name]):
                template_details.append({
                    "template_id": i + 1,
                    "cluster_size": template.get('cluster_size', 1),
                    "avg_quality": template.get('avg_quality', 0),
                    "usage_count": template.get('usage_count', 0),
                    "success_rate": template.get('success_rate', 0),
                    "created_date": template.get('created_date', 'Unknown')
                })
        
        return {
            "success": True,
            "data": {
                "person": summary,
                "templates": template_details,
                "attendance": {
                    "today": today_attendance,
                    "recent": person_attendance[-10:],  # Last 10 records
                    "total_records": len(person_attendance)
                }
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to search person: {str(e)}")

@app.post("/system/clear-attendance", response_model=ApiResponse)
async def clear_all_attendance():
    """
    🗑️ Clear all attendance records
    
    Permanently delete all attendance logs. Use with caution!
    """
    try:
        record_count = len(attendance_system.attendance_log)
        attendance_system.attendance_log = []
        attendance_system.save_attendance_log()
        
        return ApiResponse(
            success=True,
            message=f"Successfully cleared {record_count} attendance records"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear attendance: {str(e)}")

@app.get("/system/advanced-stats", response_model=Dict[str, Any])
async def get_advanced_system_statistics():
    """
    📊 Get detailed system statistics and analytics
    
    Provides comprehensive system performance and usage analytics.
    """
    try:
        # Calculate detailed statistics
        legacy_count = len(attendance_system.face_database)
        template_count = sum(len(templates) for templates in attendance_system.multi_templates.values())
        total_people = max(legacy_count, len(attendance_system.multi_templates))
        
        # Recognition performance by person
        person_performance = []
        for person_name, stats in attendance_system.recognition_stats.items():
            if stats['attempts'] > 0:
                person_performance.append({
                    "name": person_name,
                    "attempts": stats['attempts'],
                    "successes": stats['successes'],
                    "success_rate": (stats['successes'] / stats['attempts']) * 100
                })
        
        # Sort by success rate
        person_performance.sort(key=lambda x: x['success_rate'], reverse=True)
        
        # Template quality analysis
        template_analysis = {
            "high_quality": 0,  # > 0.7 quality
            "medium_quality": 0,  # 0.4 - 0.7 quality
            "low_quality": 0,  # < 0.4 quality
            "total_templates": template_count
        }
        
        for templates in attendance_system.multi_templates.values():
            for template in templates:
                quality = template.get('avg_quality', 0)
                if quality > 0.7:
                    template_analysis["high_quality"] += 1
                elif quality > 0.4:
                    template_analysis["medium_quality"] += 1
                else:
                    template_analysis["low_quality"] += 1
        
        # Attendance analytics
        today_count = len(attendance_system.get_today_attendance())
        total_attendance = len(attendance_system.attendance_log)
        
        # Daily attendance trend (last 7 days)
        from collections import defaultdict
        daily_counts = defaultdict(int)
        for record in attendance_system.attendance_log:
            date = record.get('date', '')
            if date:
                daily_counts[date] += 1
        
        # Get last 7 days
        from datetime import datetime, timedelta
        today = datetime.now()
        daily_trend = []
        for i in range(7):
            date = (today - timedelta(days=i)).strftime('%Y-%m-%d')
            daily_trend.append({
                "date": date,
                "count": daily_counts.get(date, 0)
            })
        daily_trend.reverse()
        
        return {
            "success": True,
            "data": {
                "database_stats": {
                    "total_people": total_people,
                    "legacy_faces": legacy_count,
                    "enhanced_templates": template_count,
                    "people_with_both": len([
                        name for name in attendance_system.multi_templates.keys()
                        if name in attendance_system.face_database
                    ])
                },
                "recognition_performance": {
                    "top_performers": person_performance[:10],
                    "bottom_performers": person_performance[-5:] if len(person_performance) > 5 else [],
                    "average_success_rate": sum(p['success_rate'] for p in person_performance) / max(len(person_performance), 1)
                },
                "template_quality": template_analysis,
                "attendance_analytics": {
                    "today": today_count,
                    "total": total_attendance,
                    "daily_trend": daily_trend,
                    "unique_people_today": len(set(r['name'] for r in attendance_system.get_today_attendance())),
                    "avg_daily_attendance": total_attendance / max(len(daily_counts), 1)
                }
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get advanced statistics: {str(e)}")

@app.put("/person/{name}/edit", response_model=ApiResponse)
async def edit_person_name(name: str, new_name: str = Form(...)):
    """
    ✏️ Edit person's name in the system
    
    Update a person's name across all databases and records.
    """
    try:
        # Validate new name
        new_name = new_name.strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="New name cannot be empty")
        
        if name == new_name:
            raise HTTPException(status_code=400, detail="New name is the same as current name")
        
        # Check if person exists
        summary = attendance_system.get_person_summary(name)
        if not summary['in_legacy'] and summary['num_templates'] == 0:
            raise HTTPException(status_code=404, detail=f"Person '{name}' not found")
        
        # Check if new name already exists
        new_summary = attendance_system.get_person_summary(new_name)
        if new_summary['in_legacy'] or new_summary['num_templates'] > 0:
            raise HTTPException(status_code=409, detail=f"Person '{new_name}' already exists")
        
        # Update in legacy database
        if name in attendance_system.face_database:
            person_data = attendance_system.face_database[name]
            del attendance_system.face_database[name]
            attendance_system.face_database[new_name] = person_data
        
        # Update in multi-templates
        if name in attendance_system.multi_templates:
            templates = attendance_system.multi_templates[name]
            del attendance_system.multi_templates[name]
            attendance_system.multi_templates[new_name] = templates
        
        # Update in recognition stats
        if name in attendance_system.recognition_stats:
            stats = attendance_system.recognition_stats[name]
            del attendance_system.recognition_stats[name]
            attendance_system.recognition_stats[new_name] = stats
        
        # Update attendance records
        for record in attendance_system.attendance_log:
            if record.get('name') == name:
                record['name'] = new_name
        
        # Save all changes
        attendance_system.save_face_database()
        attendance_system.save_multi_templates()
        attendance_system.save_attendance_log()
        
        # Rename face image file if it exists
        old_face_path = os.path.join("face_database", f"{name}.jpg")
        new_face_path = os.path.join("face_database", f"{new_name}.jpg")
        if os.path.exists(old_face_path):
            try:
                os.rename(old_face_path, new_face_path)
            except Exception as e:
                print(f"[WARNING] Could not rename face image: {e}")
        
        return ApiResponse(
            success=True,
            message=f"Successfully renamed '{name}' to '{new_name}'",
            data={
                "old_name": name,
                "new_name": new_name,
                "updated_records": len([r for r in attendance_system.attendance_log if r.get('name') == new_name])
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to edit person: {str(e)}")

@app.delete("/person/{name}/delete", response_model=ApiResponse)
async def delete_person_completely(name: str, confirm: bool = Form(False)):
    """
    🗑️ Completely delete person from the system
    
    Removes person from all databases and optionally their attendance records.
    """
    try:
        if not confirm:
            raise HTTPException(status_code=400, detail="Confirmation required to delete person")
        
        # Check if person exists
        summary = attendance_system.get_person_summary(name)
        if not summary['in_legacy'] and summary['num_templates'] == 0:
            raise HTTPException(status_code=404, detail=f"Person '{name}' not found")
        
        deleted_items = []
        
        # Remove from legacy database
        if name in attendance_system.face_database:
            del attendance_system.face_database[name]
            deleted_items.append("legacy_database")
        
        # Remove from multi-templates
        if name in attendance_system.multi_templates:
            template_count = len(attendance_system.multi_templates[name])
            del attendance_system.multi_templates[name]
            deleted_items.append(f"{template_count}_templates")
        
        # Remove from recognition stats
        if name in attendance_system.recognition_stats:
            del attendance_system.recognition_stats[name]
            deleted_items.append("recognition_stats")
        
        # Count attendance records for this person
        attendance_count = len([r for r in attendance_system.attendance_log if r.get('name') == name])
        
        # Remove face image file if it exists
        face_image_path = os.path.join("face_database", f"{name}.jpg")
        if os.path.exists(face_image_path):
            try:
                os.remove(face_image_path)
                deleted_items.append("face_image")
            except Exception as e:
                print(f"[WARNING] Could not delete face image: {e}")
        
        # Save all changes
        attendance_system.save_face_database()
        attendance_system.save_multi_templates()
        
        return ApiResponse(
            success=True,
            message=f"Successfully deleted '{name}' from the system",
            data={
                "deleted_person": name,
                "deleted_items": deleted_items,
                "attendance_records_found": attendance_count,
                "note": "Attendance records preserved for historical data"
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete person: {str(e)}")

@app.delete("/person/{name}/delete-all", response_model=ApiResponse)
async def delete_person_and_records(name: str, confirm: bool = Form(False)):
    """
    💥 Completely delete person AND all their attendance records
    
    Nuclear option: removes everything related to this person.
    """
    try:
        if not confirm:
            raise HTTPException(status_code=400, detail="Confirmation required for complete deletion")
        
        # Check if person exists
        summary = attendance_system.get_person_summary(name)
        if not summary['in_legacy'] and summary['num_templates'] == 0:
            raise HTTPException(status_code=404, detail=f"Person '{name}' not found")
        
        deleted_items = []
        
        # Remove from legacy database
        if name in attendance_system.face_database:
            del attendance_system.face_database[name]
            deleted_items.append("legacy_database")
        
        # Remove from multi-templates
        if name in attendance_system.multi_templates:
            template_count = len(attendance_system.multi_templates[name])
            del attendance_system.multi_templates[name]
            deleted_items.append(f"{template_count}_templates")
        
        # Remove from recognition stats
        if name in attendance_system.recognition_stats:
            del attendance_system.recognition_stats[name]
            deleted_items.append("recognition_stats")
        
        # Remove ALL attendance records for this person
        original_count = len(attendance_system.attendance_log)
        attendance_system.attendance_log = [
            record for record in attendance_system.attendance_log 
            if record.get('name') != name
        ]
        records_deleted = original_count - len(attendance_system.attendance_log)
        
        if records_deleted > 0:
            deleted_items.append(f"{records_deleted}_attendance_records")
        
        # Remove face image file if it exists
        face_image_path = os.path.join("face_database", f"{name}.jpg")
        if os.path.exists(face_image_path):
            try:
                os.remove(face_image_path)
                deleted_items.append("face_image")
            except Exception as e:
                print(f"[WARNING] Could not delete face image: {e}")
        
        # Save all changes
        attendance_system.save_face_database()
        attendance_system.save_multi_templates()
        attendance_system.save_attendance_log()
        
        return ApiResponse(
            success=True,
            message=f"Successfully deleted '{name}' and all related data",
            data={
                "deleted_person": name,
                "deleted_items": deleted_items,
                "attendance_records_deleted": records_deleted
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to completely delete person: {str(e)}")

@app.get("/video/stream")
async def video_stream(device: Optional[int] = None):
    """
    📹 Live video stream with face recognition and bounding boxes
    """
    # Ensure the persistent camera is running first
    if not camera_manager.ensure_started(device):
        raise HTTPException(status_code=503, detail="Camera not available for selected device")
    def generate_frames():
        global streaming_active
        streaming_active = True

        print("[INFO] Starting live video stream with face recognition (shared camera)...")

        try:
            while streaming_active:
                frame = camera_manager.get_frame(timeout=0.5)
                if frame is None:
                    continue

                orig = frame.copy()
                h, w = frame.shape[:2]

                try:
                    input_blob, scale, dx, dy = preprocess_yolo(frame)
                    preds = yolo_sess.run(None, {'images': input_blob})[0]
                    faces = non_max_suppression(
                        preds, conf_thresh, iou_thresh,
                        img_shape=(h, w), input_shape=(input_size, input_size),
                        pad=(dx, dy), scale=scale
                    )

                    scene_crowding = len(faces)
                    for i, box in enumerate(faces):
                        x1, y1, x2, y2, conf = box
                        if x2 <= x1 or y2 <= y1:
                            continue
                        face_img = orig[y1:y2, x1:x2]
                        if face_img.size == 0:
                            continue
                        quality = calculate_quality_score(face_img, conf)
                        identified_name, similarity, should_log, info = attendance_system.identify_face_enhanced(
                            face_img, conf, scene_crowding
                        )
                        if identified_name and should_log:
                            attendance_system.log_attendance(identified_name, similarity, info)
                        if identified_name and should_log:
                            color = (0, 255, 0)
                            method_text = info.get('method', 'unknown')[:8]
                            person_summary = attendance_system.get_person_summary(identified_name)
                            data_types: list[str] = []
                            if person_summary['in_legacy']:
                                data_types.append("L")
                            if person_summary['num_templates'] > 0:
                                data_types.append(f"T{person_summary['num_templates']}")
                            data_indicator = "+".join(data_types) if data_types else "?"
                            label = f"{identified_name} ({similarity:.3f}) [{method_text}|{data_indicator}]"
                        elif identified_name:
                            color = (0, 255, 255)
                            label = f"{identified_name}? ({similarity:.3f})"
                        else:
                            color = (0, 0, 255)
                            label = f"Unknown #{i+1} (Q:{quality:.2f})"
                        cv2.rectangle(orig, (x1, y1), (x2, y2), color, 3)
                        cv2.putText(orig, label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)

                    cv2.putText(orig, f"Faces Detected: {len(faces)}", (10, 35), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
                    cv2.putText(orig, f"People in DB: {len(attendance_system.face_database)}", (10, 70), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
                    cv2.putText(orig, f"Templates: {sum(len(t) for t in attendance_system.multi_templates.values())}", (10, 105), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
                except Exception as e:
                    print(f"[ERROR] Frame processing error: {e}")

                try:
                    _, buffer = cv2.imencode('.jpg', orig, [cv2.IMWRITE_JPEG_QUALITY, 85])
                    frame_bytes = buffer.tobytes()
                    yield (b'--frame\r\n' b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
                except Exception as e:
                    print(f"[ERROR] Frame encoding error: {e}")
                    break
        except Exception as e:
            print(f"[ERROR] Stream error: {e}")
        finally:
            streaming_active = False
            print("[INFO] Video stream stopped")

    return StreamingResponse(
        generate_frames(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )

@app.get("/video/frame")
async def video_frame(device: Optional[int] = None):
    """Return a single annotated JPEG frame; fallback for clients that can't consume MJPEG."""
    try:
        if not camera_manager.ensure_started(device):
            raise HTTPException(status_code=503, detail="Camera not available")

        frame = camera_manager.get_frame(timeout=0.5)
        if frame is None:
            raise HTTPException(status_code=500, detail="Failed to capture frame from shared camera")

        try:
            orig = frame.copy()
            h, w = frame.shape[:2]
            input_blob, scale, dx, dy = preprocess_yolo(frame)
            preds = yolo_sess.run(None, {'images': input_blob})[0]
            faces = non_max_suppression(
                preds, conf_thresh, iou_thresh,
                img_shape=(h, w), input_shape=(input_size, input_size),
                pad=(dx, dy), scale=scale
            )
            scene_crowding = len(faces)
            for i, box in enumerate(faces):
                x1, y1, x2, y2, conf = box
                if x2 <= x1 or y2 <= y1:
                    continue
                face_img = orig[y1:y2, x1:x2]
                if face_img.size == 0:
                    continue
                quality = calculate_quality_score(face_img, conf)
                identified_name, similarity, should_log, info = attendance_system.identify_face_enhanced(
                    face_img, conf, scene_crowding
                )
                if identified_name and should_log:
                    attendance_system.log_attendance(identified_name, similarity, info)
                if identified_name and should_log:
                    color = (0, 255, 0)
                    method_text = info.get('method', 'unknown')[:8]
                    person_summary = attendance_system.get_person_summary(identified_name)
                    data_types: list[str] = []
                    if person_summary['in_legacy']:
                        data_types.append("L")
                    if person_summary['num_templates'] > 0:
                        data_types.append(f"T{person_summary['num_templates']}")
                    data_indicator = "+".join(data_types) if data_types else "?"
                    label = f"{identified_name} ({similarity:.3f}) [{method_text}|{data_indicator}]"
                elif identified_name:
                    color = (0, 255, 255)
                    label = f"{identified_name}? ({similarity:.3f})"
                else:
                    color = (0, 0, 255)
                    label = f"Unknown #{i+1} (Q:{quality:.2f})"
                cv2.rectangle(orig, (x1, y1), (x2, y2), color, 3)
                cv2.putText(orig, label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
            _, buffer = cv2.imencode('.jpg', orig, [cv2.IMWRITE_JPEG_QUALITY, 85])
        except Exception as e:
            print(f"[ERROR] Frame processing error: {e}")
            _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])

        return StreamingResponse(
            iter([buffer.tobytes()]),
            media_type="image/jpeg",
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0"
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Frame error: {str(e)}")

@app.get("/video/frame/clean")
async def video_frame_clean(device: Optional[int] = None):
    """Return a single clean JPEG frame without annotations for face addition"""
    try:
        # Try to start the camera if not already running
        if not camera_manager.ensure_started(device):
            # If camera start failed, try to provide more helpful error
            raise HTTPException(
                status_code=503, 
                detail="Camera not available. Please ensure camera is connected and not in use by another application."
            )

        # Wait a bit for the camera to initialize
        await asyncio.sleep(0.1)
        
        frame = camera_manager.get_frame(timeout=1.0)  # Increased timeout
        if frame is None:
            raise HTTPException(
                status_code=500, 
                detail="Failed to capture frame. Camera may still be initializing."
            )

        # Return the clean frame without any annotations
        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])

        return StreamingResponse(
            iter([buffer.tobytes()]),
            media_type="image/jpeg",
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0"
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Clean frame error: {str(e)}")

@app.post("/video/stop")
async def stop_video_stream():
    """Stop the video stream"""
    global streaming_active
    streaming_active = False
    try:
        camera_manager.stop()
    except Exception:
        pass
    return {"success": True, "message": "Video stream stopped"}

@app.get("/video/status")
async def video_stream_status():
    """Check if video stream is active"""
    return {
    "streaming": streaming_active,
    "camera_available": camera_manager.cap is not None and camera_manager.cap.isOpened(),
        "people_count": len(attendance_system.face_database)
    }

@app.get("/video/devices")
def list_video_devices():
    """Probe and return a list of working cameras with friendly names when possible."""
    try:
        devices = detect_available_cameras(10)
        friendly_names = get_camera_friendly_names()
        
        # Map friendly names to working devices, preserving backend info
        result = []
        for dev in devices:
            if dev['works']:
                # Try to get friendly name, fallback to descriptive name
                name = friendly_names.get(dev['index'])
                if not name:
                    # Generate a fallback name based on device info
                    if dev['backend'] == 'DirectShow':
                        name = f"Camera {dev['index']} (DirectShow - {dev['width']}x{dev['height']})"
                    else:
                        name = f"Camera {dev['index']} ({dev['backend']} - {dev['width']}x{dev['height']})"
            else:
                name = f"Camera {dev['index']} (Not working)"
            
            result.append({
                "index": dev['index'],
                "name": name,
                "backend": dev['backend'],
                "backend_id": dev.get('backend_id'),
                "works": dev['works'],
                "width": dev.get('width', 0),
                "height": dev.get('height', 0),
                "fps": dev.get('fps', 0)
            })
        
        # Sort by index to ensure consistent ordering
        result.sort(key=lambda x: x['index'])
        
        return {"success": True, "devices": result, "current_device": camera_manager.device}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Device probe error: {str(e)}")

@app.post("/video/set_device")
async def set_camera_device(request: dict):
    """Set the active camera device"""
    try:
        device_index = request.get("device_index")
        backend_id = request.get("backend_id")
        
        if device_index is None:
            raise HTTPException(status_code=400, detail="device_index is required")
        
        # Validate device exists and works
        devices = detect_available_cameras(10)
        target_device = None
        for dev in devices:
            if dev['index'] == device_index and dev['works']:
                target_device = dev
                break
        
        if not target_device:
            raise HTTPException(status_code=400, detail=f"Camera device {device_index} not found or not working")
        
        # Stop current camera if running
        if camera_manager.running:
            camera_manager.stop()
            # Small delay to ensure clean shutdown
            await asyncio.sleep(0.1)
        
        # Start with new device
        success = camera_manager.start(device_index)
        if not success:
            raise HTTPException(status_code=500, detail=f"Failed to start camera device {device_index}")
        
        return {
            "success": True, 
            "message": f"Camera device set to {device_index}",
            "device": target_device
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to set camera device: {str(e)}")

@app.get("/video/current_device")
def get_current_camera_device():
    """Get information about the currently active camera device"""
    try:
        if not camera_manager.running:
            return {"success": True, "device": None, "status": "stopped"}
        
        # Get device info
        devices = detect_available_cameras(10)
        current_device = None
        for dev in devices:
            if dev['index'] == camera_manager.device and dev['works']:
                current_device = dev
                break
        
        return {
            "success": True,
            "device": current_device,
            "status": "running" if camera_manager.running else "stopped",
            "device_index": camera_manager.device
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get current device info: {str(e)}")

# Add endpoint for single image processing that matches your run.py
@app.post("/process/single")
async def process_single_image_endpoint(file: UploadFile = File(...)):
    """Process a single uploaded image for face recognition - matches run.py functionality"""
    try:
        # Read image
        content = await file.read()
        nparr = np.frombuffer(content, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if image is None:
            raise HTTPException(status_code=400, detail="Invalid image file")
        
        # Process with your optimized prototype system
        h, w = image.shape[:2]
        input_blob, scale, dx, dy = preprocess_yolo(image)
        preds = yolo_sess.run(None, {'images': input_blob})[0]
        faces = non_max_suppression(
            preds, conf_thresh, iou_thresh,
            img_shape=(h, w), input_shape=(input_size, input_size),
            pad=(dx, dy), scale=scale
        )
        
        results = []
        scene_crowding = len(faces)
        
        for i, box in enumerate(faces):
            x1, y1, x2, y2, conf = box
            if x2 <= x1 or y2 <= y1:
                continue
                
            face_img = image[y1:y2, x1:x2]
            if face_img.size == 0:
                continue
            
            quality = calculate_quality_score(face_img, conf)
            identified_name, similarity, should_log, info = attendance_system.identify_face_enhanced(
                face_img, conf, scene_crowding
            )
            
            results.append({
                "face_index": i,
                "bbox": {"x1": int(x1), "y1": int(y1), "x2": int(x2), "y2": int(y2)},
                "confidence": float(conf),
                "quality": float(quality),
                "identified_name": identified_name,
                "similarity": float(similarity) if similarity else None,
                "should_log": should_log,
                "recognition_info": info
            })
        
        return {
            "filename": file.filename,
            "faces_detected": len(faces),
            "results": results,
            "scene_crowding": scene_crowding,
            "processing_info": "Using enhanced prototype recognition system"
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing error: {str(e)}")

# Add system stats endpoint that matches your run.py functionality
@app.get("/system/stats")
async def get_system_stats():
    """Get system statistics that match your run.py functionality"""
    try:
        if not attendance_system:
            return {
                "success": False,
                "error": "SYSTEM_NOT_INITIALIZED",
                "message": "Attendance system is not initialized"
            }

        # Initialize default stats if none exist
        if not hasattr(attendance_system, 'recognition_stats'):
            attendance_system.recognition_stats = {}

        # Get recognition stats with proper default handling
        recognition_stats = attendance_system.recognition_stats
        total_attempts = sum(stats.get('attempts', 0) for stats in recognition_stats.values())
        total_successes = sum(stats.get('successes', 0) for stats in recognition_stats.values())
        
        # Calculate success rate safely
        success_rate = total_successes / total_attempts if total_attempts > 0 else 0.0

        # Safely access attendance system components with default values
        stats = {
            "legacy_faces": len(getattr(attendance_system, 'face_database', {}) or {}),
            "template_count": sum(len(templates) for templates in getattr(attendance_system, 'multi_templates', {}).values()),
            "people_count": len(getattr(attendance_system, 'multi_templates', {})),
            "today_attendance": len([
                record for record in getattr(attendance_system, 'attendance_log', [])
                if record.get("date") == datetime.now().strftime("%Y-%m-%d")
            ]),
            "total_attendance": len(getattr(attendance_system, 'attendance_log', [])),
            "success_rate": success_rate,
            "recognition_stats": recognition_stats.copy(),  # Make a copy to avoid any reference issues
            "database_info": {
                "multi_templates_people": list(getattr(attendance_system, 'multi_templates', {}).keys()),
                "legacy_people": list(getattr(attendance_system, 'face_database', {}).keys())
            }
        }
        return {"success": True, "stats": stats}
    except Exception as e:
        logger.error(f"Error getting system stats: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get system stats: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    print("🎯 Starting Enterprise Face Recognition API Server...")
    print("📊 Using optimized prototype recognition system")
    print(f"📁 Legacy database: {len(attendance_system.face_database)} faces")
    print(f"🎯 Enhanced templates: {sum(len(t) for t in attendance_system.multi_templates.values())} templates")
    uvicorn.run(app, host="127.0.0.1", port=8770)
