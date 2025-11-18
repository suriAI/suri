import json
import logging
import time
from datetime import datetime

import cv2
import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException

from config.settings import FACE_DETECTOR_CONFIG
from utils import serialize_faces
from hooks import process_face_tracking, process_liveness_detection
from utils.websocket_manager import manager

if not logging.getLogger().handlers:
    logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()


async def handle_websocket_detect(websocket: WebSocket, client_id: str):
    """Handle WebSocket detection endpoint"""
    logger.info(f"[WebSocket] Client {client_id} attempting to connect...")
    await websocket.accept()
    logger.info(f"[WebSocket] Client {client_id} connected successfully")

    if client_id not in manager.active_connections:
        manager.active_connections[client_id] = websocket
    if client_id not in manager.connection_metadata:
        manager.connection_metadata[client_id] = {
            "connected_at": datetime.now(),
            "last_activity": datetime.now(),
            "message_count": 0,
            "streaming": False,
        }

    # Store enable_liveness_detection per client (default to True)
    enable_liveness_detection = True

    # Initialize min_face_size based on default enable_liveness_detection state
    # This ensures correct face size limiting from the first frame
    # Using config as single source of truth
    from core.lifespan import face_detector, face_tracker

    if face_detector:
        default_min_size = FACE_DETECTOR_CONFIG["min_face_size"]
        face_detector.set_min_face_size(default_min_size)
    
   # Reset face tracker on new WebSocket connection
    if face_tracker:
        logger.info(f"[WebSocket] Resetting face tracker for client {client_id} (fresh tracking state)")
        face_tracker.reset()

    try:
        await websocket.send_text(
            json.dumps(
                {
                    "type": "connection",
                    "status": "connected",
                    "client_id": client_id,
                    "timestamp": time.time(),
                }
            )
        )
        logger.info(f"[WebSocket] Sent connection confirmation to client {client_id}")

        logger.info(f"[WebSocket] Starting message loop for client {client_id}")

        while True:
            try:
                message_data = await websocket.receive()

                if "text" in message_data:
                    message = json.loads(message_data["text"])

                    if message.get("type") == "ping":
                        if client_id in manager.connection_metadata:
                            manager.connection_metadata[client_id][
                                "last_activity"
                            ] = datetime.now()
                        await websocket.send_text(
                            json.dumps(
                                {
                                    "type": "pong",
                                    "client_id": client_id,
                                    "timestamp": time.time(),
                                }
                            )
                        )
                        continue

                    if message.get("type") == "disconnect":
                        logger.info(
                            f"[WebSocket] Client {client_id} requested disconnect"
                        )
                        break

                    elif message.get("type") == "config":
                        # Update enable_liveness_detection from config
                        if "enable_liveness_detection" in message:
                            enable_liveness_detection = message.get(
                                "enable_liveness_detection", True
                            )
                            # When liveness detection is disabled, remove minimum face size limit
                            # When enabled, restore default minimum face size from config (single source of truth)
                            from core.lifespan import face_detector

                            if face_detector:
                                if not enable_liveness_detection:
                                    face_detector.set_min_face_size(
                                        0
                                    )  # No limit when spoof detection is off
                                else:
                                    default_min_size = FACE_DETECTOR_CONFIG[
                                        "min_face_size"
                                    ]
                                    face_detector.set_min_face_size(default_min_size)

                        await websocket.send_text(
                            json.dumps(
                                {
                                    "type": "config_ack",
                                    "success": True,
                                    "timestamp": time.time(),
                                }
                            )
                        )
                        continue

                elif "bytes" in message_data:
                    if client_id in manager.connection_metadata:
                        manager.connection_metadata[client_id][
                            "last_activity"
                        ] = datetime.now()
                    start_time = time.time()
                    frame_bytes = message_data["bytes"]

                    nparr = np.frombuffer(frame_bytes, np.uint8)
                    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                    if image is None:
                        await websocket.send_text(
                            json.dumps(
                                {
                                    "type": "error",
                                    "message": "Failed to decode frame",
                                    "timestamp": time.time(),
                                }
                            )
                        )
                        continue

                    from core.lifespan import face_detector

                    if not face_detector:
                        raise HTTPException(
                            status_code=500, detail="Face detector model not available"
                        )

                    # When liveness detection is disabled, remove minimum face size limit
                    # When enabled, restore default minimum face size from config (single source of truth)
                    if not enable_liveness_detection:
                        face_detector.set_min_face_size(
                            0
                        )  # No limit when spoof detection is off
                    else:
                        default_min_size = FACE_DETECTOR_CONFIG["min_face_size"]
                        face_detector.set_min_face_size(default_min_size)

                    faces = face_detector.detect_faces(image)
                    faces = await process_face_tracking(faces, image)
                    faces = await process_liveness_detection(
                        faces, image, enable_liveness_detection
                    )

                    serialized_faces = serialize_faces(faces, "websocket")

                    processing_time = time.time() - start_time

                    current_timestamp = time.time()
                    response_data = {
                        "type": "detection_response",
                        "faces": serialized_faces,
                        "model_used": "face_detector",
                        "processing_time": processing_time,
                        "timestamp": current_timestamp,
                        "frame_timestamp": current_timestamp,
                        "success": True,
                    }

                    # Calculate suggested_skip based on processing time
                    if processing_time * 1000 > 50:
                        suggested_skip = 2
                    elif processing_time * 1000 > 30:
                        suggested_skip = 1
                    else:
                        suggested_skip = 0

                    response_data["suggested_skip"] = suggested_skip

                    await websocket.send_text(json.dumps(response_data))

            except WebSocketDisconnect:
                # Connection closed by client, exit gracefully
                logger.info(
                    f"[WebSocket] Client {client_id} disconnected (inner loop - WebSocketDisconnect exception)"
                )
                break
            except Exception as e:
                # Check if it's a connection-related error
                error_str = str(e).lower()
                if "disconnect" in error_str or "close" in error_str:
                    logger.info(
                        f"[WebSocket] Client {client_id} disconnected due to connection error: {e}"
                    )
                    break
                # Only log if it's not a connection-related error
                logger.error(
                    f"[WebSocket] Detection processing error for client {client_id}: {e}"
                )
                try:
                    await websocket.send_text(
                        json.dumps(
                            {
                                "type": "error",
                                "message": f"Detection failed: {str(e)}",
                                "timestamp": time.time(),
                            }
                        )
                    )
                except (WebSocketDisconnect, RuntimeError) as send_error:
                    # Connection already closed, ignore
                    logger.info(
                        f"[WebSocket] Client {client_id} disconnected during error handling: {send_error}"
                    )
                    break

    except WebSocketDisconnect:
        logger.info(
            f"[WebSocket] Client {client_id} disconnected (outer exception - WebSocketDisconnect)"
        )
    except Exception as e:
        error_str = str(e).lower()
        if (
            "disconnect" not in error_str
            and "close" not in error_str
            and "send" not in error_str
        ):
            logger.error(f"[WebSocket] Detection error for client {client_id}: {e}")
        else:
            logger.info(
                f"[WebSocket] Client {client_id} disconnected due to exception: {e}"
            )
    finally:
        if client_id in manager.active_connections:
            await manager.disconnect(client_id)
        logger.info(f"[WebSocket] Detection endpoint closed for client {client_id}")


