import cv2
import numpy as np
import onnxruntime as ort
import os
import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)


class AntiSpoof:
    def __init__(
        self,
        model_path: str,
        model_img_size: int,
        confidence_threshold: float,
        config: Dict = None,
    ):
        self.model_path = model_path
        self.model_img_size = model_img_size
        self.config = config or {}
        self.confidence_threshold = confidence_threshold

        self.ort_session, self.input_name = self._init_session_(model_path)

    def _init_session_(self, onnx_model_path: str):
        """Initialize ONNX Runtime session"""
        ort_session = None
        input_name = None

        if os.path.isfile(onnx_model_path):
            try:
                ort_session = ort.InferenceSession(
                    onnx_model_path,
                    providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
                )
                logger.info(
                    f"Liveness detection model loaded with providers: {ort_session.get_providers()}"
                )
            except Exception as e:
                logger.error(f"Error loading liveness detection model: {e}")
                try:
                    ort_session = ort.InferenceSession(
                        onnx_model_path, providers=["CPUExecutionProvider"]
                    )
                    logger.info("Liveness detection model loaded with CPU provider")
                except Exception as e2:
                    logger.error(
                        f"Failed to load liveness detection model with CPU: {e2}"
                    )
                    return None, None

            if ort_session:
                input_name = ort_session.get_inputs()[0].name
                logger.info(f"Liveness detection model input name: {input_name}")

        return ort_session, input_name

    def preprocessing(self, img: np.ndarray) -> np.ndarray:
        new_size = self.model_img_size
        img = cv2.resize(img, (new_size, new_size), interpolation=cv2.INTER_LINEAR)
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        img_normalized = img_rgb.astype(np.float32, copy=False)
        np.multiply(img_normalized, 1.0 / 255.0, out=img_normalized)
        img_chw = img_normalized.transpose(2, 0, 1)
        img_batch = np.expand_dims(img_chw, axis=0)
        return img_batch

    def postprocessing(self, prediction: np.ndarray) -> np.ndarray:
        """Apply softmax to prediction"""
        def softmax(x):
            return np.exp(x) / np.sum(np.exp(x))
        pred = softmax(prediction)
        return pred

    def increased_crop(
        self, img: np.ndarray, bbox: tuple, bbox_inc: float = 1.5
    ) -> np.ndarray:
        """Crop face with expanded bounding box"""
        real_h, real_w = img.shape[:2]
        x1_input, y1_input, x2_input, y2_input = bbox
        w = x2_input - x1_input
        h = y2_input - y1_input
        max_dim = max(w, h)

        xc, yc = x1_input + w / 2, y1_input + h / 2
        x_expanded = int(xc - max_dim * bbox_inc / 2)
        y_expanded = int(yc - max_dim * bbox_inc / 2)

        x1_clamped = max(0, x_expanded)
        y1_clamped = max(0, y_expanded)
        x2_clamped = min(real_w, x_expanded + int(max_dim * bbox_inc))
        y2_clamped = min(real_h, y_expanded + int(max_dim * bbox_inc))

        crop = img[y1_clamped:y2_clamped, x1_clamped:x2_clamped, :]

        if (
            x_expanded < 0
            or y_expanded < 0
            or x_expanded + int(max_dim * bbox_inc) > real_w
            or y_expanded + int(max_dim * bbox_inc) > real_h
        ):
            top = max(0, y1_clamped - y_expanded)
            bottom = max(0, y_expanded + int(max_dim * bbox_inc) - y2_clamped)
            left = max(0, x1_clamped - x_expanded)
            right = max(0, x_expanded + int(max_dim * bbox_inc) - x2_clamped)

            crop = cv2.copyMakeBorder(
                crop, top, bottom, left, right, cv2.BORDER_REFLECT_101
            )

        return crop

    def predict(self, imgs: List[np.ndarray]) -> List[Dict]:
        """Predict anti-spoofing for list of face images"""
        if not self.ort_session:
            return []

        results = []
        for img in imgs:
            try:
                onnx_result = self.ort_session.run(
                    [], {self.input_name: self.preprocessing(img)}
                )
                pred = onnx_result[0]
                pred = self.postprocessing(pred)

                if pred.shape[1] != 3:
                    logger.error(
                        f"Model output has {pred.shape[1]} classes, expected 3 (live, print, replay)"
                    )
                    results.append(self._create_error_result("Invalid model output"))
                    continue

                live_score = float(pred[0][0])
                print_score = float(pred[0][1])
                replay_score = float(pred[0][2])
                predicted_class = np.argmax(pred[0])

                score_sum = live_score + print_score + replay_score
                if abs(score_sum - 1.0) > 1e-6:
                    logger.warning(
                        f"Liveness detection scores not properly normalized: sum={score_sum:.6f}"
                    )

                spoof_score = print_score + replay_score
                max_confidence = max(live_score, spoof_score)
                is_real = (live_score > spoof_score) and (
                    max_confidence >= self.confidence_threshold
                )

                if live_score > spoof_score:
                    if max_confidence >= self.confidence_threshold:
                        decision_reason = f"Live face detected with high confidence ({max_confidence:.3f} ≥ {self.confidence_threshold})"
                    else:
                        decision_reason = f"Uncertain: Low confidence ({max_confidence:.3f} < {self.confidence_threshold}), rejecting for safety"
                        is_real = False
                else:
                    decision_reason = f"Spoof detected: spoof_score ({spoof_score:.3f}) > live_score ({live_score:.3f})"

                if is_real:
                    attack_type = "live"
                    label = "Live"
                    detailed_label = f"Live Face (confidence: {live_score:.3f})"
                elif max_confidence < self.confidence_threshold:
                    attack_type = "uncertain"
                    label = "Uncertain"
                    detailed_label = f"Uncertain Classification (max confidence: {max_confidence:.3f} < {self.confidence_threshold})"
                else:
                    if print_score > replay_score:
                        attack_type = "print"
                        label = "Print Attack"
                        detailed_label = f"Print Attack (confidence: {print_score:.3f})"
                    elif replay_score > print_score:
                        attack_type = "replay"
                        label = "Replay Attack"
                        detailed_label = f"Replay Attack (confidence: {replay_score:.3f})"
                    else:
                        attack_type = "unknown"
                        label = "Spoof"
                        detailed_label = f"Spoof Attack (print: {print_score:.3f}, replay: {replay_score:.3f})"

                result = {
                    "is_real": bool(is_real),
                    "live_score": float(live_score),
                    "spoof_score": float(spoof_score),
                    "confidence": float(max_confidence),
                    "decision_reason": decision_reason,
                    "label": label,
                    "detailed_label": detailed_label,
                    "predicted_class": int(predicted_class),
                    "print_score": float(print_score),
                    "replay_score": float(replay_score),
                    "attack_type": attack_type,
                }
                results.append(result)

            except Exception as e:
                logger.error(f"Error in anti-spoofing prediction: {e}")
                results.append(self._create_error_result(f"Prediction error: {str(e)}"))

        return results

    def _create_error_result(self, error_msg: str) -> Dict:
        """Create a standardized error result"""
        return {
            "is_real": False,
            "live_score": 0.0,
            "spoof_score": 1.0,
            "confidence": 0.0,
            "decision_reason": f"Error: {error_msg}",
            "label": "Error",
            "detailed_label": f"Error: {error_msg}",
            "predicted_class": 1,
            "print_score": 0.5,
            "replay_score": 0.5,
            "attack_type": "error",
        }

    def detect_faces(
        self, image: np.ndarray, face_detections: List[Dict]
    ) -> List[Dict]:
        """Process face detections with anti-spoofing"""
        if not face_detections:
            return []

        face_crops = []
        valid_detections = []

        for detection in face_detections:
            bbox = detection.get("bbox", {})
            if not bbox:
                continue

            x = int(bbox.get("x", 0))
            y = int(bbox.get("y", 0))
            w = int(bbox.get("width", 0))
            h = int(bbox.get("height", 0))

            if w <= 0 or h <= 0:
                continue

            try:
                face_crop = self.increased_crop(
                    image, (x, y, x + w, y + h), bbox_inc=1.5
                )
                if face_crop is None or face_crop.size == 0:
                    continue
            except Exception as e:
                logger.warning(
                    f"increased_crop failed, skipping liveness for this face: {e}"
                )
                continue

            face_crops.append(face_crop)
            valid_detections.append(detection)

        if not face_crops:
            return face_detections

        predictions = self.predict(face_crops)

        results = []
        for i, detection in enumerate(face_detections):
            if "liveness" in detection and detection["liveness"].get("status") in [
                "too_small",
                "uncertain",
            ]:
                results.append(detection)
                continue

            if detection in valid_detections:
                valid_idx = valid_detections.index(detection)
                prediction = predictions[valid_idx]

                detection["liveness"] = {
                    "is_real": prediction["is_real"],
                    "live_score": prediction["live_score"],
                    "spoof_score": prediction["spoof_score"],
                    "confidence": prediction["confidence"],
                    "decision_reason": prediction["decision_reason"],
                    "label": prediction["label"],
                    "detailed_label": prediction["detailed_label"],
                    "status": (
                        "real"
                        if prediction["is_real"]
                        else (
                            "uncertain"
                            if prediction["attack_type"] == "uncertain"
                            else "fake"
                        )
                    ),
                    "predicted_class": prediction["predicted_class"],
                    "print_score": prediction["print_score"],
                    "replay_score": prediction["replay_score"],
                    "attack_type": prediction["attack_type"],
                }
            else:
                detection["liveness"] = {
                    "is_real": False,
                    "live_score": 0.0,
                    "spoof_score": 1.0,
                    "confidence": 0.0,
                    "decision_reason": "Error: Processing failed",
                    "label": "Error",
                    "detailed_label": "Error: Processing failed",
                    "status": "error",
                    "predicted_class": 1,
                    "print_score": 0.5,
                    "replay_score": 0.5,
                    "attack_type": "error",
                }

            results.append(detection)

        return results

    async def detect_faces_async(self, image, faces):
        return self.detect_faces(image, faces)

    def validate_model(self) -> Dict[str, Any]:
        """Validate that the model is properly configured for 3-class detection"""
        validation_result = {
            "is_valid": False,
            "model_path": str(self.model_path),
            "model_exists": False,
            "session_loaded": False,
            "output_classes": 0,
            "expected_classes": 3,
            "class_names": ["live", "print", "replay"],
            "strategy": "CONFIDENCE",
            "errors": [],
        }

        if os.path.isfile(self.model_path):
            validation_result["model_exists"] = True
        else:
            validation_result["errors"].append(
                f"Model file not found: {self.model_path}"
            )
            return validation_result

        if self.ort_session is not None:
            validation_result["session_loaded"] = True
        else:
            validation_result["errors"].append("ONNX session not loaded")
            return validation_result

        try:
            dummy_img = np.zeros(
                (self.model_img_size, self.model_img_size, 3), dtype=np.uint8
            )
            dummy_input = self.preprocessing(dummy_img)
            onnx_result = self.ort_session.run([], {self.input_name: dummy_input})
            pred = onnx_result[0]

            if len(pred.shape) == 2 and pred.shape[1] == 3:
                validation_result["output_classes"] = pred.shape[1]
                validation_result["is_valid"] = True
            else:
                validation_result["errors"].append(
                    f"Invalid output shape: {pred.shape}, expected (1, 3)"
                )

        except Exception as e:
            validation_result["errors"].append(f"Model inference test failed: {str(e)}")

        return validation_result

    def get_model_info(self):
        """Get model information"""
        validation = self.validate_model()
        return {
            "model_path": self.model_path,
            "model_img_size": self.model_img_size,
            "validation": validation,
            "supported_attacks": ["print", "replay"],
            "detection_classes": 3,
            "class_names": ["live", "print", "replay"],
            "strategy": "CONFIDENCE",
            "strategy_description": "(live_score > spoof_score) AND (confidence >= threshold)",
            "configuration": {"confidence_threshold": self.confidence_threshold},
        }

