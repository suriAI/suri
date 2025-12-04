import cv2
import numpy as np
from typing import List, Dict, Optional
from .session_utils import init_onnx_session
from .preprocess import (
    crop_with_margin,
    extract_face_crops_from_detections,
)
from .postprocess import (
    softmax,
    validate_detection,
    run_batch_inference,
    assemble_liveness_results,
)
from .temporal_smoothing import TemporalSmoother


class LivenessDetector:
    def __init__(
        self,
        model_path: str,
        model_img_size: int,
        confidence_threshold: float,
        bbox_inc: float,
        temporal_alpha: Optional[float] = None,
        enable_temporal_smoothing: bool = True,
    ):
        self.model_img_size = model_img_size
        self.confidence_threshold = confidence_threshold
        self.bbox_inc = bbox_inc
        self.enable_temporal_smoothing = enable_temporal_smoothing

        self.ort_session, self.input_name = self._init_session_(model_path)

        if self.enable_temporal_smoothing:
            if temporal_alpha is None:
                raise ValueError(
                    "temporal_alpha must be provided from config when enable_temporal_smoothing is True"
                )
            self.temporal_smoother = TemporalSmoother(alpha=temporal_alpha)
        else:
            self.temporal_smoother = None

        self.frame_counter = 0

    def _init_session_(self, onnx_model_path: str):
        return init_onnx_session(onnx_model_path)

    def postprocessing(self, prediction: np.ndarray) -> np.ndarray:
        return softmax(prediction)

    def increased_crop(
        self, img: np.ndarray, bbox: tuple, bbox_inc: float
    ) -> np.ndarray:
        return crop_with_margin(img, bbox, bbox_inc)

    def detect_faces(
        self, image: np.ndarray, face_detections: List[Dict]
    ) -> List[Dict]:
        if not face_detections:
            return []

        self.frame_counter += 1

        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

        results = []
        valid_detections_for_cropping = []

        for detection in face_detections:
            is_valid, liveness_status = validate_detection(detection)

            if not is_valid:
                if liveness_status:
                    detection["liveness"] = liveness_status
                results.append(detection)
                continue

            valid_detections_for_cropping.append(detection)

        face_crops, valid_detections, skipped_results = (
            extract_face_crops_from_detections(
                rgb_image,
                valid_detections_for_cropping,
                self.bbox_inc,
                self.increased_crop,
            )
        )

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
            return results

        raw_predictions = run_batch_inference(
            face_crops,
            self.ort_session,
            self.input_name,
            self.postprocessing,
            self.model_img_size,
        )

        results = assemble_liveness_results(
            valid_detections,
            raw_predictions,
            self.confidence_threshold,
            results,
            self.temporal_smoother,
            self.frame_counter,
        )

        if self.temporal_smoother:
            self.temporal_smoother.cleanup_stale_tracks()

        return results
