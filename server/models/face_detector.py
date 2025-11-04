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
            x1_unclipped = int(x * scale_x)
            y1_unclipped = int(y * scale_y)
            x2_unclipped = int((x + w) * scale_x)
            y2_unclipped = int((y + h) * scale_y)

            # Calculate original (unclipped) bounding box size
            original_width = x2_unclipped - x1_unclipped
            original_height = y2_unclipped - y1_unclipped
            original_area = original_width * original_height

            # Ensure bounding box coordinates are within image bounds
            x1_orig = max(0, x1_unclipped)
            y1_orig = max(0, y1_unclipped)
            x2_orig = min(orig_width, x2_unclipped)
            y2_orig = min(orig_height, y2_unclipped)

            # Calculate clipped bounding box width and height
            face_width_orig = x2_orig - x1_orig
            face_height_orig = y2_orig - y1_orig
            clipped_area = face_width_orig * face_height_orig

            # Calculate visibility ratio (how much of the face is actually visible)
            visibility_ratio = (
                clipped_area / original_area if original_area > 0 else 1.0
            )

            # Check if face is too close to image edges (within 5% of image dimension)
            edge_threshold_x = orig_width * 0.05
            edge_threshold_y = orig_height * 0.05
            is_near_edge = (
                x1_orig < edge_threshold_x
                or y1_orig < edge_threshold_y
                or x2_orig > (orig_width - edge_threshold_x)
                or y2_orig > (orig_height - edge_threshold_y)
            )

            # Scale 5-point landmarks to original image size
            landmarks_5[:, 0] *= scale_x
            landmarks_5[:, 1] *= scale_y

            # CRITICAL: Clamp landmarks to image bounds to ensure accuracy at edges
            # This prevents invalid coordinates that could cause rendering issues
            for landmark in landmarks_5:
                landmark[0] = max(0, min(orig_width - 1, landmark[0]))
                landmark[1] = max(0, min(orig_height - 1, landmark[1]))

            # Check if landmarks are too close to edges
            landmarks_near_edge = False
            for landmark in landmarks_5:
                lx, ly = landmark[0], landmark[1]
                if (
                    lx < edge_threshold_x
                    or ly < edge_threshold_y
                    or lx > (orig_width - edge_threshold_x)
                    or ly > (orig_height - edge_threshold_y)
                ):
                    landmarks_near_edge = True
                    break

            # Check if bounding box is too small for anti-spoof
            is_bounding_box_too_small = self.min_face_size > 0 and (
                face_width_orig < self.min_face_size
                or face_height_orig < self.min_face_size
            )

            # Check if face has low visibility or is at edges
            # Only mark as uncertain if liveness detection is enabled (min_face_size > 0)
            # If spoof detection is OFF, allow recognition even for edge cases
            is_critically_low_visibility = visibility_ratio < 0.50
            is_edge_case_for_uncertain = (
                is_near_edge and visibility_ratio < 0.85
            ) or landmarks_near_edge

            # Only apply edge case uncertain marking if liveness detection is enabled
            # If min_face_size is 0, spoof detection is OFF - allow all faces including edge cases
            liveness_detection_enabled = self.min_face_size > 0

            # Create detection dict
            # Keep landmarks as float32 to preserve sub-pixel precision for better alignment accuracy
            detection = {
                "bbox": {
                    "x": x1_orig,
                    "y": y1_orig,
                    "width": face_width_orig,
                    "height": face_height_orig,
                },
                "confidence": conf,
                "landmarks_5": landmarks_5.tolist(),
            }

            # Add liveness status for small faces, edge cases, or low visibility faces
            # Only mark as uncertain if liveness detection is enabled (spoof detection ON)
            # When spoof detection is OFF, don't mark edge cases as uncertain - allow recognition
            if is_bounding_box_too_small:
                detection["liveness"] = {
                    "is_real": False,
                    "status": "too_small",
                    "decision_reason": f"Face too small ({face_width_orig}x{face_height_orig}px) for reliable liveness detection (minimum: {self.min_face_size}px)",
                }
            elif liveness_detection_enabled and (
                is_edge_case_for_uncertain or is_critically_low_visibility
            ):
                # Mark as uncertain for edge cases or low visibility ONLY if liveness detection is enabled
                # This prevents misclassification when spoof detection is ON
                # When spoof detection is OFF, edge cases are allowed for recognition
                if is_edge_case_for_uncertain:
                    detection["liveness"] = {
                        "is_real": False,
                        "status": "uncertain",
                        "decision_reason": f"Face at edge with partial visibility (visibility: {visibility_ratio:.1%}) - insufficient quality for reliable liveness detection",
                    }
                else:
                    detection["liveness"] = {
                        "is_real": False,
                        "status": "uncertain",
                        "decision_reason": f"Face critically low visibility (visibility: {visibility_ratio:.1%}) - insufficient quality for reliable liveness detection",
                    }
            # If liveness detection is disabled (spoof OFF), don't add liveness status for edge cases
            # This allows edge cases to be recognized normally when spoof detection is OFF

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
