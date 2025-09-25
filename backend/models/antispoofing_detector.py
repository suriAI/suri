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
        session_options: Optional[Dict] = None
    ):
        self.model_path = model_path
        self.input_size = input_size
        self.threshold = threshold
        self.providers = providers or ['CPUExecutionProvider']
        self.max_batch_size = max_batch_size
        self.session_options = session_options
        
        # Model components
        self.session = None
        
        # Initialize model
        self._initialize_model()
        
        logger.info(f"Simple AntiSpoofing detector initialized with threshold: {threshold}")
    
    def _initialize_model(self):
        """Initialize the ONNX model with optimized session options"""
        try:
            logger.info(f"Loading anti-spoofing model from: {self.model_path}")
            
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
            
            logger.info(f"Model input shape: {input_info.shape}")
            logger.info(f"Model output shape: {output_info.shape}")
            logger.info(f"Available providers: {self.session.get_providers()}")
            
        except Exception as e:
            logger.error(f"Failed to initialize anti-spoofing model: {e}")
            raise
    
    def _preprocess_single_face(self, face_image: np.ndarray) -> np.ndarray:
        """Preprocess a single face image for the model"""
        try:
            # Resize to model input size
            resized = cv2.resize(face_image, self.input_size)
            
            # Convert BGR to RGB
            rgb_image = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
            
            # Normalize to [0, 1]
            normalized = rgb_image.astype(np.float32) / 255.0
            
            # Add batch dimension and transpose to NCHW format
            input_tensor = np.transpose(normalized, (2, 0, 1))  # HWC to CHW
            input_tensor = np.expand_dims(input_tensor, axis=0)  # Add batch dimension
            
            return input_tensor
            
        except Exception as e:
            logger.error(f"Error preprocessing face image: {e}")
            raise
    
    def _extract_face_crop(self, image: np.ndarray, bbox, margin: float = 0.2) -> Optional[np.ndarray]:
        """Extract face crop from image using bbox"""
        try:
            h, w = image.shape[:2]
            
            # Handle different bbox formats
            if isinstance(bbox, dict):
                x = int(bbox.get('x', 0))
                y = int(bbox.get('y', 0))
                width = int(bbox.get('width', 0))
                height = int(bbox.get('height', 0))
            elif isinstance(bbox, list) and len(bbox) >= 4:
                x, y, width, height = map(int, bbox[:4])
            else:
                logger.error(f"Invalid bbox format: {bbox}")
                return None
            
            # Add margin
            margin_x = int(width * margin)
            margin_y = int(height * margin)
            
            # Calculate expanded coordinates
            x1 = max(0, x - margin_x)
            y1 = max(0, y - margin_y)
            x2 = min(w, x + width + margin_x)
            y2 = min(h, y + height + margin_y)
            
            # Extract face crop
            face_crop = image[y1:y2, x1:x2]
            
            if face_crop.size == 0:
                logger.debug("Face crop is empty")
                return None
            
            return face_crop
            
        except Exception as e:
            logger.error(f"Error extracting face crop: {e}")
            return None
    
    def detect_faces_batch(self, image: np.ndarray, face_detections: List[Dict]) -> List[Dict]:
        """
        Simple processing of faces without caching or frame skipping
        """
        results = []
        logger.debug(f"Processing {len(face_detections)} faces")
        
        for i, face in enumerate(face_detections):
            bbox = face.get('bbox', face.get('box', {}))
            if not bbox:
                logger.debug(f"Face {i}: No bbox found")
                continue
            
            logger.debug(f"Face {i}: bbox = {bbox}")
            
            # Extract face crop
            face_crop = self._extract_face_crop(image, bbox)
            if face_crop is None:
                logger.debug(f"Face {i}: Face crop extraction failed")
                continue
            
            logger.debug(f"Face {i}: Face crop extracted successfully, shape = {face_crop.shape}")
            
            # Process single face
            start_time = time.time()
            antispoofing_result = self._process_single_face(face_crop)
            processing_time = time.time() - start_time
            
            logger.debug(f"Face {i}: Processing result = {antispoofing_result}")
            
            # Add processing time to result
            antispoofing_result['processing_time'] = processing_time
            antispoofing_result['cached'] = False
            
            result = {
                "face_id": i,
                "bbox": bbox,
                "antispoofing": antispoofing_result
            }
            
            # Copy over original face detection data
            for key, value in face.items():
                if key not in result:
                    result[key] = value
            
            results.append(result)
        
        logger.debug(f"Returning {len(results)} results")
        return results
    
    def _process_single_face(self, face_crop: np.ndarray) -> Dict:
        """Process a single face crop"""
        try:
            # Preprocess the face
            input_tensor = self._preprocess_single_face(face_crop)
            
            # Run inference
            input_name = self.session.get_inputs()[0].name
            outputs = self.session.run(None, {input_name: input_tensor})
            prediction = outputs[0][0]  # Remove batch dimension
            
            # Process prediction
            return self._process_single_prediction(prediction)
            
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
    

    def clear_cache(self):
        """Clear cache (not used in simple version)"""
        pass  # No-op in simple version
    
    def get_model_info(self) -> Dict:
        """Get model information"""
        return {
            "model_path": self.model_path,
            "input_size": self.input_size,
            "threshold": self.threshold,
            "providers": self.providers,
            "session_providers": self.session.get_providers() if self.session else []
        }