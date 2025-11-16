import os
import cv2 as cv
import logging as log

logger = log.getLogger(__name__)


def init_face_detector_session(
    model_path: str,
    input_size: tuple,
    conf_threshold: float,
    nms_threshold: float,
    top_k: int,
):
    """Initialize OpenCV FaceDetectorYN session safely."""
    if not model_path:
        raise ValueError("Model path is required for FaceDetector")

    if not os.path.isfile(model_path):
        raise FileNotFoundError(f"Face detector model file not found: {model_path}")

    try:
        detector = cv.FaceDetectorYN.create(
            model_path,
            "",
            input_size,
            conf_threshold,
            nms_threshold,
            top_k,
        )

        if detector is None:
            raise RuntimeError("Failed to create FaceDetectorYN instance")
        return detector
    except Exception as e:
        logger.error(f"Error loading face detector model: {e}")
        raise
