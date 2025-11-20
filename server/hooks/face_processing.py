"""
Face processing hooks for the API
Handles liveness detection and face tracking processing
"""

import asyncio
import logging
from typing import Dict, List

import numpy as np

logger = logging.getLogger(__name__)

# Global references to models (set from main.py)
liveness_detector = None
face_tracker = None
face_recognizer = None


def set_model_references(liveness, tracker, recognizer):
    """Set global model references from main.py"""
    global liveness_detector, face_tracker, face_recognizer
    liveness_detector = liveness
    face_tracker = tracker
    face_recognizer = recognizer


async def process_liveness_detection(
    faces: List[Dict], image: np.ndarray, enable: bool
) -> List[Dict]:
    """Helper to process liveness detection across all endpoints"""
    if not (enable and faces and liveness_detector):
        return faces

    try:
        # Process liveness detection
        loop = asyncio.get_event_loop()
        faces_with_liveness = await loop.run_in_executor(
            None, liveness_detector.detect_faces, image, faces
        )
        return faces_with_liveness

    except Exception as e:
        logger.warning(f"Liveness detection failed: {e}")
        # Mark ALL faces as SPOOF on error
        for face in faces:
            face["liveness"] = {
                "is_real": False,
                "live_score": 0.0,
                "spoof_score": 1.0,
                "confidence": 0.0,
                "status": "error",
                "message": f"Liveness detection error: {str(e)}",
            }

    return faces


async def process_face_tracking(
    faces: List[Dict], image: np.ndarray, frame_rate: int = None
) -> List[Dict]:
    """
    Process face tracking
    - Updates tracker with detected faces and optional frame rate
    - ByteTrack uses only bbox + IoU matching, no embeddings needed
    """
    if not (faces and face_tracker):
        return faces

    try:
        loop = asyncio.get_event_loop()
        tracked_faces = await loop.run_in_executor(
            None, face_tracker.update, faces, frame_rate
        )

        return tracked_faces

    except Exception as e:
        logger.warning(f"Face tracking failed: {e}")
        return faces


async def process_liveness_for_face_operation(
    image: np.ndarray,
    bbox: list,
    enable_liveness_detection: bool,
    operation_name: str,
) -> tuple[bool, str | None]:
    """
    Process liveness detection for face recognition/registration operations.
    Returns (should_block, error_message)
    """
    from core.lifespan import liveness_detector

    if not (liveness_detector and enable_liveness_detection):
        return False, None

    # Convert bbox from list format [x, y, width, height] to dict format
    # This matches the format used at commit 834a141 which was accurate for both live and spoof
    temp_face = {
        "bbox": {
            "x": bbox[0],
            "y": bbox[1],
            "width": bbox[2],
            "height": bbox[3],
        },
        "confidence": 1.0,
        "track_id": -1,
    }

    loop = asyncio.get_event_loop()
    liveness_results = await loop.run_in_executor(
        None, liveness_detector.detect_faces, image, [temp_face]
    )

    if liveness_results and len(liveness_results) > 0:
        liveness_data = liveness_results[0].get("liveness", {})
        is_real = liveness_data.get("is_real", False)
        status = liveness_data.get("status", "unknown")

        # Block for spoofed faces
        if not is_real or status == "spoof":
            return (
                True,
                f"{operation_name} blocked: spoofed face detected (status: {status})",
            )

        # Block other problematic statuses
        if status in ["too_small", "error"]:
            logger.warning(f"{operation_name} blocked for face with status: {status}")
            return True, f"{operation_name} blocked: face status {status}"

    return False, None
