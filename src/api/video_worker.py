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

import cv2

# Ensure UTF-8 logs on Windows and avoid buffering delays; prefer DirectShow over MSMF
if sys.platform.startswith('win'):
    os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
    # Disable MSMF to avoid latency/warnings and force DirectShow path
    os.environ.setdefault('OPENCV_VIDEOIO_MSMF_ENABLE', '0')
    # Add better error handling for Windows camera issues
    os.environ.setdefault('OPENCV_LOG_LEVEL', 'WARNING')

# Add parent-of-src to path to import experiments
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

# Direct imports from prototype - only what we actually use
from experiments.prototype.main import (
    preprocess_yolo,
    non_max_suppression,
    yolo_sess,
    input_size,
    conf_thresh,
    iou_thresh,
    Main,
)
import math
from experiments.prototype.utils import calculate_quality_score


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


def optimized_non_max_suppression(predictions, conf_thres=0.65, iou_thres=0.75, img_shape=None, input_shape=(640, 640), pad=(0, 0), scale=1.0):
    """Enhanced NMS with better parameters for face detection"""
    # Use the original NMS but with optimized parameters
    faces = non_max_suppression(predictions, conf_thres, iou_thres, img_shape, input_shape, pad, scale)
    
    # Apply additional deduplication
    faces = deduplicate_faces(faces, overlap_threshold=0.6)
    
    return faces


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


def notify_database_updated(stats):
    """Notify WebSocket clients about database updates."""
    try:
        broadcast_websocket_event({
            "type": "database_updated", 
            "data": {
                "stats": stats,
                "timestamp": time.time()
            }
        })
    except Exception as e:
        print(f"LOG Database update notification error: {e}", file=sys.stderr)


