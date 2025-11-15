import cv2
import numpy as np
from typing import List, Dict
from .session_utils import init_onnx_session
from .preprocess import (
    preprocess_image,
    crop_with_margin,
    extract_face_crops_from_detections,
)
from .postprocess import (
    softmax,
    deduplicate_detections,
    validate_detection,
    run_batch_inference,
    assemble_liveness_results,
)


class LivenessDetector:
    def __init__(
        self,
        model_path: str,
        model_img_size: int,
        confidence_threshold: float,
        min_face_size: int,
        bbox_inc: float,
    ):
        self.model_img_size = model_img_size
        self.confidence_threshold = confidence_threshold
        self.min_face_size = min_face_size
        self.bbox_inc = bbox_inc

        self.ort_session, self.input_name = self._init_session_(model_path)

    def _init_session_(self, onnx_model_path: str):
        """Initialize ONNX Runtime session"""
        return init_onnx_session(onnx_model_path)

    def preprocessing(self, img: np.ndarray) -> np.ndarray:
        """Preprocess image for model inference"""
        return preprocess_image(img, self.model_img_size)

    def postprocessing(self, prediction: np.ndarray) -> np.ndarray:
        """Apply softmax to prediction (expects batch size 1: [1, 3])"""
        return softmax(prediction)

    def increased_crop(
        self, img: np.ndarray, bbox: tuple, bbox_inc: float
    ) -> np.ndarray:
        """Crop face with expanded bounding box"""
        return crop_with_margin(img, bbox, bbox_inc)

    def detect_faces(
        self, image: np.ndarray, face_detections: List[Dict]
    ) -> List[Dict]:
        """Process face detections with anti-spoofing"""
        if not face_detections:
            return []

        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

        # Deduplicate detections
        deduplicated_detections = deduplicate_detections(face_detections)

        # Validate detections and filter by minimum face size
        results = []
        valid_detections_for_cropping = []

        for detection in deduplicated_detections:
            is_valid, liveness_status = validate_detection(
                detection, self.min_face_size
            )

            if not is_valid:
                if liveness_status:
                    detection["liveness"] = liveness_status
                results.append(detection)
                continue

            valid_detections_for_cropping.append(detection)

        # Extract face crops from valid detections
        face_crops, valid_detections, skipped_results = (
            extract_face_crops_from_detections(
                rgb_image,
                valid_detections_for_cropping,
                self.bbox_inc,
                self.increased_crop,
            )
        )

        # Mark skipped detections (failed cropping) as error to prevent bypass
        for skipped in skipped_results:
            if "liveness" not in skipped:
                skipped["liveness"] = {
                    "is_real": False,
                    "live_score": 0.0,
                    "spoof_score": 1.0,
                    "confidence": 0.0,
                    "status": "error",
                }
        results.extend(skipped_results)

        if not face_crops:
            # Return results (should never be empty, but fail-safe if it is)
            return results

        # Run batch inference
        raw_predictions = run_batch_inference(
            face_crops,
            self.ort_session,
            self.input_name,
            self.preprocessing,
            self.postprocessing,
        )

        # Assemble liveness results
        results = assemble_liveness_results(
            valid_detections, raw_predictions, self.confidence_threshold, results
        )

        return results
