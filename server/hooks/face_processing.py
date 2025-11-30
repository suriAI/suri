import logging
from typing import Dict, List, Optional

import numpy as np

logger = logging.getLogger(__name__)

liveness_detector = None
face_recognizer = None
face_detector = None


def set_model_references(liveness, tracker, recognizer, detector=None):
    global liveness_detector, face_recognizer, face_detector
    liveness_detector = liveness
    face_recognizer = recognizer
    face_detector = detector


def process_face_detection(
    image: np.ndarray,
    confidence_threshold: Optional[float] = None,
    nms_threshold: Optional[float] = None,
    min_face_size: Optional[int] = None,
) -> List[Dict]:
    if not face_detector:
        logger.warning("Face detector not available")
        return []

    try:
        if confidence_threshold is not None:
            face_detector.set_confidence_threshold(confidence_threshold)
        if nms_threshold is not None:
            face_detector.set_nms_threshold(nms_threshold)
        if min_face_size is not None:
            face_detector.set_min_face_size(min_face_size)

        faces = face_detector.detect_faces(image)
        return faces

    except Exception as e:
        logger.error(f"Face detection failed: {e}", exc_info=True)
        return []


def process_liveness_detection(
    faces: List[Dict], image: np.ndarray, enable: bool
) -> List[Dict]:
    if not (enable and faces and liveness_detector):
        return faces

    try:
        faces_with_liveness = liveness_detector.detect_faces(image, faces)
        return faces_with_liveness

    except Exception as e:
        logger.error(f"Liveness detection failed: {e}", exc_info=True)
        for face in faces:
            if "liveness" not in face:
                face["liveness"] = {
                    "is_real": False,
                    "live_score": 0.0,
                    "spoof_score": 1.0,
                    "confidence": 0.0,
                    "status": "error",
                    "message": f"Liveness detection error: {str(e)}",
                }
            elif face["liveness"].get("status") not in ["live", "spoof"]:
                face["liveness"]["status"] = "error"
                face["liveness"]["message"] = f"Liveness detection error: {str(e)}"

    return faces


def process_face_tracking(
    faces: List[Dict],
    image: np.ndarray,
    frame_rate: int = None,
    client_id: str = None,
) -> List[Dict]:
    if not faces:
        return faces

    if not client_id:
        logger.warning(
            "process_face_tracking called without client_id - skipping tracking"
        )
        for face in faces:
            if "track_id" not in face:
                face["track_id"] = -1
        return faces

    from utils.websocket_manager import manager

    tracker = manager.get_face_tracker(client_id)

    if not tracker:
        logger.warning(f"No tracker found for client {client_id}")
        for face in faces:
            if "track_id" not in face:
                face["track_id"] = -1
        return faces

    try:
        tracked_faces = tracker.update(faces, frame_rate)
        return tracked_faces

    except Exception as e:
        logger.warning(f"Face tracking failed: {e}")
        for face in faces:
            if "track_id" not in face:
                face["track_id"] = -1
        return faces


def process_liveness_for_face_operation(
    image: np.ndarray,
    bbox: list,
    enable_liveness_detection: bool,
    operation_name: str,
) -> tuple[bool, str | None]:
    from core.lifespan import liveness_detector

    if not (liveness_detector and enable_liveness_detection):
        return False, None

    if not isinstance(bbox, list) or len(bbox) < 4:
        return True, f"{operation_name} blocked: invalid bbox format"

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

    liveness_results = liveness_detector.detect_faces(image, [temp_face])

    if liveness_results and len(liveness_results) > 0:
        liveness_data = liveness_results[0].get("liveness", {})
        is_real = liveness_data.get("is_real", False)
        status = liveness_data.get("status", "unknown")

        if not is_real or status == "spoof":
            return (
                True,
                f"{operation_name} blocked: spoofed face detected (status: {status})",
            )

        if status in ["too_small", "error"]:
            logger.warning(f"{operation_name} blocked for face with status: {status}")
            return True, f"{operation_name} blocked: face status {status}"

    return False, None