async def handle_websocket_notifications(websocket: WebSocket, client_id: str):
    """Handle WebSocket notifications endpoint"""
    await manager.connect(websocket, client_id)
    # Notification client connected

    try:
        import asyncio

        await websocket.send_text(
            json.dumps(
                {
                    "type": "connection",
                    "status": "connected",
                    "client_id": client_id,
                    "timestamp": asyncio.get_event_loop().time(),
                }
            )
        )

        while True:
            message_data = await websocket.receive()

            if "text" in message_data:
                message = json.loads(message_data["text"])

                if message.get("type") == "ping":
                    await websocket.send_text(
                        json.dumps(
                            {
                                "type": "pong",
                                "client_id": client_id,
                                "timestamp": asyncio.get_event_loop().time(),
                            }
                        )
                    )

    except WebSocketDisconnect:
        # Notification client disconnected
        await manager.disconnect(client_id)
    except Exception as e:
        logger.error(f"WebSocket notification error: {e}")
        await manager.disconnect(client_id)


@router.websocket("/ws/detect/{client_id}")
async def websocket_detect_endpoint(websocket: WebSocket, client_id: str):
    """WebSocket endpoint for real-time face detection"""
    await handle_websocket_detect(websocket, client_id)


@router.websocket("/ws/notifications/{client_id}")
async def websocket_notifications_endpoint(websocket: WebSocket, client_id: str):
    """WebSocket endpoint for notifications"""
    await handle_websocket_notifications(websocket, client_id)
