import cv2
import numpy as np
import onnxruntime as ort
import os
import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

class LivenessValidator:
    def __init__(self, model_path: str, model_img_size: int, confidence_threshold: float, config: Dict = None):
        self.model_path = model_path
        self.model_img_size = model_img_size
        self.config = config or {}
        
        # CONFIDENCE STRATEGY: Only parameter that matters
        self.confidence_threshold = confidence_threshold
        
        self.ort_session, self.input_name = self._init_session_(model_path)

    def _init_session_(self, onnx_model_path: str):
        """Initialize ONNX Runtime session"""
        ort_session = None
        input_name = None
        
        if os.path.isfile(onnx_model_path):
            try:
                # Try CUDA first, fallback to CPU
                ort_session = ort.InferenceSession(onnx_model_path, 
                                                   providers=['CUDAExecutionProvider', 'CPUExecutionProvider'])
                logger.info(f"Liveness detection model loaded with providers: {ort_session.get_providers()}")
            except Exception as e:
                logger.error(f"Error loading liveness detection model: {e}")
                try:
                    ort_session = ort.InferenceSession(onnx_model_path, 
                                                       providers=['CPUExecutionProvider'])
                    logger.info("Liveness detection model loaded with CPU provider")
                except Exception as e2:
                    logger.error(f"Failed to load liveness detection model with CPU: {e2}")
                    return None, None
            
            if ort_session:
                input_name = ort_session.get_inputs()[0].name
                logger.info(f"Liveness detection model input name: {input_name}")
        
        return ort_session, input_name

    def preprocessing(self, img: np.ndarray) -> np.ndarray:
        """
        Preprocess image for anti-spoofing model
        
        Args:
            img: Input image (BGR format from OpenCV)
            
        Returns:
            Preprocessed image tensor (RGB format for ONNX model)
            
        Process:
            1. Resize to model input size (128x128) maintaining aspect ratio
            2. Add padding with black borders if needed
            3. Convert BGR → RGB (models expect RGB)
            4. Normalize to [0, 1] range
            5. Transpose to CHW format and add batch dimension
        """
        new_size = self.model_img_size
        old_size = img.shape[:2]

        ratio = float(new_size) / max(old_size)
        scaled_shape = tuple([int(x * ratio) for x in old_size])

        # Resize in BGR format (faster)
        img = cv2.resize(img, (scaled_shape[1], scaled_shape[0]))

        delta_w = new_size - scaled_shape[1]
        delta_h = new_size - scaled_shape[0]
        top, bottom = delta_h // 2, delta_h - (delta_h // 2)
        left, right = delta_w // 2, delta_w - (delta_w // 2)

        # Add padding in BGR format
        img = cv2.copyMakeBorder(img, top, bottom, left, right, 
                                 cv2.BORDER_CONSTANT, value=[0, 0, 0])
        
        # OPTIMIZATION: Convert BGR to RGB only once at the end for ONNX model
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        img_rgb = img_rgb.transpose(2, 0, 1).astype(np.float32) / 255.0
        img_rgb = np.expand_dims(img_rgb, axis=0)
        return img_rgb

    def postprocessing(self, prediction: np.ndarray) -> np.ndarray:
        """
        Apply softmax to prediction
        
        Args:
            prediction: Raw model prediction
            
        Returns:
            Softmax probabilities
        """
        softmax = lambda x: np.exp(x) / np.sum(np.exp(x))
        pred = softmax(prediction)
        return pred

    def increased_crop(self, img: np.ndarray, bbox: tuple, bbox_inc: float = 1.5) -> np.ndarray:
        """
        Crop face with increased bounding box for better liveness detection accuracy
        Matches liveness detection prototype implementation exactly
        
        Args:
            img: Input image (BGR format from OpenCV)
            bbox: Bounding box (x1, y1, x2, y2)
            bbox_inc: Bounding box expansion factor (1.5 = 50% expansion on all sides)
            
        Returns:
            Cropped and expanded face region in BGR format
            
        Example:
            Original bbox: 100x100 pixels
            With bbox_inc=1.5: Returns 150x150 pixel crop (50% larger)
        """
        real_h, real_w = img.shape[:2]
        
        x, y, w, h = bbox
        w, h = w - x, h - y
        l = max(w, h)
        
        xc, yc = x + w/2, y + h/2
        x, y = int(xc - l*bbox_inc/2), int(yc - l*bbox_inc/2)
        
        # Clamp to image boundaries to minimize padding
        x1 = max(0, x)
        y1 = max(0, y)
        x2 = min(real_w, x + int(l*bbox_inc))
        y2 = min(real_h, y + int(l*bbox_inc))
        
        # Crop the actual image region (no padding needed if within bounds)
        crop = img[y1:y2, x1:x2, :]
        
        # Only add padding if the expanded bbox goes outside image boundaries
        if x < 0 or y < 0 or x + int(l*bbox_inc) > real_w or y + int(l*bbox_inc) > real_h:
            # Calculate padding needed
            top = max(0, y1 - y)
            bottom = max(0, y + int(l*bbox_inc) - y2)
            left = max(0, x1 - x)
            right = max(0, x + int(l*bbox_inc) - x2)
            
            # Add minimal padding with edge replication (better than black)
            crop = cv2.copyMakeBorder(crop, top, bottom, left, right, cv2.BORDER_REPLICATE)
        
        return crop

    def predict(self, imgs: List[np.ndarray]) -> List[Dict]:
        """
        Predict anti-spoofing for list of face images using CONFIDENCE strategy
        
        CONFIDENCE STRATEGY (OPTIMAL):
        - is_real = (live_score > spoof_score) AND (max_confidence >= confidence_threshold)
        - This ensures both correct direction AND high certainty
        - Implements optimal Bayesian decision rule with uncertainty handling
        
        Args:
            imgs: List of face crops (BGR format from increased_crop)
            
        Returns:
            List of prediction results with scores and classification
            
        Output format:
            {
                'is_real': bool,           # True if live face (CONFIDENCE strategy)
                'live_score': float,       # Probability of real face
                'spoof_score': float,      # print_score + replay_score
                'confidence': float,       # Max of live/spoof score
                'decision_reason': str,    # Why this decision was made
                'label': str,              # 'Live', 'Print Attack', 'Replay Attack', 'Spoof', or 'Uncertain'
                'predicted_class': int,    # 0=live, 1=print, 2=replay
                'print_score': float,      # Photo attack probability
                'replay_score': float,     # Video replay attack probability
                'attack_type': str,        # 'live', 'print', 'replay', 'uncertain', or 'unknown'
                'detailed_label': str      # More descriptive label
            }
        """
        if not self.ort_session:
            return []

        results = []
        for img in imgs:
            try:
                onnx_result = self.ort_session.run([],
                    {self.input_name: self.preprocessing(img)})
                pred = onnx_result[0]
                pred = self.postprocessing(pred)
                
                # VALIDATION: Ensure model outputs exactly 3 classes
                if pred.shape[1] != 3:
                    logger.error(f"Model output has {pred.shape[1]} classes, expected 3 (live, print, replay)")
                    results.append(self._create_error_result("Invalid model output"))
                    continue
                
                live_score = float(pred[0][0])
                print_score = float(pred[0][1])
                replay_score = float(pred[0][2])
                
                predicted_class = np.argmax(pred[0])
                
                # VALIDATION: Ensure scores are properly normalized (sum ≈ 1.0)
                score_sum = live_score + print_score + replay_score
                if abs(score_sum - 1.0) > 1e-6:
                    logger.warning(f"Liveness detection scores not properly normalized: sum={score_sum:.6f}")
                
                # Calculate spoof score as sum of print and replay scores
                spoof_score = print_score + replay_score
                
                # CONFIDENCE STRATEGY: Best for maximum accuracy
                # Rule: (live_score > spoof_score) AND (max_confidence >= threshold)
                max_confidence = max(live_score, spoof_score)
                is_real = (live_score > spoof_score) and (max_confidence >= self.confidence_threshold)
                
                # Determine decision reason for transparency
                if live_score > spoof_score:
                    if max_confidence >= self.confidence_threshold:
                        decision_reason = f"Live face detected with high confidence ({max_confidence:.3f} ≥ {self.confidence_threshold})"
                    else:
                        decision_reason = f"Uncertain: Low confidence ({max_confidence:.3f} < {self.confidence_threshold}), rejecting for safety"
                        is_real = False  # Reject uncertain cases
                else:
                    decision_reason = f"Spoof detected: spoof_score ({spoof_score:.3f}) > live_score ({live_score:.3f})"
                
                # Determine attack type and labels
                if is_real:
                    attack_type = 'live'
                    label = 'Live'
                    detailed_label = f'Live Face (confidence: {live_score:.3f})'
                elif max_confidence < self.confidence_threshold:
                    # Model is uncertain - reject for safety
                    attack_type = 'uncertain'
                    label = 'Uncertain'
                    detailed_label = f'Uncertain Classification (max confidence: {max_confidence:.3f} < {self.confidence_threshold})'
                else:
                    # Confident spoof detection
                    if print_score > replay_score:
                        attack_type = 'print'
                        label = 'Print Attack'
                        detailed_label = f'Print Attack (confidence: {print_score:.3f})'
                    elif replay_score > print_score:
                        attack_type = 'replay'
                        label = 'Replay Attack'
                        detailed_label = f'Replay Attack (confidence: {replay_score:.3f})'
                    else:
                        attack_type = 'unknown'
                        label = 'Spoof'
                        detailed_label = f'Spoof Attack (print: {print_score:.3f}, replay: {replay_score:.3f})'
                
                result = {
                    'is_real': bool(is_real),
                    'live_score': float(live_score),
                    'spoof_score': float(spoof_score),
                    'confidence': float(max_confidence),
                    'decision_reason': decision_reason,
                    'label': label,
                    'detailed_label': detailed_label,
                    'predicted_class': int(predicted_class),
                    'print_score': float(print_score),
                    'replay_score': float(replay_score),
                    'attack_type': attack_type
                }
                results.append(result)
                
            except Exception as e:
                logger.error(f"Error in anti-spoofing prediction: {e}")
                results.append(self._create_error_result(f"Prediction error: {str(e)}"))
        
        return results
    
    def _create_error_result(self, error_msg: str) -> Dict:
        """Create a standardized error result"""
        return {
            'is_real': False,
            'live_score': 0.0,
            'spoof_score': 1.0,
            'confidence': 0.0,
            'decision_reason': f'Error: {error_msg}',
            'label': 'Error',
            'detailed_label': f'Error: {error_msg}',
            'predicted_class': 1,
            'print_score': 0.5,
            'replay_score': 0.5,
            'attack_type': 'error'
        }

    def detect_faces(self, image: np.ndarray, face_detections: List[Dict]) -> List[Dict]:
        """
        Process face detections with anti-spoofing using CONFIDENCE strategy
        
        Args:
            image: Input image (BGR format from OpenCV)
            face_detections: List of face detection dictionaries with bbox info
            
        Returns:
            List of face detections with anti-spoofing results
            
        Note:
            - Applies 1.5x bbox expansion via increased_crop() for better context
            - Converts BGR to RGB internally during preprocessing
            - Uses CONFIDENCE strategy for optimal accuracy
        """
        if not face_detections:
            return []
        
        face_crops = []
        valid_detections = []
        
        for detection in face_detections:
            bbox = detection.get('bbox', {})
            if not bbox:
                continue
                
            x = int(bbox.get('x', 0))
            y = int(bbox.get('y', 0))
            w = int(bbox.get('width', 0))
            h = int(bbox.get('height', 0))
            
            if w <= 0 or h <= 0:
                continue
            
            try:
                face_crop = self.increased_crop(image, (x, y, x+w, y+h), bbox_inc=1.5)
                if face_crop is None or face_crop.size == 0:
                    continue
            except Exception as e:
                logger.warning(f"increased_crop failed, using simple crop: {e}")
                face_crop = image[y:y+h, x:x+w]
                if face_crop.size == 0:
                    continue
                
            face_crops.append(face_crop)
            valid_detections.append(detection)
        
        if not face_crops:
            return face_detections
        
        predictions = self.predict(face_crops)
        
        results = []
        for i, detection in enumerate(face_detections):
            # Skip liveness processing if face already has liveness status (e.g., from size filter)
            if 'liveness' in detection and detection['liveness'].get('status') == 'insufficient_quality':
                # Keep existing liveness status from detector (small face filter)
                results.append(detection)
                continue
            
            if i < len(valid_detections):
                valid_idx = valid_detections.index(detection)
                prediction = predictions[valid_idx]
                
                detection['liveness'] = {
                    'is_real': prediction['is_real'],
                    'live_score': prediction['live_score'],
                    'spoof_score': prediction['spoof_score'],
                    'confidence': prediction['confidence'],
                    'decision_reason': prediction['decision_reason'],
                    'label': prediction['label'],
                    'detailed_label': prediction['detailed_label'],
                    'status': 'real' if prediction['is_real'] else ('uncertain' if prediction['attack_type'] == 'uncertain' else 'fake'),
                    'predicted_class': prediction['predicted_class'],
                    'print_score': prediction['print_score'],
                    'replay_score': prediction['replay_score'],
                    'attack_type': prediction['attack_type']
                }
            else:
                detection['liveness'] = {
                    'is_real': False,
                    'live_score': 0.0,
                    'spoof_score': 1.0,
                    'confidence': 0.0,
                    'decision_reason': 'Error: Processing failed',
                    'label': 'Error',
                    'detailed_label': 'Error: Processing failed',
                    'status': 'error',
                    'predicted_class': 1,
                    'print_score': 0.5,
                    'replay_score': 0.5,
                    'attack_type': 'error'
                }
            
            results.append(detection)
        
        return results

    async def detect_faces_async(self, image, faces):
        """Async wrapper for detect_faces method"""
        return self.detect_faces(image, faces)
    
    def get_attack_statistics(self, predictions: List[Dict]) -> Dict[str, Any]:
        """
        Analyze attack type statistics from predictions
        
        Args:
            predictions: List of prediction results from predict() method
            
        Returns:
            Dictionary with attack statistics including uncertain classifications
        """
        stats = {
            "total_predictions": len(predictions),
            "live_count": 0,
            "print_count": 0,
            "replay_count": 0,
            "uncertain_count": 0,
            "unknown_count": 0,
            "error_count": 0,
            "attack_distribution": {},
            "confidence_stats": {
                "live_avg": 0.0,
                "print_avg": 0.0,
                "replay_avg": 0.0,
                "overall_avg": 0.0,
                "uncertain_avg": 0.0
            }
        }
        
        if not predictions:
            return stats
        
        live_scores = []
        print_scores = []
        replay_scores = []
        uncertain_scores = []
        
        for pred in predictions:
            attack_type = pred.get('attack_type', 'unknown')
            
            if attack_type == 'live':
                stats["live_count"] += 1
                live_scores.append(pred.get('live_score', 0.0))
            elif attack_type == 'print':
                stats["print_count"] += 1
                print_scores.append(pred.get('print_score', 0.0))
            elif attack_type == 'replay':
                stats["replay_count"] += 1
                replay_scores.append(pred.get('replay_score', 0.0))
            elif attack_type == 'uncertain':
                stats["uncertain_count"] += 1
                uncertain_scores.append(pred.get('confidence', 0.0))
            elif attack_type == 'error':
                stats["error_count"] += 1
            else:
                stats["unknown_count"] += 1
        
        # Calculate attack distribution percentages
        total_valid = stats["live_count"] + stats["print_count"] + stats["replay_count"] + stats["uncertain_count"]
        if total_valid > 0:
            stats["attack_distribution"] = {
                "live_percentage": (stats["live_count"] / total_valid) * 100,
                "print_percentage": (stats["print_count"] / total_valid) * 100,
                "replay_percentage": (stats["replay_count"] / total_valid) * 100,
                "uncertain_percentage": (stats["uncertain_count"] / total_valid) * 100
            }
        
        # Calculate average confidence scores
        if live_scores:
            stats["confidence_stats"]["live_avg"] = sum(live_scores) / len(live_scores)
        if print_scores:
            stats["confidence_stats"]["print_avg"] = sum(print_scores) / len(print_scores)
        if replay_scores:
            stats["confidence_stats"]["replay_avg"] = sum(replay_scores) / len(replay_scores)
        if uncertain_scores:
            stats["confidence_stats"]["uncertain_avg"] = sum(uncertain_scores) / len(uncertain_scores)
        
        all_scores = live_scores + print_scores + replay_scores
        if all_scores:
            stats["confidence_stats"]["overall_avg"] = sum(all_scores) / len(all_scores)
        
        return stats

    def validate_model(self) -> Dict[str, Any]:
        """
        Validate that the model is properly configured for 3-class detection
        
        Returns:
            Dictionary with validation results
        """
        validation_result = {
            "is_valid": False,
            "model_path": str(self.model_path),
            "model_exists": False,
            "session_loaded": False,
            "output_classes": 0,
            "expected_classes": 3,
            "class_names": ["live", "print", "replay"],
            "strategy": "CONFIDENCE (Optimal for Maximum Accuracy)",
            "errors": []
        }
        
        # Check if model file exists
        if os.path.isfile(self.model_path):
            validation_result["model_exists"] = True
        else:
            validation_result["errors"].append(f"Model file not found: {self.model_path}")
            return validation_result
        
        # Check if session is loaded
        if self.ort_session is not None:
            validation_result["session_loaded"] = True
        else:
            validation_result["errors"].append("ONNX session not loaded")
            return validation_result
        
        # Test model output shape
        try:
            # Create a dummy input image
            dummy_img = np.zeros((self.model_img_size, self.model_img_size, 3), dtype=np.uint8)
            dummy_input = self.preprocessing(dummy_img)
            
            # Run inference
            onnx_result = self.ort_session.run([], {self.input_name: dummy_input})
            pred = onnx_result[0]
            
            # Check output shape
            if len(pred.shape) == 2 and pred.shape[1] == 3:
                validation_result["output_classes"] = pred.shape[1]
                validation_result["is_valid"] = True
                # Liveness detection model validation passed: 3-class detection ready with CONFIDENCE strategy
            else:
                validation_result["errors"].append(f"Invalid output shape: {pred.shape}, expected (1, 3)")
                
        except Exception as e:
            validation_result["errors"].append(f"Model inference test failed: {str(e)}")
        
        return validation_result

    def get_model_info(self):
        """Get model information with CONFIDENCE strategy details"""
        validation = self.validate_model()
        return {
            "model_path": self.model_path,
            "model_img_size": self.model_img_size,
            "validation": validation,
            "supported_attacks": ["print", "replay"],
            "detection_classes": 3,
            "class_names": ["live", "print", "replay"],
            "strategy": "CONFIDENCE",
            "strategy_description": "Optimal Bayesian decision rule: (live_score > spoof_score) AND (confidence >= threshold)",
            "configuration": {
                "confidence_threshold": self.confidence_threshold
            },
            "strategy_benefits": [
                "Maximum accuracy through uncertainty handling",
                "Rejects ambiguous cases for safety",
                "Implements optimal Bayesian decision theory",
                "Industry standard for production systems",
                "Balances security and usability"
            ]
        }
    
    def set_confidence_threshold(self, threshold: float):
        """
        Adjust confidence threshold for CONFIDENCE strategy
        
        Args:
            threshold: Confidence threshold (recommended: 0.60-0.70)
                      Lower = more permissive (higher recall, lower precision)
                      Higher = more strict (lower recall, higher precision)
        """
        if not 0.0 <= threshold <= 1.0:
            raise ValueError(f"Threshold must be between 0.0 and 1.0, got {threshold}")
        
        old_threshold = self.confidence_threshold
        self.confidence_threshold = threshold
        # Confidence threshold updated
        
        if threshold < 0.60:
            logger.warning("Low confidence threshold may increase false positives (accepting spoofs)")
        elif threshold > 0.75:
            logger.warning("High confidence threshold may increase false negatives (rejecting real faces)")
    
    def analyze_threshold_impact(self, predictions: List[Dict]) -> Dict[str, Any]:
        """
        Analyze how different confidence thresholds would impact predictions
        
        Args:
            predictions: List of prediction results
            
        Returns:
            Analysis of threshold sensitivity
        """
        if not predictions:
            return {"error": "No predictions to analyze"}
        
        thresholds = [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80]
        analysis = {
            "current_threshold": self.confidence_threshold,
            "threshold_analysis": {},
            "recommendations": []
        }
        
        for threshold in thresholds:
            accepted_as_real = 0
            uncertain_count = 0
            
            for pred in predictions:
                live_score = pred.get('live_score', 0)
                spoof_score = pred.get('spoof_score', 0)
                max_conf = max(live_score, spoof_score)
                
                if live_score > spoof_score and max_conf >= threshold:
                    accepted_as_real += 1
                elif max_conf < threshold:
                    uncertain_count += 1
            
            analysis["threshold_analysis"][threshold] = {
                "accepted_as_real": accepted_as_real,
                "accepted_percentage": (accepted_as_real / len(predictions)) * 100,
                "uncertain_count": uncertain_count,
                "uncertain_percentage": (uncertain_count / len(predictions)) * 100
            }
        
        # Generate recommendations
        current_stats = analysis["threshold_analysis"][self.confidence_threshold]
        uncertain_pct = current_stats["uncertain_percentage"]
        
        if uncertain_pct > 20:
            analysis["recommendations"].append(
                f"High uncertainty rate ({uncertain_pct:.1f}%). Consider lowering threshold to {self.confidence_threshold - 0.05:.2f}"
            )
        elif uncertain_pct < 5:
            analysis["recommendations"].append(
                f"Low uncertainty rate ({uncertain_pct:.1f}%). Model is very confident. Current threshold is optimal."
            )
        else:
            analysis["recommendations"].append(
                f"Balanced uncertainty rate ({uncertain_pct:.1f}%). Current threshold {self.confidence_threshold} is appropriate."
            )
        
        return analysis