def streaming_camera_recognition(app, opts: Options, ctrl: ControlState):
    cap, original_state = open_camera_robust(opts.device)
    if not cap.isOpened():
        print(f"EVT {json.dumps({'type': 'video.error', 'message': f'Could not open camera {opts.device}'})}", file=sys.stderr)
        return 2

    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)
        cap.set(cv2.CAP_PROP_FPS, 30)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        print(f"LOG Camera performance settings applied (preserving user color settings)", file=sys.stderr)
    except Exception as e:
        print(f"LOG Could not set performance settings: {e}", file=sys.stderr)

    print(f"EVT {json.dumps({'type': 'video.started', 'device': opts.device, 'fast_preview': opts.fast_preview})}", file=sys.stderr)
    

    if opts.fast_preview:
        print(f"EVT {json.dumps({'type': 'video.fast_preview_ready'})}", file=sys.stderr)
    
    consecutive_fail = 0
    frame_count = 0
    last_db_check = time.time()
    db_check_interval = 2.0
    
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
        
        # Enhanced frame validation and color correction
        if frame is not None and len(frame.shape) == 3 and frame.shape[2] == 3:
            try:
                # Check if frame has unusual color distribution (indicating wrong color space)
                mean_values = cv2.mean(frame)[:3]  # Get mean of BGR channels
                
                # Check for common color space issues
                if abs(mean_values[0] - mean_values[1]) < 5 and abs(mean_values[1] - mean_values[2]) < 5:
                    # All channels very similar - might be grayscale in BGR format
                    if mean_values[0] < 15 or mean_values[0] > 240:
                        # Very dark or very bright uniform image - likely corrupted
                        continue
                
                # Check for inverted/negative colors (common DirectShow issue)
                if mean_values[0] > 200 and mean_values[1] > 200 and mean_values[2] > 200:
                    # Very bright image might be inverted - skip this frame
                    print(f"LOG Detected potential color inversion, skipping frame", file=sys.stderr)
                    continue
                    
            except Exception as e:
                print(f"LOG Frame color validation error: {e}", file=sys.stderr)
                continue
        
        # Frame rate limiting for smooth streaming
        current_time = time.time()
        time_since_last_frame = current_time - last_frame_time
        if time_since_last_frame < frame_interval:
            time.sleep(0.005)  # Small sleep to prevent busy waiting
            continue
        last_frame_time = current_time
        
        # Check for database updates periodically
        if current_time - last_db_check > db_check_interval:
            try:
                # Reload face databases to pick up new people added via API
                old_face_count = len(app.face_database)
                old_template_count = sum(len(templates) for templates in app.multi_templates.values())
                
                app.load_face_database()
                app.load_multi_templates()
                
                new_face_count = len(app.face_database)
                new_template_count = sum(len(templates) for templates in app.multi_templates.values())
                
                if new_face_count != old_face_count or new_template_count != old_template_count:
                    print(f"LOG Database reloaded: {new_face_count} faces, {new_template_count} templates", file=sys.stderr)
                    
                    # Notify WebSocket clients about database changes
                    notify_database_updated({
                        "old_face_count": old_face_count,
                        "new_face_count": new_face_count,
                        "old_template_count": old_template_count,
                        "new_template_count": new_template_count,
                        "people_count": len(app.multi_templates)
                    })
                
                last_db_check = current_time
            except Exception as e:
                print(f"LOG Database reload error: {e}", file=sys.stderr)
                last_db_check = current_time  # Don't spam errors
        
        # Use optimized processing logic with intelligent frame skipping
        orig = frame.copy()
        h, w = frame.shape[:2]
        frame_count += 1
        
        # In fast preview mode, skip heavy processing for first few seconds
        skip_recognition = opts.fast_preview and frame_count < 90  # ~3 seconds at 30fps
        
        # Run continuous recognition on every frame for maximum detection accuracy
        if opts.annotate and not skip_recognition:
            try:
                # Optimized preprocessing for continuous recognition
                input_blob, scale, dx, dy = preprocess_yolo(frame)
                
                # Run YOLO inference with optimized NMS to prevent duplicates
                preds = yolo_sess.run(None, {'images': input_blob})[0]
                faces = optimized_non_max_suppression(preds, conf_thres=0.65, iou_thres=0.75, 
                                                     img_shape=(h, w), input_shape=(input_size, input_size), 
                                                     pad=(dx, dy), scale=scale)

                scene_crowding = len(faces)
                
                # Process each detected face with optimized checks
                for box in faces:
                    x1, y1, x2, y2, conf = box
                    
                    # Quick bounds checking for efficiency
                    if x2 <= x1 or y2 <= y1 or x1 < 0 or y1 < 0 or x2 > w or y2 > h:
                        continue

                    face_img = orig[y1:y2, x1:x2]
                    if face_img.size == 0 or face_img.shape[0] < 20 or face_img.shape[1] < 20:
                        continue  # Skip very small faces for efficiency
                    
                    # Calculate quality score (same as prototype)
                    quality = calculate_quality_score(face_img, conf)
                    
                    # Enhanced identification (same as prototype)
                    identified_name, similarity, should_log, info = app.identify_face_enhanced(
                        face_img, conf, scene_crowding
                    )
                    
                    # Check if attendance can be logged (with cooldown protection)
                    can_log = identified_name and should_log and attendance_cooldown.can_log_attendance(identified_name)
                    
                    if can_log:
                        # Log attendance with enhanced info (with cooldown protection)
                        logged_successfully = app.log_attendance(identified_name, similarity, info)
                        if logged_successfully:
                            print(f"LOG Attendance logged: {identified_name} (confidence: {similarity:.3f})", file=sys.stderr)
                            
                            # Save attendance to disk immediately
                            try:
                                app.save_attendance_log()
                                print(f"LOG Attendance saved to disk", file=sys.stderr)
                            except Exception as e:
                                print(f"LOG Failed to save attendance: {e}", file=sys.stderr)
                            
                            # Get the latest attendance record for WebSocket notification
                            try:
                                latest_record = app.attendance_log[-1] if app.attendance_log else None
                                if latest_record:
                                    notify_attendance_logged(identified_name, similarity, latest_record)
                            except Exception as e:
                                print(f"LOG Failed to get latest attendance record: {e}", file=sys.stderr)
                    
                    # Enhanced visualization with attendance status
                    attendance_logged = can_log
                    
                    # BALANCED: Reasonable visualization thresholds
                    if identified_name and should_log and similarity >= 0.75:
                        # High confidence - green box
                        color = (0, 255, 0) if attendance_logged else (0, 200, 100)
                        method_text = info.get('method', 'unknown')[:8]  # Truncate for display
                        status_indicator = "✓" if attendance_logged else "⏳"
                        label = f"{status_indicator} {identified_name} ({similarity:.3f}) [{method_text}]"
                    elif identified_name and similarity >= 0.70:
                        # Medium confidence - yellow box
                        color = (0, 255, 255)
                        label = f"{identified_name}? ({similarity:.3f})"
                    else:
                        # Unknown or too low confidence - red box
                        color = (0, 0, 255)
                        label = f"Unknown (Q:{quality:.2f})"
                    
                    # Draw enhanced bounding box (same as prototype)
                    cv2.rectangle(orig, (x1, y1), (x2, y2), color, 2)
                    
                    # Multi-line label with enhanced info (same as prototype)
                    cv2.putText(orig, label, (x1, y1 - 35), 
                               cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
                    
                    if 'conditions' in info and info['conditions']:
                        conditions_text = ", ".join(info['conditions'][:2])  # Show first 2 conditions
                        cv2.putText(orig, f"Cond: {conditions_text}", (x1, y1 - 20), 
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
                    
                    # Quality and threshold info (same as prototype)
                    threshold_used = info.get('threshold_used', 0.20)
                    cv2.putText(orig, f"Q:{quality:.2f} T:{threshold_used:.2f}", (x1, y1 - 5), 
                               cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
                
                # Enhanced UI overlay with duplicate prevention info
                cv2.putText(orig, "Mode: SMART RECOGNITION", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                
                # Performance metrics showing smart recognition
                fps_text = f"Faces: {len(faces)} | Duplicate Prevention Active"
                cv2.putText(orig, fps_text, (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
                
                # Periodic cleanup of attendance cooldown
                cleanup_counter += 1
                if cleanup_counter % 150 == 0:  # Every ~5 seconds at 30fps
                    attendance_cooldown.cleanup_old_entries()
                
                # Show today's attendance count (same as prototype)
                today_count = len(app.get_today_attendance())
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
            cv2.putText(orig, "Mode: PREVIEW ONLY", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

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


def streaming_camera_recognition_fast(model_future, opts: Options, ctrl: ControlState):
    cap, original_state = open_camera_robust(opts.device)
    if not cap.isOpened():
        print(f"EVT {json.dumps({'type': 'video.error', 'message': f'Could not open camera {opts.device}'})}", file=sys.stderr)
        return 2

    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)
        cap.set(cv2.CAP_PROP_FPS, 30)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        print(f"LOG Camera performance settings applied (preserving user color settings)", file=sys.stderr)
    except Exception as e:
        print(f"LOG Could not set performance settings: {e}", file=sys.stderr)

    print(f"EVT {json.dumps({'type': 'video.started', 'device': opts.device, 'fast_preview': True})}", file=sys.stderr)
    print(f"EVT {json.dumps({'type': 'video.fast_preview_ready'})}", file=sys.stderr)
    
    frame_count = 0
    attendance = None
    models_loaded = False
    
    attendance_cooldown = AttendanceCooldown(cooldown_seconds=8)
    cleanup_counter = 0
    
    while True:
        paused, req_stop, _ = ctrl.get()
        if req_stop:
            break
        if paused:
            time.sleep(0.02)
            continue


        if not models_loaded and model_future.done():
            try:
                attendance = model_future.result()
                models_loaded = True
                print(f"EVT {json.dumps({'type': 'video.recognition_ready'})}", file=sys.stderr)
            except Exception as e:
                print(f"LOG Model loading error: {e}", file=sys.stderr)
                models_loaded = True


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
            except Exception as e:
                print(f"EVT {json.dumps({'type': 'video.error', 'message': f'Switch device error: {e}'})}", file=sys.stderr)

        if cap is None or not cap.isOpened():
            time.sleep(0.05)
            continue

        ret, frame = cap.read()
        if not ret or frame is None or frame.size == 0:
            time.sleep(0.005)
            continue
        
        # Enhanced frame validation and color correction
        if frame is not None and len(frame.shape) == 3 and frame.shape[2] == 3:
            try:
                # Check if frame has unusual color distribution (indicating wrong color space)
                mean_values = cv2.mean(frame)[:3]  # Get mean of BGR channels
                
                # Check for common color space issues
                if abs(mean_values[0] - mean_values[1]) < 5 and abs(mean_values[1] - mean_values[2]) < 5:
                    # All channels very similar - might be grayscale in BGR format
                    if mean_values[0] < 15 or mean_values[0] > 240:
                        # Very dark or very bright uniform image - likely corrupted
                        continue
                
                # Check for inverted/negative colors (common DirectShow issue)
                if mean_values[0] > 200 and mean_values[1] > 200 and mean_values[2] > 200:
                    # Very bright image might be inverted - skip this frame
                    print(f"LOG Detected potential color inversion, skipping frame", file=sys.stderr)
                    continue
                    
            except Exception as e:
                print(f"LOG Frame color validation error: {e}", file=sys.stderr)
                continue
        
        orig = frame.copy()
        h, w = frame.shape[:2]
        frame_count += 1
        
        # Only do recognition if models are loaded and we want annotation
        if models_loaded and attendance is not None and opts.annotate:
            try:
                # Optimized recognition pipeline with duplicate prevention
                input_blob, scale, dx, dy = preprocess_yolo(frame)
                preds = yolo_sess.run(None, {'images': input_blob})[0]
                faces = optimized_non_max_suppression(preds, conf_thres=0.65, iou_thres=0.75, 
                                                     img_shape=(h, w), input_shape=(input_size, input_size), 
                                                     pad=(dx, dy), scale=scale)

                scene_crowding = len(faces)
                for box in faces:
                    x1, y1, x2, y2, conf = box
                    
                    # Quick bounds checking for efficiency
                    if x2 <= x1 or y2 <= y1 or x1 < 0 or y1 < 0 or x2 > w or y2 > h:
                        continue

                    face_img = orig[y1:y2, x1:x2]
                    if face_img.size == 0 or face_img.shape[0] < 20 or face_img.shape[1] < 20:
                        continue  # Skip very small faces for efficiency
                    
                    quality = calculate_quality_score(face_img, conf)
                    identified_name, similarity, should_log, info = attendance.identify_face_enhanced(
                        face_img, conf, scene_crowding
                    )
                    
                    # Apply attendance cooldown to prevent duplicate logging
                    can_log = identified_name and should_log and attendance_cooldown.can_log_attendance(identified_name)
                    
                    if can_log:
                        logged_successfully = attendance.log_attendance(identified_name, similarity, info)
                        if logged_successfully:
                            print(f"LOG Attendance logged: {identified_name} (confidence: {similarity:.3f})", file=sys.stderr)
                            
                            # Get the latest attendance record for WebSocket notification
                            try:
                                latest_record = attendance.attendance_log[-1] if attendance.attendance_log else None
                                if latest_record:
                                    notify_attendance_logged(identified_name, similarity, latest_record)
                            except Exception as e:
                                print(f"LOG Failed to get latest attendance record: {e}", file=sys.stderr)
                    
                    # Enhanced visualization with attendance status
                    attendance_logged = can_log
                    
                    if identified_name and should_log:
                        # Color coding: bright green if logged, darker if cooldown
                        color = (0, 255, 0) if attendance_logged else (0, 200, 100)
                        method_text = info.get('method', 'unknown')[:8]
                        status_indicator = "✓" if attendance_logged else "⏳"
                        label = f"{status_indicator} {identified_name} ({similarity:.3f}) [{method_text}]"
                    elif identified_name:
                        color = (0, 255, 255)
                        label = f"{identified_name}? ({similarity:.3f})"
                    else:
                        color = (0, 0, 255)
                        label = f"Unknown (Q:{quality:.2f})"
                    
                    cv2.rectangle(orig, (x1, y1), (x2, y2), color, 2)
                    cv2.putText(orig, label, (x1, y1 - 10), 
                               cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
                
                # Status overlay for smart recognition mode
                cv2.putText(orig, "Mode: SMART RECOGNITION", (10, 30), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                cv2.putText(orig, f"Faces: {len(faces)} | Duplicate Prevention Active", (10, 60), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
                
                # Periodic cleanup of attendance cooldown
                cleanup_counter += 1
                if cleanup_counter % 150 == 0:  # Every ~5 seconds at 30fps
                    attendance_cooldown.cleanup_old_entries()
                
            except Exception as e:
                print(f"LOG Recognition error: {e}", file=sys.stderr)
                cv2.putText(orig, "Mode: PREVIEW (Recognition Error)", (10, 30), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
        elif not models_loaded:
            # Still loading models - show preview with loading indicator
            cv2.putText(orig, "Mode: FAST PREVIEW - Loading Models...", (10, 30), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
            cv2.putText(orig, "Camera ready instantly!", (10, 60), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        else:
            # Preview only mode
            cv2.putText(orig, "Mode: PREVIEW ONLY", (10, 30), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

        # Encode and send frame with optimized quality
        try:
            ok, buf = cv2.imencode('.jpg', orig, [cv2.IMWRITE_JPEG_QUALITY, 75])
            if ok and buf is not None:
                write_frame(buf.tobytes())
        except BrokenPipeError:
            return 0
        except Exception as e:
            print(f"LOG Frame send error: {e}", file=sys.stderr)

    if original_state:
        restore_original_camera_properties(cap, original_state)
    cap.release()
    print(f"EVT {json.dumps({'type': 'video.stopped'})}", file=sys.stderr)
    return 0


def run(opts: Options):
    ctrl = ControlState()
    
    if opts.fast_preview:
        # In fast preview mode, start camera first, load models in background
        print(f"EVT {json.dumps({'type': 'video.loading_models'})}", file=sys.stderr)
        
        # Start with minimal initialization for camera preview
        attendance = None
        
        # Load models in background thread
        def load_models():
            global attendance
            try:
                print(f"LOG Background model loading started", file=sys.stderr)
                temp_attendance = Main()
                # Do a warmup inference
                import numpy as np
                dummy_frame = np.zeros((480, 640, 3), dtype=np.uint8)
                from experiments.prototype.main import preprocess_yolo, non_max_suppression, conf_thresh, iou_thresh, input_size
                input_blob, scale, dx, dy = preprocess_yolo(dummy_frame)
                _ = yolo_sess.run(None, {'images': input_blob})[0]
                print(f"EVT {json.dumps({'type': 'video.models_loaded'})}", file=sys.stderr)
                # Use a simple assignment instead of global modification during streaming
                return temp_attendance
            except Exception as e:
                print(f"LOG Background model loading failed: {e}", file=sys.stderr)
                return Main()  # Fallback to basic loading
        
        # Start model loading in background
        import concurrent.futures
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        model_future = executor.submit(load_models)
        
        # Start camera immediately with no models for preview
        attendance = None
    else:
        # Normal mode - load everything upfront
        attendance = Main()
    
    threading.Thread(target=control_loop, args=(ctrl,), daemon=True).start()

    # Use adapted prototype camera function
    if opts.fast_preview and attendance is None:
        # Start with preview, switch to full recognition when models are ready
        return streaming_camera_recognition_fast(model_future, opts, ctrl)
    else:
        return streaming_camera_recognition(attendance, opts, ctrl)


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