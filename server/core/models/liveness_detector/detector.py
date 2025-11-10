import cv2
import numpy as np
from typing import List, Dict
from .session_utils import init_onnx_session
from .preprocess import preprocess_image, crop_with_margin
from .postprocess import softmax, deduplicate_detections, process_prediction


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
        """Apply softmax to prediction (supports both single and batch predictions)"""
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

        face_crops = []
        valid_detections = []
        results = []

        for detection in deduplicated_detections:
            if (
                "liveness" in detection
                and detection["liveness"].get("status") == "too_small"
            ):
                results.append(detection)
                continue

            bbox = detection.get("bbox", {})
            if not bbox:
                results.append(detection)
                continue

            x = int(bbox.get("x", 0))
            y = int(bbox.get("y", 0))
            w = int(bbox.get("width", 0))
            h = int(bbox.get("height", 0))

            if w <= 0 or h <= 0:
                results.append(detection)
                continue

            if self.min_face_size > 0:
                if w < self.min_face_size or h < self.min_face_size:
                    detection["liveness"] = {
                        "is_real": False,
                        "status": "too_small",
                        "live_score": 0.0,
                        "spoof_score": 1.0,
                        "confidence": 0.0,
                    }
                    results.append(detection)
                    continue

            try:
                face_crop = self.increased_crop(
                    rgb_image, (x, y, x + w, y + h), bbox_inc=self.bbox_inc
                )
                if (
                    face_crop is None
                    or face_crop.size == 0
                    or len(face_crop.shape) != 3
                    or face_crop.shape[0] < 10
                    or face_crop.shape[1] < 10
                    or face_crop.shape[2] != 3
                ):
                    results.append(detection)
                    continue
            except Exception:
                results.append(detection)
                continue

            face_crops.append(face_crop)
            valid_detections.append(detection)

        if not face_crops:
            return results if results else face_detections

        # Batch inference for performance (single ONNX call for all faces)
        raw_predictions = []
        if not self.ort_session:
            raw_predictions = [None] * len(face_crops)
        else:
            try:
                # Batch preprocess all face crops: [N, C, H, W]
                batch_inputs = np.concatenate(
                    [self.preprocessing(img) for img in face_crops], axis=0
                )

                # Run single batch inference (much faster than N individual calls, especially on GPU)
                onnx_results = self.ort_session.run([], {self.input_name: batch_inputs})
                batch_logits = onnx_results[0]  # Shape: [N, 3]

                # Validate batch output shape
                if batch_logits.shape[1] != 3:
                    raw_predictions = [None] * len(face_crops)
                else:
                    # Apply postprocessing (softmax) to entire batch at once
                    batch_predictions = self.postprocessing(
                        batch_logits
                    )  # Shape: [N, 3]

                    # Extract individual predictions
                    for i in range(len(face_crops)):
                        try:
                            raw_pred = batch_predictions[i]  # Shape: [3]
                            raw_predictions.append(raw_pred)
                        except Exception:
                            raw_predictions.append(None)
            except Exception:
                # Fallback to None for all predictions on batch failure
                raw_predictions = [None] * len(face_crops)

        processed_predictions = []

        for detection, raw_pred in zip(valid_detections, raw_predictions):
            if raw_pred is None:
                processed_predictions.append(None)
                continue

            track_id = detection.get("track_id", None)
            result = process_prediction(
                raw_pred, self.confidence_threshold, track_id=track_id
            )
            processed_predictions.append(result)

        for detection, prediction in zip(valid_detections, processed_predictions):
            if prediction is not None:
                detection["liveness"] = {
                    "is_real": prediction["is_real"],
                    "live_score": prediction["live_score"],
                    "spoof_score": prediction["spoof_score"],
                    "confidence": prediction["confidence"],
                    "status": prediction["status"],
                }
            results.append(detection)

        return results
