from __future__ import annotations

import os
import sys
import json
import time
import struct
import threading
import asyncio
from dataclasses import dataclass
from typing import Optional
import numpy as np

import cv2

# Ensure UTF-8 logs on Windows and avoid buffering delays; prefer DirectShow over MSMF
if sys.platform.startswith('win'):
    os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
    # Disable MSMF to avoid latency/warnings and force DirectShow path
    os.environ.setdefault('OPENCV_VIDEOIO_MSMF_ENABLE', '0')
    # Add better error handling for Windows camera issues
    os.environ.setdefault('OPENCV_LOG_LEVEL', 'WARNING')

# Add parent-of-src to path to import models
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

# Import the new SCRFD + EdgeFace pipeline
from models import SCRFD, EdgeFace, FaceDatabase


def calculate_overlap(box1, box2):
    """Calculate intersection over union (IoU) between two bounding boxes"""
    x1_1, y1_1, x2_1, y2_1 = box1[:4]
    x1_2, y1_2, x2_2, y2_2 = box2[:4]
    
    # Calculate intersection
    x_left = max(x1_1, x1_2)
    y_top = max(y1_1, y1_2)
    x_right = min(x2_1, x2_2)
    y_bottom = min(y2_1, y2_2)
    
    if x_right < x_left or y_bottom < y_top:
        return 0.0
    
    intersection = (x_right - x_left) * (y_bottom - y_top)
    
    # Calculate areas
    area1 = (x2_1 - x1_1) * (y2_1 - y1_1)
    area2 = (x2_2 - x1_2) * (y2_2 - y1_2)
    union = area1 + area2 - intersection
    
    return intersection / union if union > 0 else 0.0


def deduplicate_faces(faces, overlap_threshold=0.7):
    """Remove duplicate face detections based on overlap"""
    if len(faces) <= 1:
        return faces
    
    # Sort by confidence (highest first)
    faces_sorted = sorted(faces, key=lambda x: x[4], reverse=True)
    keep_faces = []
    
    for current_face in faces_sorted:
        is_duplicate = False
        for kept_face in keep_faces:
            overlap = calculate_overlap(current_face, kept_face)
            if overlap > overlap_threshold:
                is_duplicate = True
                break
        
        if not is_duplicate:
            keep_faces.append(current_face)
    
    return keep_faces


class AttendanceCooldown:
    """Manages attendance logging cooldown to prevent duplicate entries"""
    def __init__(self, cooldown_seconds=10):
        self.cooldown_seconds = cooldown_seconds
        self.last_logged = {}
    
    def can_log_attendance(self, person_name):
        """Check if person can be logged for attendance"""
        current_time = time.time()
        last_time = self.last_logged.get(person_name, 0)
        
        if current_time - last_time >= self.cooldown_seconds:
            self.last_logged[person_name] = current_time
            return True
        
        return False
    
    def cleanup_old_entries(self):
        """Clean up old entries to prevent memory growth"""
        current_time = time.time()
        expired_keys = [
            name for name, last_time in self.last_logged.items()
            if current_time - last_time > self.cooldown_seconds * 2
        ]
        for key in expired_keys:
            del self.last_logged[key]


@dataclass
class Options:
    device: int = 0
    annotate: bool = True
    fast_preview: bool = False


class ControlState:
    def __init__(self):
        self.lock = threading.Lock()
        self.paused = False
        self.request_stop = False
        self.request_device: Optional[int] = None

    def set_paused(self, value: bool):
        with self.lock:
            self.paused = value

    def get(self):
        with self.lock:
            return self.paused, self.request_stop, self.request_device

    def set_stop(self):
        with self.lock:
            self.request_stop = True

    def consume_device_switch(self) -> Optional[int]:
        with self.lock:
            d = self.request_device
            self.request_device = None
            return d


@dataclass
class CameraState:
    original_brightness: Optional[float] = None
    original_contrast: Optional[float] = None
    original_saturation: Optional[float] = None
    original_auto_exposure: Optional[float] = None
    original_fourcc: Optional[int] = None
    device: int = 0


