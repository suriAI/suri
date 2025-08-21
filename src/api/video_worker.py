"""
Video Worker: Real-time OpenCV inference over stdout for Electron child_process

Design
- Opens the camera once (prefers DirectShow on Windows), sets low-latency options.
- Runs detection + recognition using the same prototype pipeline.
- Annotates frames and writes them as length-prefixed JPEG to stdout:
  [uint32_le length][JPEG bytes]
- Logs diagnostics and JSON events (e.g., errors) to stderr (never stdout).
- Listens for optional JSON control commands on stdin (device switch, pause, resume, stop).

Why
- Avoids WebSocket overhead for video streaming. Meant to be spawned from Electron main.

Usage
  python -m src.api.video_worker --device 0 --width 640 --height 480 --fps 30 --annotate

Protocol
- Frames: stdout stream with length-prefixed JPEGs (uint32 little-endian)
- Control: newline-delimited JSON commands on stdin, e.g.
    {"action":"set_device","device":1}
    {"action":"pause"}
    {"action":"resume"}
    {"action":"stop"}
  Responses and logs are written to stderr as JSON lines prefixed with EVT or LOG for easy parsing.
"""

from __future__ import annotations

import os
import sys
import json
import time
import struct
import threading
from dataclasses import dataclass
from typing import Optional

import cv2

# Ensure UTF-8 logs on Windows and avoid buffering delays; prefer DirectShow over MSMF
if sys.platform.startswith('win'):
    os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
    # Disable MSMF to avoid latency/warnings and force DirectShow path
    os.environ.setdefault('OPENCV_VIDEOIO_MSMF_ENABLE', '0')

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
from experiments.prototype.utils import calculate_quality_score


@dataclass
class Options:
    device: int = 0
    annotate: bool = True


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


def streaming_camera_recognition(app, opts: Options, ctrl: ControlState):
    """Adapted from prototype's live_camera_recognition for streaming"""
    cap = cv2.VideoCapture(opts.device)
    if not cap.isOpened():
        print(f"EVT {json.dumps({'type': 'video.error', 'message': f'Could not open camera {opts.device}'})}", file=sys.stderr)
        return 2

    print(f"EVT {json.dumps({'type': 'video.started', 'device': opts.device})}", file=sys.stderr)
    
    consecutive_fail = 0
    frame_count = 0
    last_db_check = time.time()
    db_check_interval = 2.0  # Check for database updates every 2 seconds
    
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
                    cap.release()
                cap = cv2.VideoCapture(nd)
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
                        cap.release()
                except Exception:
                    pass
                cap = cv2.VideoCapture(opts.device)
                consecutive_fail = 0
            else:
                time.sleep(0.005)
            continue

        consecutive_fail = 0
        
        # Check for database updates periodically
        current_time = time.time()
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
                
                last_db_check = current_time
            except Exception as e:
                print(f"LOG Database reload error: {e}", file=sys.stderr)
                last_db_check = current_time  # Don't spam errors
        
        # Use prototype's exact processing logic
        orig = frame.copy()
        h, w = frame.shape[:2]
        frame_count += 1
        
        if opts.annotate:
            try:
                # Preprocess for YOLO (same as prototype)
                input_blob, scale, dx, dy = preprocess_yolo(frame)
                
                # Run YOLO inference (same as prototype)
                preds = yolo_sess.run(None, {'images': input_blob})[0]
                faces = non_max_suppression(preds, conf_thresh, iou_thresh, 
                                           img_shape=(h, w), input_shape=(input_size, input_size), 
                                           pad=(dx, dy), scale=scale)

                scene_crowding = len(faces)
                
                # Process each detected face (same as prototype)
                for box in faces:
                    x1, y1, x2, y2, conf = box
                    
                    if x2 <= x1 or y2 <= y1:
                        continue

                    face_img = orig[y1:y2, x1:x2]
                    if face_img.size == 0:
                        continue
                    
                    # Calculate quality score (same as prototype)
                    quality = calculate_quality_score(face_img, conf)
                    
                    # Enhanced identification (same as prototype)
                    identified_name, similarity, should_log, info = app.identify_face_enhanced(
                        face_img, conf, scene_crowding
                    )
                    
                    if identified_name and should_log:
                        # Log attendance with enhanced info (same as prototype)
                        app.log_attendance(identified_name, similarity, info)
                    
                    # Visualization based on confidence and method (same as prototype)
                    if identified_name and should_log:
                        # High confidence - green box
                        color = (0, 255, 0)
                        method_text = info.get('method', 'unknown')[:8]  # Truncate for display
                        label = f"{identified_name} ({similarity:.3f}) [{method_text}]"
                    elif identified_name:
                        # Low confidence - yellow box
                        color = (0, 255, 255)
                        label = f"{identified_name}? ({similarity:.3f})"
                    else:
                        # Unknown - red box
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
                
                # Enhanced UI overlay (same as prototype)
                cv2.putText(orig, "Mode: STREAMING", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
                
                # Performance metrics (same as prototype)
                fps_text = f"Faces: {len(faces)} | Crowding: {scene_crowding}"
                cv2.putText(orig, fps_text, (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
                
                # Show today's attendance count (same as prototype)
                today_count = len(app.get_today_attendance())
                cv2.putText(orig, f"Today's Attendance: {today_count}", (10, h - 20), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
                
            except Exception as e:
                print(f"[video_worker] inference error: {e}", file=sys.stderr)

        # Encode and send
        try:
            ok, buf = cv2.imencode('.jpg', orig, [cv2.IMWRITE_JPEG_QUALITY, 85])
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

    cap.release()
    print(f"EVT {json.dumps({'type': 'video.stopped'})}", file=sys.stderr)
    return 0


def run(opts: Options):
    # Load recognition system once (same as prototype)
    attendance = Main()
    ctrl = ControlState()
    threading.Thread(target=control_loop, args=(ctrl,), daemon=True).start()

    # Use adapted prototype camera function
    return streaming_camera_recognition(attendance, opts, ctrl)


def parse_args() -> Options:
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--device', type=int, default=0)
    p.add_argument('--no-annotate', action='store_true')
    a = p.parse_args()
    return Options(device=a.device, annotate=not a.no_annotate)


if __name__ == '__main__':
    opts = parse_args()
    try:
        code = run(opts)
    except Exception as e:
        print(f"[video_worker] fatal: {e}", file=sys.stderr)
        code = 1
    sys.exit(code)
