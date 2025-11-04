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
        logger.info(f"process_liveness_detection: Input {len(faces)} faces")
        for i, face in enumerate(faces):
            bbox = face.get("bbox", {})
            conf = face.get("confidence", 0)
            logger.info(f"Input face {i}: bbox={bbox}, confidence={conf}")

        # Use simple liveness detector
        faces_with_liveness = liveness_detector.detect_faces(image, faces)

        logger.info(
            f"process_liveness_detection: {len(faces_with_liveness)} faces processed"
        )
        for i, face in enumerate(faces_with_liveness):
            if "liveness" in face:
                liveness = face["liveness"]
                live_score = liveness.get("live_score")
                spoof_score = liveness.get("spoof_score")
                live_score_str = (
                    f"{live_score:.3f}" if live_score is not None else "N/A"
                )
                spoof_score_str = (
                    f"{spoof_score:.3f}" if spoof_score is not None else "N/A"
                )
                logger.info(
                    f"Face {i} result: is_real={liveness['is_real']}, live_score={live_score_str}, spoof_score={spoof_score_str}, predicted_class={liveness.get('predicted_class', 'N/A')}, status={liveness.get('status', 'N/A')}"
                )

        return faces_with_liveness

    except Exception as e:
        logger.warning(f"Liveness detection failed: {e}")
        # Mark ALL faces as FAKE on error for security
        for face in faces:
            face["liveness"] = {
                "is_real": False,
                "live_score": 0.0,
                "spoof_score": 1.0,
                "confidence": 0.0,
                "status": "error",
                "label": "Error",
                "message": f"Liveness detection error: {str(e)}",
            }

    return faces


async def process_face_tracking(faces: List[Dict], image: np.ndarray) -> List[Dict]:
    """
    Process face tracking with Deep SORT
    - Extracts embeddings for all frames for consistent tracking
    - Frontend controls frame rate, so no need for backend frame skipping
    """
    if not (faces and face_tracker and face_recognizer):
        return faces

    try:
        # Extract embeddings for all faces (batch processing for efficiency)
        loop = asyncio.get_event_loop()
        embeddings = await loop.run_in_executor(
            None, face_recognizer.extract_embeddings_for_tracking, image, faces
        )

        # Update Deep SORT tracker with faces and embeddings
        tracked_faces = await loop.run_in_executor(
            None, face_tracker.update, faces, embeddings
        )

        return tracked_faces

    except Exception as e:
        logger.warning(f"Deep SORT tracking failed: {e}")
        # Return original faces without tracking on error
        return faces