class FaceRecognitionPipeline:
    """Main face recognition pipeline using SCRFD + EdgeFace."""
    
    def __init__(self):
        """Initialize the face recognition pipeline."""
        print("Loading SCRFD face detection model...")
        self.detector = SCRFD(
            model_path="weights/det_500m.onnx",
            conf_thres=0.5,
            iou_thres=0.4
        )
        
        print("Loading EdgeFace recognition model...")
        self.recognizer = EdgeFace(model_path="weights/edgeface-recognition.onnx")
        
        print("Initializing face database...")
        self.face_db = FaceDatabase(similarity_threshold=0.6)
        
        self.attendance_log = []
        self._load_attendance_log()
        
        print("Face recognition pipeline initialized successfully!")

    def _load_attendance_log(self):
        """Load attendance log from disk if it exists."""
        try:
            if os.path.exists("attendance_log.json"):
                with open("attendance_log.json", 'r') as f:
                    self.attendance_log = json.load(f)
        except Exception as e:
            print(f"Failed to load attendance log: {e}")
            self.attendance_log = []

    def process_frame(self, frame: np.ndarray) -> tuple[np.ndarray, list]:
        """Process a single frame for face detection and recognition.
        
        Args:
            frame (np.ndarray): Input frame
            
        Returns:
            tuple[np.ndarray, list]: Processed frame and detection results
        """
        results = []
        
        # Detect faces
        detections, keypoints = self.detector.detect(frame)
        
        if detections is None or len(detections) == 0:
            return frame, results
            
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
                    embedding = self.recognizer(frame, kps)
                    
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
        
        return frame, results

    def log_attendance(self, person_id: str, similarity: float):
        """Log attendance for a person"""
        try:
            from datetime import datetime
            record = {
                'person_id': person_id,
                'timestamp': datetime.now().isoformat(),
                'date': datetime.now().strftime('%Y-%m-%d'),
                'time': datetime.now().strftime('%H:%M:%S'),
                'similarity': float(similarity),
                'method': 'scrfd_edgeface'
            }
            self.attendance_log.append(record)
            
            # Save to disk
            with open("attendance_log.json", 'w') as f:
                json.dump(self.attendance_log, f, indent=2)
            
            return True
        except Exception as e:
            print(f"Failed to log attendance: {e}")
            return False

    def get_today_attendance(self):
        """Get today's attendance records"""
        from datetime import datetime
        today = datetime.now().strftime('%Y-%m-%d')
        return [record for record in self.attendance_log 
                if record.get('date', '').startswith(today)]

    def register_person(self, person_id: str, frame: np.ndarray, keypoints: np.ndarray):
        """Register a new person in the face database"""
        try:
            embedding = self.recognizer(frame, keypoints)
            self.face_db.add_person(person_id, embedding)
            return True
        except Exception as e:
            print(f"Failed to register person: {e}")
            return False


def store_original_camera_properties(cap: cv2.VideoCapture, device: int) -> CameraState:
    state = CameraState(device=device)
    try:
        state.original_brightness = cap.get(cv2.CAP_PROP_BRIGHTNESS)
        state.original_contrast = cap.get(cv2.CAP_PROP_CONTRAST)
        state.original_saturation = cap.get(cv2.CAP_PROP_SATURATION)
        state.original_auto_exposure = cap.get(cv2.CAP_PROP_AUTO_EXPOSURE)
        state.original_fourcc = cap.get(cv2.CAP_PROP_FOURCC)
        print(f"LOG Stored original camera properties for device {device}", file=sys.stderr)
        print(f"LOG Original: brightness={state.original_brightness:.3f}, contrast={state.original_contrast:.3f}, saturation={state.original_saturation:.3f}", file=sys.stderr)
    except Exception as e:
        print(f"LOG Could not store original camera properties: {e}", file=sys.stderr)
    return state


def restore_original_camera_properties(cap: cv2.VideoCapture, state: CameraState):
    if not cap or not cap.isOpened():
        return
    
    try:
        print(f"LOG Restoring original camera properties for device {state.device}", file=sys.stderr)
        
        if state.original_brightness is not None:
            cap.set(cv2.CAP_PROP_BRIGHTNESS, state.original_brightness)
        if state.original_contrast is not None:
            cap.set(cv2.CAP_PROP_CONTRAST, state.original_contrast)
        if state.original_saturation is not None:
            cap.set(cv2.CAP_PROP_SATURATION, state.original_saturation)
        if state.original_auto_exposure is not None:
            cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, state.original_auto_exposure)
        if state.original_fourcc is not None:
            cap.set(cv2.CAP_PROP_FOURCC, int(state.original_fourcc))
        
        print(f"LOG Original camera properties restored successfully", file=sys.stderr)
    except Exception as e:
        print(f"LOG Could not restore original camera properties: {e}", file=sys.stderr)


