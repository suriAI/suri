import os
import cv2 as cv
import numpy as np
import logging as log
from typing import List

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

        # Initialize class attributes

        self.model_path = model_path
        self.input_size = input_size
        self.conf_threshold = conf_threshold
        self.nms_threshold = nms_threshold
        self.top_k = top_k
        self.min_face_size = min_face_size
        self.detector = None

        if model_path and os.path.isfile(model_path):
            try:
                self.detector = cv.FaceDetectorYN.create(
                    self.model_path,
                    "",  # Config file path (empty for ONNX - params passed directly)
                    self.input_size,
                    self.conf_threshold,
                    self.nms_threshold,
                    self.top_k,
                )
            except Exception as e:
                logger.error(f"Error loading face detector model: {e}")

    def detect_faces(self, image: np.ndarray) -> List[dict]:
        if not self.detector or image is None or image.size == 0:
            logger.warning("Invalid image provided to face detector")
            return []

        # Get original image dimensions
        orig_height, orig_width = image.shape[:2]

        # Skip resize if image exactly matches input_size
        if orig_width == self.input_size[0] and orig_height == self.input_size[1]:
            detection_img = image
            scale_x = 1.0
            scale_y = 1.0
        else:
            # Use INTER_AREA for downscaling
            interpolation = (
                cv.INTER_AREA
                if (orig_width > self.input_size[0] or orig_height > self.input_size[1])
                else cv.INTER_LINEAR
            )
            detection_img = cv.resize(
                image, self.input_size, interpolation=interpolation
            )
            scale_x = orig_width / self.input_size[0]
            scale_y = orig_height / self.input_size[1]

        faces = self.detector.detect(detection_img)[1]

        # Exit if no faces detected
        if faces is None or len(faces) == 0:
            return []

        # Vectorized confidence filtering
        valid_mask = faces[:, 14] >= self.conf_threshold
        valid_faces = faces[valid_mask]

        # Exit if no valid faces after filtering
        if len(valid_faces) == 0:
            return []

        # Create detection dict
        detections = []
        for face in valid_faces:
            x, y, w, h = face[:4]
            landmarks_5 = face[4:14].reshape(5, 2)
            conf = float(face[14])

            # Scale bounding box coordinates to original image size
            x1_orig = int(x * scale_x)
            y1_orig = int(y * scale_y)
            x2_orig = int((x + w) * scale_x)
            y2_orig = int((y + h) * scale_y)

            # Ensure bounding box coordinates are within image bounds
            x1_orig = max(0, x1_orig)
            y1_orig = max(0, y1_orig)
            x2_orig = min(orig_width, x2_orig)
            y2_orig = min(orig_height, y2_orig)

            # Calculate bounding box width and height in original image size
            face_width_orig = x2_orig - x1_orig
            face_height_orig = y2_orig - y1_orig

            # Scale 5-point landmarks to original image size
            landmarks_5[:, 0] *= scale_x
            landmarks_5[:, 1] *= scale_y

            # Check if bounding box is too small for anti-spoof
            is_bounding_box_too_small = self.min_face_size > 0 and (
                face_width_orig < self.min_face_size
                or face_height_orig < self.min_face_size
            )

            # Create detection dict
            detection = {
                "bbox": {
                    "x": x1_orig,
                    "y": y1_orig,
                    "width": face_width_orig,
                    "height": face_height_orig,
                },
                "confidence": conf,
                "landmarks_5": landmarks_5.astype(int).tolist(),
            }

            # Add liveness status for small faces
            if is_bounding_box_too_small:
                detection["liveness"] = {
                    "is_real": False,
                    "status": "insufficient_quality",
                    "decision_reason": f"Face too small ({face_width_orig}x{face_height_orig}px) for reliable liveness detection (minimum: {self.min_face_size}px)",
                }

            # Add face detection dict to list
            detections.append(detection)

        return detections

    # Setters and Getters
    def set_input_size(self, input_size):
        """Update input size"""
        self.input_size = input_size
        if self.detector:
            self.detector.setInputSize(input_size)

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

    def get_model_info(self):
        """Get model information"""
        return {
            "model_path": self.model_path,
            "input_size": self.input_size,
            "conf_threshold": self.conf_threshold,
            "nms_threshold": self.nms_threshold,
            "top_k": self.top_k,
            "min_face_size": self.min_face_size,
            "liveness_detection_compatible": True,
            "size_filter_description": f"Faces smaller than {self.min_face_size}px are filtered for liveness detection model compatibility",
        }
