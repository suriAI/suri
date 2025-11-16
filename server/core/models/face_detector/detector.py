import numpy as np
import logging as log
from typing import List
from .session_utils import init_face_detector_session
from .postprocess import process_detection

logger = log.getLogger(__name__)


class FaceDetector:
    def __init__(
        self,
        model_path: str,
        input_size: tuple,
        conf_threshold: float,
        nms_threshold: float,
        top_k: int,
        min_face_size: int,
    ):
        self.detector = None

        # Set attributes via setters
        self.set_score_threshold(conf_threshold)
        self.set_nms_threshold(nms_threshold)
        self.set_top_k(top_k)
        self.set_min_face_size(min_face_size)

        self.detector = init_face_detector_session(
            model_path,
            input_size,
            conf_threshold,
            nms_threshold,
            top_k,
        )

    def detect_faces(self, image: np.ndarray) -> List[dict]:
        if not self.detector or image is None or image.size == 0:
            logger.warning("Invalid image provided to face detector")
            return []

        orig_height, orig_width = image.shape[:2]

        self.detector.setInputSize((orig_width, orig_height))
        faces = self.detector.detect(image)[1]

        if faces is None or len(faces) == 0:
            return []

        detections = []
        for face in faces:
            landmarks_5 = face[4:14].reshape(5, 2)

            # Process detection (no clipping - handled in frontend for UI)
            detection = process_detection(
                face,
                self.min_face_size,
                landmarks_5,
            )

            detections.append(detection)

        return detections

    def set_score_threshold(self, threshold):
        """Update confidence threshold"""
        self.conf_threshold = threshold
        if self.detector:
            self.detector.setScoreThreshold(threshold)

    def set_nms_threshold(self, threshold):
        """Update NMS threshold"""
        self.nms_threshold = threshold
        if self.detector:
            self.detector.setNMSThreshold(threshold)

    def set_top_k(self, top_k):
        """Update maximum number of detections"""
        self.top_k = top_k
        if self.detector:
            self.detector.setTopK(top_k)

    def set_confidence_threshold(self, threshold):
        """Update confidence threshold (alias for set_score_threshold)"""
        self.set_score_threshold(threshold)

    def set_min_face_size(self, min_size: int):
        """Set minimum face size for liveness detection compatibility"""
        self.min_face_size = min_size