def open_camera_robust(device: int) -> tuple[cv2.VideoCapture, Optional[CameraState]]:
    cap = None
    original_state = None
    
    try:
        if os.name == 'nt':
            print(f"LOG Trying camera {device} with DirectShow backend", file=sys.stderr)
            cap = cv2.VideoCapture(device, cv2.CAP_DSHOW)
            if cap and cap.isOpened():
                ret, frame = cap.read()
                if ret and frame is not None:
                    original_state = store_original_camera_properties(cap, device)
                    
                    try:
                        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc('M', 'J', 'P', 'G'))
                        cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 1.0)
                        print(f"LOG Camera {device} essential properties set (preserving user settings)", file=sys.stderr)
                    except Exception as e:
                        print(f"LOG Could not set essential camera properties: {e}", file=sys.stderr)
                    
                    print(f"LOG Camera {device} opened successfully with DirectShow", file=sys.stderr)
                    return cap, original_state
                else:
                    print(f"LOG Camera {device} opened but no frame with DirectShow", file=sys.stderr)
                    cap.release()
                    cap = None
        
        if cap is None:
            print(f"LOG Trying camera {device} with default backend", file=sys.stderr)
            cap = cv2.VideoCapture(device)
            if cap and cap.isOpened():
                ret, frame = cap.read()
                if ret and frame is not None:
                    original_state = store_original_camera_properties(cap, device)
                    
                    try:
                        cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 1.0)
                        print(f"LOG Camera {device} essential properties set (preserving user settings)", file=sys.stderr)
                    except Exception as e:
                        print(f"LOG Could not set essential camera properties: {e}", file=sys.stderr)
                    
                    print(f"LOG Camera {device} opened successfully with default backend", file=sys.stderr)
                    return cap, original_state
                else:
                    print(f"LOG Camera {device} opened but no frame with default backend", file=sys.stderr)
                    cap.release()
                    cap = None
        
        if cap is None:
            print(f"LOG All methods failed for camera {device}, returning empty capture", file=sys.stderr)
            return cv2.VideoCapture(), None
        
    except Exception as e:
        print(f"LOG Camera {device} opening failed with error: {e}", file=sys.stderr)
        if cap:
            try:
                cap.release()
            except Exception:
                pass
        return cv2.VideoCapture(), None
    
    return cap, original_state


def control_loop(ctrl: ControlState):
    """Read JSON control messages from stdin (blocking in a thread)."""
    while True:
        line = sys.stdin.readline()
        if not line:
            # stdin closed -> stop
            ctrl.set_stop()
            return
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            print(f"[video_worker] invalid control JSON: {line!r}", file=sys.stderr)
            continue
        action = msg.get('action')
        if action == 'pause':
            ctrl.set_paused(True)
            print(f"EVT {json.dumps({'type': 'video.paused'})}", file=sys.stderr)
        elif action == 'resume':
            ctrl.set_paused(False)
            print(f"EVT {json.dumps({'type': 'video.resumed'})}", file=sys.stderr)
        elif action == 'stop':
            ctrl.set_stop()
            print(f"EVT {json.dumps({'type': 'video.stopping'})}", file=sys.stderr)
        elif action == 'set_device':
            try:
                d = int(msg.get('device', 0))
                with ctrl.lock:
                    ctrl.request_device = d
                print(f"EVT {json.dumps({'type': 'video.switch_device', 'device': d})}", file=sys.stderr)
            except Exception:
                print("[video_worker] set_device missing/invalid 'device'", file=sys.stderr)
        else:
            print(f"[video_worker] unknown action: {action}", file=sys.stderr)


def write_frame(jpeg: bytes):
    """Write length-prefixed JPEG to stdout (uint32_le)."""
    try:
        sys.stdout.buffer.write(struct.pack('<I', len(jpeg)))
        sys.stdout.buffer.write(jpeg)
        sys.stdout.buffer.flush()
    except BrokenPipeError:
        # consumer went away
        raise


def broadcast_websocket_event(event_data):
    """
    Broadcast WebSocket event to all connected clients.
    This function sends events via stderr that the main process can capture and forward.
    """
    try:
        # Send WebSocket events via stderr with a special prefix
        ws_event = {
            "type": "websocket_broadcast",
            "event": event_data
        }
        print(f"WS_BROADCAST {json.dumps(ws_event)}", file=sys.stderr)
    except Exception as e:
        print(f"LOG WebSocket broadcast error: {e}", file=sys.stderr)


def notify_attendance_logged(person_name, confidence, attendance_record):
    """Notify WebSocket clients about new attendance record."""
    try:
        broadcast_websocket_event({
            "type": "attendance_logged",
            "data": {
                "person_name": person_name,
                "confidence": float(confidence),
                "record": attendance_record,
                "timestamp": time.time()
            }
        })
    except Exception as e:
        print(f"LOG Attendance notification error: {e}", file=sys.stderr)


