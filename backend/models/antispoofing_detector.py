"""
Simple Anti-Spoofing Detector without caching complexity
"""

import logging
import time
from typing import List, Dict, Tuple, Optional

import cv2
import numpy as np
import onnxruntime as ort

logger = logging.getLogger(__name__)

class OptimizedAntiSpoofingDetector:
    """
    Simple Anti-Spoofing Detector that processes each frame directly
    without caching or frame skipping to avoid UI flickering
    """
    
    def __init__(
        self,
        model_path: str,
        input_size: Tuple[int, int] = (128, 128),
        threshold: float = 0.5,
        providers: Optional[List[str]] = None,
        max_batch_size: int = 1,
        cache_duration: float = 0.0,  # No caching
        session_options: Optional[Dict] = None,
        smoothing_factor: float = 0.0,  # Disabled by default to prevent cross-contamination
        enable_temporal_smoothing: bool = False  # Explicit control
    ):
        self.model_path = model_path
        self.input_size = input_size
        self.threshold = threshold
        self.providers = providers or ['CPUExecutionProvider']
        self.max_batch_size = max_batch_size
        self.session_options = session_options
        self.smoothing_factor = smoothing_factor
        self.enable_temporal_smoothing = enable_temporal_smoothing
        
        # Model components
        self.session = None
        
        # Temporal consistency tracking (only if enabled)
        self.previous_results = {}  # face_id -> previous result
        self.result_history = {}    # face_id -> list of recent results
        self.max_history = 5        # Keep last 5 results for smoothing
        
        # Initialize model
        self._initialize_model()
    
    def _initialize_model(self):
        """Initialize the ONNX model with optimized session options"""
        try:
            
            # Create optimized session options
            session_options = ort.SessionOptions()
            
            # Apply optimized session options if available
            if hasattr(self, 'session_options') and self.session_options:
                for key, value in self.session_options.items():
                    if hasattr(session_options, key):
                        setattr(session_options, key, value)
                        logger.debug(f"Applied session option: {key} = {value}")
            
            # Create ONNX session with optimized options
            self.session = ort.InferenceSession(
                self.model_path,
                sess_options=session_options,
                providers=self.providers
            )
            
            # Get model info
            input_info = self.session.get_inputs()[0]
            output_info = self.session.get_outputs()[0]
            
        except Exception as e:
            logger.error(f"Failed to initialize anti-spoofing model: {e}")
            raise
    
    def _preprocess_single_face(self, face_image: np.ndarray) -> np.ndarray:
        """Preprocess a single face image for the model with consistent parameters"""
        try:
            # Ensure input is valid
            if face_image is None or face_image.size == 0:
                raise ValueError("Invalid face image")
            
            # Resize to model input size with consistent interpolation
            resized = cv2.resize(face_image, self.input_size, interpolation=cv2.INTER_LINEAR)
            
            # Convert BGR to RGB
            rgb_image = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
            
            # Normalize to [0, 1] with consistent dtype
            normalized = rgb_image.astype(np.float32) / 255.0
            
            # Ensure values are in valid range
            normalized = np.clip(normalized, 0.0, 1.0)
            
            # Add batch dimension and transpose to NCHW format
            input_tensor = np.transpose(normalized, (2, 0, 1))  # HWC to CHW
            input_tensor = np.expand_dims(input_tensor, axis=0)  # Add batch dimension
            
            # Verify tensor shape
            expected_shape = (1, 3, self.input_size[1], self.input_size[0])
            if input_tensor.shape != expected_shape:
                raise ValueError(f"Unexpected tensor shape: {input_tensor.shape}, expected: {expected_shape}")
            
            return input_tensor
            
        except Exception as e:
            logger.error(f"Error preprocessing face image: {e}")
            raise
    
    def _extract_face_crop(self, image: np.ndarray, bbox, margin: float = 0.2) -> Optional[np.ndarray]:
        """Extract face crop from image using bbox with consistent preprocessing"""
        try:
            h, w = image.shape[:2]
            
            # Handle different bbox formats
            if isinstance(bbox, dict):
                x = float(bbox.get('x', 0))
                y = float(bbox.get('y', 0))
                width = float(bbox.get('width', 0))
                height = float(bbox.get('height', 0))
            elif isinstance(bbox, list) and len(bbox) >= 4:
                x, y, width, height = map(float, bbox[:4])
            else:
                logger.error(f"Invalid bbox format: {bbox}")
                return None
            
            # Ensure minimum face size for reliable detection
            min_size = 32
            if width < min_size or height < min_size:
                logger.debug(f"Face too small: {width}x{height}, minimum required: {min_size}x{min_size}")
                return None
            
            # Use consistent margin calculation
            margin_x = width * margin
            margin_y = height * margin
            
            # Calculate expanded coordinates with proper rounding
            x1 = max(0, int(round(x - margin_x)))
            y1 = max(0, int(round(y - margin_y)))
            x2 = min(w, int(round(x + width + margin_x)))
            y2 = min(h, int(round(y + height + margin_y)))
            
            # Ensure we have a valid crop area
            if x2 <= x1 or y2 <= y1:
                logger.debug("Invalid crop coordinates")
                return None
            
            # Extract face crop
            face_crop = image[y1:y2, x1:x2]
            
            if face_crop.size == 0:
                logger.debug("Face crop is empty")
                return None
            
            # Ensure minimum crop size after extraction
            crop_h, crop_w = face_crop.shape[:2]
            if crop_h < min_size or crop_w < min_size:
                logger.debug(f"Extracted crop too small: {crop_w}x{crop_h}")
                return None
            
            return face_crop
            
        except Exception as e:
            logger.error(f"Error extracting face crop: {e}")
            return None
    
    def detect_faces_batch(self, image: np.ndarray, face_detections: List[Dict]) -> List[Dict]:
        """
        True batch processing of faces for consistent results
        """
        results = []
        logger.debug(f"Processing {len(face_detections)} faces")
        
        if not face_detections:
            return results
        
        # Extract all face crops first
        face_crops = []
        valid_faces = []
        
        for i, face in enumerate(face_detections):
            bbox = face.get('bbox', face.get('box', {}))
            if not bbox:
                logger.debug(f"Face {i}: No bbox found")
                continue
            
            logger.debug(f"Face {i}: bbox = {bbox}")
            
            # Extract face crop with consistent preprocessing
            face_crop = self._extract_face_crop(image, bbox, margin=0.2)
            if face_crop is None:
                logger.debug(f"Face {i}: Face crop extraction failed")
                continue
            
            logger.debug(f"Face {i}: Face crop extracted successfully, shape = {face_crop.shape}")
            face_crops.append(face_crop)
            valid_faces.append((i, face))
        
        if not face_crops:
            logger.debug("No valid face crops extracted")
            return results
        
        # Process each face individually to prevent cross-contamination
        start_time = time.time()
        
        # Combine results with face data and apply temporal smoothing if enabled
        for (face_id, face), face_crop in zip(valid_faces, face_crops):
            # Process this face individually
            antispoofing_result = self._process_single_face(face_crop)
            # Generate a stable face identifier based on bbox position
            bbox = face.get('bbox', face.get('box', {}))
            stable_face_id = self._generate_stable_face_id(bbox)
            
            # Apply temporal smoothing only if enabled
            if self.enable_temporal_smoothing:
                smoothed_result = self._apply_temporal_smoothing(stable_face_id, antispoofing_result)
                logger.debug(f"Face {face_id} (stable_id: {stable_face_id}): Raw result = {antispoofing_result}")
                logger.debug(f"Face {face_id} (stable_id: {stable_face_id}): Smoothed result = {smoothed_result}")
            else:
                smoothed_result = antispoofing_result
                logger.debug(f"Face {face_id}: Result = {antispoofing_result} (no smoothing)")
            
            # Add processing time to result
            processing_time = time.time() - start_time
            smoothed_result['processing_time'] = processing_time
            smoothed_result['cached'] = False
            
            result = {
                "face_id": face_id,
                "bbox": face.get('bbox', face.get('box', {})),
                "antispoofing": smoothed_result
            }
            
            # Copy over original face detection data
            for key, value in face.items():
                if key not in result:
                    result[key] = value
            
            results.append(result)
        
        logger.debug(f"Returning {len(results)} results")
        return results
    
    def _process_faces_batch(self, face_crops: List[np.ndarray]) -> List[Dict]:
        """Process multiple face crops in a single batch for consistency"""
        try:
            if not face_crops:
                return []
            
            # Process in batches according to max_batch_size
            all_results = []
            
            for i in range(0, len(face_crops), self.max_batch_size):
                batch_crops = face_crops[i:i + self.max_batch_size]
                batch_results = self._process_batch_chunk(batch_crops)
                all_results.extend(batch_results)
            
            return all_results
            
        except Exception as e:
            logger.error(f"Error processing face batch: {e}")
            # Return default values for all faces on error
            return [{
                "is_real": True,
                "real_score": 0.5,
                "fake_score": 0.5,
                "confidence": 0.5,
                "threshold": self.threshold,
                "error": str(e)
            } for _ in face_crops]
    
    def _process_batch_chunk(self, face_crops: List[np.ndarray]) -> List[Dict]:
        """Process a chunk of face crops in a single ONNX inference call"""
        try:
            # Preprocess all faces with consistent parameters
            batch_tensors = []
            for face_crop in face_crops:
                input_tensor = self._preprocess_single_face(face_crop)
                batch_tensors.append(input_tensor[0])  # Remove individual batch dimension
            
            # Stack into a single batch tensor
            batch_input = np.stack(batch_tensors, axis=0)
            
            # Run single batch inference for consistency
            input_name = self.session.get_inputs()[0].name
            outputs = self.session.run(None, {input_name: batch_input})
            predictions = outputs[0]  # Shape: [batch_size, num_classes]
            
            # Process all predictions
            results = []
            for prediction in predictions:
                result = self._process_single_prediction(prediction)
                results.append(result)
            
            return results
            
        except Exception as e:
            logger.error(f"Error processing batch chunk: {e}")
            # Return default values for all faces in this chunk
            return [{
                "is_real": True,
                "real_score": 0.5,
                "fake_score": 0.5,
                "confidence": 0.5,
                "threshold": self.threshold,
                "error": str(e)
            } for _ in face_crops]

    def _process_single_face(self, face_crop: np.ndarray) -> Dict:
        """Process a single face crop individually"""
        try:
            # Preprocess the face
            input_tensor = self._preprocess_single_face(face_crop)
            
            # Run individual inference
            input_name = self.session.get_inputs()[0].name
            outputs = self.session.run(None, {input_name: input_tensor})
            prediction = outputs[0][0]  # Get first (and only) prediction
            
            # Process the prediction
            result = self._process_single_prediction(prediction)
            return result
            
        except Exception as e:
            logger.error(f"Error processing face: {e}")
            # Return default values on error
            return {
                "is_real": True,
                "real_score": 0.5,
                "fake_score": 0.5,
                "confidence": 0.5,
                "threshold": self.threshold,
                "error": str(e)
            }
    
    def _process_single_prediction(self, prediction: np.ndarray) -> Dict:
        """
        Process model prediction to determine if face is real or fake
        Model output format: [real_logit, fake_logit]
        """
        try:
            # Apply softmax to get probabilities
            exp_pred = np.exp(prediction - np.max(prediction))  # Numerical stability
            softmax_probs = exp_pred / np.sum(exp_pred)
            
            real_score = float(softmax_probs[0])  # First element is real
            fake_score = float(softmax_probs[1])  # Second element is fake
            
            # Determine if face is real based on threshold
            is_real = real_score > self.threshold
            confidence = real_score if is_real else fake_score
            
            return {
                "is_real": is_real,
                "real_score": real_score,
                "fake_score": fake_score,
                "confidence": confidence,
                "threshold": self.threshold
            }
            
        except Exception as e:
            logger.error(f"Error processing prediction: {e}")
            return {
                "is_real": True,
                "real_score": 0.5,
                "fake_score": 0.5,
                "confidence": 0.5,
                "threshold": self.threshold,
                "error": str(e)
            }
    
    async def detect_faces_async(self, image: np.ndarray, face_detections: List[Dict]) -> List[Dict]:
        """Async wrapper for face detection"""
        return self.detect_faces_batch(image, face_detections)
    
    def set_threshold(self, threshold: float):
        """Set the threshold for real/fake classification"""
        self.threshold = threshold
        logger.info(f"Threshold updated to: {threshold}")
    

    def _generate_stable_face_id(self, bbox) -> str:
        """Generate a stable face ID based on bbox position to prevent cross-contamination"""
        try:
            if isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
                x, y, w, h = bbox[:4]
                # Create a hash based on approximate position (rounded to reduce noise)
                # This helps group faces that are in similar positions across frames
                grid_x = int(x // 50)  # 50-pixel grid
                grid_y = int(y // 50)
                grid_w = int(w // 20)  # 20-pixel size grid
                grid_h = int(h // 20)
                return f"face_{grid_x}_{grid_y}_{grid_w}_{grid_h}"
            else:
                # Fallback for invalid bbox
                return f"face_unknown_{hash(str(bbox)) % 10000}"
        except Exception as e:
            logger.warning(f"Error generating stable face ID: {e}")
            return f"face_error_{hash(str(bbox)) % 10000}"

    def _apply_temporal_smoothing(self, face_id: str, current_result: Dict) -> Dict:
        """Apply temporal smoothing to reduce flickering"""
        try:
            # Use the stable face ID directly as the key
            face_key = face_id
            
            # Get current scores
            current_real_score = current_result.get('real_score', 0.5)
            current_fake_score = current_result.get('fake_score', 0.5)
            
            # Initialize history if not exists
            if face_key not in self.result_history:
                self.result_history[face_key] = []
            
            # Add current result to history
            self.result_history[face_key].append({
                'real_score': current_real_score,
                'fake_score': current_fake_score,
                'timestamp': time.time()
            })
            
            # Keep only recent history
            if len(self.result_history[face_key]) > self.max_history:
                self.result_history[face_key] = self.result_history[face_key][-self.max_history:]
            
            # Apply smoothing if we have previous results
            if len(self.result_history[face_key]) > 1:
                # Calculate weighted average with more weight on recent results
                total_weight = 0
                weighted_real_score = 0
                weighted_fake_score = 0
                
                for i, hist_result in enumerate(self.result_history[face_key]):
                    # More recent results get higher weight
                    weight = (i + 1) / len(self.result_history[face_key])
                    weighted_real_score += hist_result['real_score'] * weight
                    weighted_fake_score += hist_result['fake_score'] * weight
                    total_weight += weight
                
                # Normalize
                if total_weight > 0:
                    smoothed_real_score = weighted_real_score / total_weight
                    smoothed_fake_score = weighted_fake_score / total_weight
                    
                    # Apply smoothing factor (blend current with smoothed)
                    final_real_score = (
                        current_real_score * self.smoothing_factor + 
                        smoothed_real_score * (1 - self.smoothing_factor)
                    )
                    final_fake_score = (
                        current_fake_score * self.smoothing_factor + 
                        smoothed_fake_score * (1 - self.smoothing_factor)
                    )
                    
                    # Ensure scores sum to 1
                    total_score = final_real_score + final_fake_score
                    if total_score > 0:
                        final_real_score /= total_score
                        final_fake_score /= total_score
                    
                    # Determine final classification
                    is_real = final_real_score > self.threshold
                    confidence = final_real_score if is_real else final_fake_score
                    
                    return {
                        "is_real": is_real,
                        "real_score": final_real_score,
                        "fake_score": final_fake_score,
                        "confidence": confidence,
                        "threshold": self.threshold,
                        "smoothed": True
                    }
            
            # Return original result if no smoothing applied
            return {
                **current_result,
                "smoothed": False
            }
            
        except Exception as e:
            logger.error(f"Error applying temporal smoothing: {e}")
            return {
                **current_result,
                "smoothed": False,
                "error": str(e)
            }

    def clear_cache(self):
        """Clear cache and temporal smoothing history"""
        self.previous_results.clear()
        self.result_history.clear()
        logger.info("Cleared temporal smoothing history")
    
    def get_model_info(self) -> Dict:
        """Get model information"""
        return {
            "model_path": self.model_path,
            "input_size": self.input_size,
            "threshold": self.threshold,
            "providers": self.providers,
            "session_providers": self.session.get_providers() if self.session else []
        }