def streaming_camera_recognition(pipeline: FaceRecognitionPipeline, opts: Options, ctrl: ControlState):
    cap, original_state = open_camera_robust(opts.device)
    if not cap.isOpened():
        print(f"EVT {json.dumps({'type': 'video.error', 'message': f'Could not open camera {opts.device}'})}", file=sys.stderr)
        return 2

    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)
        cap.set(cv2.CAP_PROP_FPS, 30)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        print(f"LOG Camera performance settings applied", file=sys.stderr)
    except Exception as e:
        print(f"LOG Could not set performance settings: {e}", file=sys.stderr)

    print(f"EVT {json.dumps({'type': 'video.started', 'device': opts.device, 'fast_preview': opts.fast_preview})}", file=sys.stderr)
    
    if opts.fast_preview:
        print(f"EVT {json.dumps({'type': 'video.fast_preview_ready'})}", file=sys.stderr)
    
    consecutive_fail = 0
    frame_count = 0
    last_frame_time = time.time()
    target_fps = 25
    frame_interval = 1.0 / target_fps
    
    attendance_cooldown = AttendanceCooldown(cooldown_seconds=8)
    cleanup_counter = 0
    
    while True:
        paused, req_stop, _ = ctrl.get()
        if req_stop:
            break
        if paused:
            time.sleep(0.02)
            continue

        # Device switch request?
        nd = ctrl.consume_device_switch()
        if nd is not None:
            try:
                if cap is not None:
                    if original_state:
                        restore_original_camera_properties(cap, original_state)
                    cap.release()
                cap, original_state = open_camera_robust(nd)
                if not cap or not cap.isOpened():
                    print(f"EVT {json.dumps({'type': 'video.error', 'message': f'Failed to switch to camera {nd}'})}", file=sys.stderr)
                else:
                    opts.device = nd
                    print(f"EVT {json.dumps({'type': 'video.device', 'device': nd})}", file=sys.stderr)
                    consecutive_fail = 0
            except Exception as e:
                print(f"EVT {json.dumps({'type': 'video.error', 'message': f'Switch device error: {e}'})}", file=sys.stderr)

        if cap is None or not cap.isOpened():
            time.sleep(0.05)
            continue

        ret, frame = cap.read()
        if not ret or frame is None or frame.size == 0:
            consecutive_fail += 1
            if consecutive_fail >= 10:
                try:
                    if cap:
                        if original_state:
                            restore_original_camera_properties(cap, original_state)
                        cap.release()
                except Exception:
                    pass
                cap, original_state = open_camera_robust(opts.device)
                consecutive_fail = 0
            else:
                time.sleep(0.005)
            continue

        consecutive_fail = 0
        
        # Frame rate limiting for smooth streaming
        current_time = time.time()
        time_since_last_frame = current_time - last_frame_time
        if time_since_last_frame < frame_interval:
            time.sleep(0.005)  # Small sleep to prevent busy waiting
            continue
        last_frame_time = current_time
        
        # Use new SCRFD + EdgeFace pipeline
        orig = frame.copy()
        h, w = frame.shape[:2]
        frame_count += 1
        
        # Skip recognition for first few seconds in fast preview mode
        skip_recognition = opts.fast_preview and frame_count < 90  # ~3 seconds at 30fps
        
        # Run face recognition on every frame for maximum detection accuracy
        if opts.annotate and not skip_recognition:
            try:
                processed_frame, results = pipeline.process_frame(frame)
                
                # Process each detection result
                for result in results:
                    x1, y1, x2, y2 = result['bbox']
                    conf = result['confidence']
                    person_id = result.get('person_id')
                    similarity = result.get('similarity', 0.0)
                    status = result.get('status', 'unknown')
                    
                    # Check if attendance can be logged (with cooldown protection)
                    can_log = (person_id and 
                              similarity >= 0.75 and 
                              attendance_cooldown.can_log_attendance(person_id))
                    
                    if can_log:
                        # Log attendance
                        logged_successfully = pipeline.log_attendance(person_id, similarity)
                        if logged_successfully:
                            print(f"LOG Attendance logged: {person_id} (confidence: {similarity:.3f})", file=sys.stderr)
                            
                            # Notify WebSocket clients
                            try:
                                latest_record = pipeline.attendance_log[-1] if pipeline.attendance_log else None
                                if latest_record:
                                    notify_attendance_logged(person_id, similarity, latest_record)
                            except Exception as e:
                                print(f"LOG Failed to get latest attendance record: {e}", file=sys.stderr)
                    
                    # Enhanced visualization with attendance status
                    attendance_logged = can_log
                    
                    # Color coding based on recognition status
                    if person_id and similarity >= 0.75:
                        # High confidence - green box
                        color = (0, 255, 0) if attendance_logged else (0, 200, 100)
                        status_indicator = "✓" if attendance_logged else "⏳"
                        label = f"{status_indicator} {person_id} ({similarity:.3f})"
                    elif person_id and similarity >= 0.60:
                        # Medium confidence - yellow box
                        color = (0, 255, 255)
                        label = f"{person_id}? ({similarity:.3f})"
                    else:
                        # Unknown or too low confidence - red box
                        color = (0, 0, 255)
                        label = f"Unknown (Conf:{conf:.2f})"
                    
                    # Draw bounding box and labels
                    cv2.rectangle(orig, (x1, y1), (x2, y2), color, 2)
                    cv2.putText(orig, label, (x1, y1 - 10), 
                               cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
                
                # Enhanced UI overlay
                cv2.putText(orig, "Mode: SCRFD + EDGEFACE RECOGNITION", (10, 30), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                
                # Performance metrics
                fps_text = f"Faces: {len(results)} | Duplicate Prevention Active"
                cv2.putText(orig, fps_text, (10, 60), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
                
                # Periodic cleanup of attendance cooldown
                cleanup_counter += 1
                if cleanup_counter % 150 == 0:  # Every ~5 seconds at 30fps
                    attendance_cooldown.cleanup_old_entries()
                
                # Show today's attendance count
                today_count = len(pipeline.get_today_attendance())
                cv2.putText(orig, f"Today's Attendance: {today_count}", (10, h - 20), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
                
            except Exception as e:
                print(f"[video_worker] inference error: {e}", file=sys.stderr)
        elif skip_recognition:
            # Show loading indicator during fast preview mode
            cv2.putText(orig, "Mode: FAST PREVIEW - Loading Models...", (10, 30), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
            cv2.putText(orig, f"Frame: {frame_count}/90", (10, 60), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
            
            # Signal when switching to full recognition mode
            if frame_count == 90:
                print(f"EVT {json.dumps({'type': 'video.recognition_ready'})}", file=sys.stderr)
        else:
            # Basic streaming mode without annotation
            cv2.putText(orig, "Mode: PREVIEW ONLY", (10, 30), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

        # Encode and send with optimized quality for streaming
        try:
            # Use lower quality for smooth streaming performance
            ok, buf = cv2.imencode('.jpg', orig, [cv2.IMWRITE_JPEG_QUALITY, 75])
        except Exception as e:
            print(f"[video_worker] encode error: {e}", file=sys.stderr)
            ok, buf = False, None
        if ok and buf is not None:
            try:
                write_frame(buf.tobytes())
            except BrokenPipeError:
                # Consumer closed; exit cleanly
                return 0
            except Exception as e:
                print(f"[video_worker] send error: {e}", file=sys.stderr)
        else:
            time.sleep(0.005)

    if original_state:
        restore_original_camera_properties(cap, original_state)
    cap.release()
    print(f"EVT {json.dumps({'type': 'video.stopped'})}", file=sys.stderr)
    return 0


def run(opts: Options):
    ctrl = ControlState()
    
    # Initialize the new face recognition pipeline
    try:
        pipeline = FaceRecognitionPipeline()
        print(f"EVT {json.dumps({'type': 'video.models_loaded'})}", file=sys.stderr)
    except Exception as e:
        print(f"EVT {json.dumps({'type': 'video.error', 'message': f'Failed to initialize pipeline: {e}'})}", file=sys.stderr)
        return 1
    
    threading.Thread(target=control_loop, args=(ctrl,), daemon=True).start()

    # Start camera recognition
    return streaming_camera_recognition(pipeline, opts, ctrl)


def parse_args() -> Options:
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--device', type=int, default=0)
    p.add_argument('--no-annotate', action='store_true')
    p.add_argument('--fast-preview', action='store_true', help='Start with fast preview mode (no recognition for first 3 seconds)')
    a = p.parse_args()
    return Options(device=a.device, annotate=not a.no_annotate, fast_preview=a.fast_preview)


if __name__ == '__main__':
    opts = parse_args()
    try:
        code = run(opts)
    except Exception as e:
        print(f"[video_worker] fatal: {e}", file=sys.stderr)
        code = 1
    sys.exit(code)