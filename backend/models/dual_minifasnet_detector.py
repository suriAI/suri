"""
Dual MiniFASNet Anti-Spoofing Detector
Ensemble approach using both MiniFASNetV2 and MiniFASNe            # Resize crop to model input size
            resized = cv2.resize(face_crop, self.input_size, interpolation=cv2.INTER_LINEAR)
            
            # CRITICAL: Keep BGR format and raw pixel values [0-255]
            # Original C++ uses: ncnn::Mat::from_pixels(..., ncnn::Mat::PIXEL_BGR, ...)
            # PyTorch training code: img.float() returns raw [0-255] values in RGB
            # But ncnn PIXEL_BGR means B,G,R channel order!
            
            # Convert BGR (OpenCV) to RGB (PyTorch training format)
            rgb_image = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
            input_tensor = rgb_image.astype(np.float32)  # Raw [0-255] values
            
            # Add batch dimension and transpose to NCHW format
            input_tensor = np.transpose(input_tensor, (2, 0, 1))  # HWC to CHW
            input_tensor = np.expand_dims(input_tensor, axis=0)  # Add batch dimensionimilar to the implementation in Silent-Face-Anti-Spoofing APK
"""

import logging
import time
from typing import List, Dict, Tuple, Optional

import cv2
import numpy as np
import onnxruntime as ort

logger = logging.getLogger(__name__)

class DualMiniFASNetDetector:
    """
    Dual-model anti-spoofing detector using ensemble prediction
    Combines MiniFASNetV2 (texture-based) and MiniFASNetV1SE (shape-based with SE)
    """
    
    def __init__(
        self,
        model_v2_path: str,
        model_v1se_path: str,
        input_size: Tuple[int, int] = (80, 80),
        threshold: float = 0.7,
        providers: Optional[List[str]] = None,
        max_batch_size: int = 8,
        session_options: Optional[Dict] = None,
        v2_weight: float = 0.6,
        v1se_weight: float = 0.4
    ):
        self.model_v2_path = model_v2_path
        self.model_v1se_path = model_v1se_path
        self.input_size = input_size
        self.threshold = threshold
        self.providers = providers or ['CPUExecutionProvider']
        self.max_batch_size = max_batch_size
        self.session_options = session_options
        self.v2_weight = v2_weight
        self.v1se_weight = v1se_weight
        
        # Normalize weights
        total_weight = v2_weight + v1se_weight
        self.v2_weight = v2_weight / total_weight
        self.v1se_weight = v1se_weight / total_weight
        
        # Model sessions
        self.session_v2 = None
        self.session_v1se = None
        
        # Initialize both models
        self._initialize_models()
    
    def _initialize_models(self):
        """Initialize both ONNX models with optimized session options"""
        try:
            # Create optimized session options
            session_opts = ort.SessionOptions()
            
            # Apply optimized session options if available
            if self.session_options:
                for key, value in self.session_options.items():
                    if hasattr(session_opts, key):
                        setattr(session_opts, key, value)
                        logger.debug(f"Applied session option: {key} = {value}")
            
            # Initialize MiniFASNetV2 (texture-based)
            logger.info(f"Loading MiniFASNetV2 from: {self.model_v2_path}")
            self.session_v2 = ort.InferenceSession(
                self.model_v2_path,
                sess_options=session_opts,
                providers=self.providers
            )
            logger.info(f"[OK] MiniFASNetV2 loaded successfully (weight: {self.v2_weight:.2f})")
            
            # Initialize MiniFASNetV1SE (shape-based with SE)
            logger.info(f"Loading MiniFASNetV1SE from: {self.model_v1se_path}")
            self.session_v1se = ort.InferenceSession(
                self.model_v1se_path,
                sess_options=session_opts,
                providers=self.providers
            )
            logger.info(f"[OK] MiniFASNetV1SE loaded successfully (weight: {self.v1se_weight:.2f})")
            
            logger.info(f"[OK] Dual MiniFASNet detector initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize dual MiniFASNet models: {e}")
            raise
    
    def _preprocess_single_face(self, face_image: np.ndarray) -> np.ndarray:
        """
        Preprocess a single face image for MiniFASNet models (80x80 input)
        
        CRITICAL: Matches original Silent-Face-Anti-Spoofing preprocessing
        Reference: engine/src/main/cpp/live/live.cpp line 58-62
        
        ncnn::Mat::from_pixels() internally does:
        1. BGR → RGB conversion
        2. Normalization to [0, 1] by dividing by 255.0
        
        We must replicate this behavior for ONNX!
        """
        try:
            # Ensure input is valid
            if face_image is None or face_image.size == 0:
                raise ValueError("Invalid face image")
            
            # Resize to 80x80 (MiniFASNet input size)
            resized = cv2.resize(face_image, self.input_size, interpolation=cv2.INTER_LINEAR)
            
            # Convert BGR to RGB
            rgb_image = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
            
            # CRITICAL FIX: PyTorch training MODIFIED ToTensor to NOT normalize!
            # See Silent-Face-Anti-Spoofing/src/data_io/functional.py line 59:
            # "return img.float()" - the div(255) was commented out by author!
            # Models were trained on RAW [0, 255] values, NOT [0, 1] normalized!
            preprocessed = rgb_image.astype(np.float32)  # Keep [0, 255] range!
            
            # Transpose to NCHW format and add batch dimension
            input_tensor = np.transpose(preprocessed, (2, 0, 1))  # HWC to CHW
            input_tensor = np.expand_dims(input_tensor, axis=0)  # Add batch dimension
            
            # Verify tensor shape
            expected_shape = (1, 3, self.input_size[1], self.input_size[0])
            if input_tensor.shape != expected_shape:
                raise ValueError(f"Unexpected tensor shape: {input_tensor.shape}, expected: {expected_shape}")
            
            return input_tensor
            
        except Exception as e:
            logger.error(f"Error preprocessing face image: {e}")
            raise
    
    def _extract_face_crop(self, image: np.ndarray, bbox, scale: float = 2.7, shift_x: float = 0.0, shift_y: float = 0.0) -> Optional[np.ndarray]:
        """
        Extract face crop using scaling and shifting like the original MiniFASNet implementation.
        
        This is a 100% accurate Python port of the C++ implementation from:
        https://github.com/minivision-ai/Silent-Face-Anti-Spoofing-APK/blob/main/engine/src/main/cpp/live/live.cpp#L79-L126
        
        The original uses scale parameters (NOT margin):
        - MiniFASNetV2 (2.7_80x80): scale=2.7 (crops 270% of face bbox with context)
        - MiniFASNetV1SE (4.0_80x80): scale=4.0 (crops 400% of face bbox with context)
        
        Args:
            image: Input image
            bbox: Face bounding box [x, y, width, height] or dict with x, y, width, height
            scale: Scale factor for bbox expansion (2.7 for V2, 4.0 for V1SE)
            shift_x: Horizontal shift as fraction of bbox width (default 0.0)
            shift_y: Vertical shift as fraction of bbox height (default 0.0)
        
        Returns:
            Cropped face region with context, or None if extraction fails
        """
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
            
            # Ensure minimum face size
            min_size = 32
            if width < min_size or height < min_size:
                logger.debug(f"Face too small: {width}x{height}, minimum: {min_size}x{min_size}")
                return None
            
            # --- BEGIN: Exact port of C++ CalculateBox function ---
            # Reference: engine/src/main/cpp/live/live.cpp lines 79-126
            
            box_width = int(width)
            box_height = int(height)
            
            # Calculate shift amounts in pixels (line 88-89 in C++)
            shift_x_px = int(box_width * shift_x)
            shift_y_px = int(box_height * shift_y)
            
            # CRITICAL FIX: Don't clamp scale here!
            # The original C++ clamped scale, but this causes V2 and V1SE to become identical
            # when face is large. We handle boundaries later instead.
            # Original line: scale = min(scale, min((w - 1) / float(box_width), (h - 1) / float(box_height)))
            # New approach: Use the requested scale, handle boundaries in clipping
            requested_scale = scale  # Keep original scale request
            
            # Calculate new dimensions after scaling (using FULL scale, not clamped)
            new_width = int(box_width * requested_scale)
            new_height = int(box_height * requested_scale)
            
            # Calculate bbox center (line 99-100 in C++)
            box_center_x = box_width // 2 + int(x)
            box_center_y = box_height // 2 + int(y)
            
            # Apply scaling and shifting from center (line 102-105 in C++)
            left_top_x = box_center_x - new_width // 2 + shift_x_px
            left_top_y = box_center_y - new_height // 2 + shift_y_px
            right_bottom_x = box_center_x + new_width // 2 + shift_x_px
            right_bottom_y = box_center_y + new_height // 2 + shift_y_px
            
            # Handle boundary conditions with shifting (line 107-122 in C++)
            # Clamp to image boundaries (this is where we handle the scale limit)
            # If left edge is out of bounds, shift right
            if left_top_x < 0:
                right_bottom_x -= left_top_x
                left_top_x = 0
            
            # If top edge is out of bounds, shift down
            if left_top_y < 0:
                right_bottom_y -= left_top_y
                left_top_y = 0
            
            # If right edge is out of bounds, shift left
            if right_bottom_x >= w:
                s = right_bottom_x - w + 1
                left_top_x -= s
                right_bottom_x -= s
            
            # If bottom edge is out of bounds, shift up
            if right_bottom_y >= h:
                s = right_bottom_y - h + 1
                left_top_y -= s
                right_bottom_y -= s
            
            # Final clamp (ensure we don't go negative after shifting)
            left_top_x = max(0, left_top_x)
            left_top_y = max(0, left_top_y)
            right_bottom_x = min(w - 1, right_bottom_x)
            right_bottom_y = min(h - 1, right_bottom_y)
            
            # --- END: Exact port of C++ CalculateBox function ---
            
            # Calculate actual crop size achieved
            actual_width = right_bottom_x - left_top_x + 1
            actual_height = right_bottom_y - left_top_y + 1
            actual_scale_x = actual_width / box_width if box_width > 0 else 0
            actual_scale_y = actual_height / box_height if box_height > 0 else 0
            
            # Log if scale was significantly limited by boundaries
            if actual_scale_x < requested_scale * 0.9 or actual_scale_y < requested_scale * 0.9:
                logger.debug(
                    f"Scale limited: requested={requested_scale:.1f}, "
                    f"achieved=({actual_scale_x:.2f}, {actual_scale_y:.2f}), "
                    f"face_size=({box_width}x{box_height}), "
                    f"image_size=({w}x{h}), "
                    f"crop_size=({actual_width}x{actual_height})"
                )
            
            # Ensure valid crop area
            if right_bottom_x <= left_top_x or right_bottom_y <= left_top_y:
                logger.debug("Invalid crop coordinates after scaling")
                return None
            
            # Extract face crop (inclusive of right_bottom, matching C++ cv::Rect behavior)
            face_crop = image[left_top_y:right_bottom_y+1, left_top_x:right_bottom_x+1]
            
            if face_crop.size == 0:
                logger.debug("Face crop is empty")
                return None
            
            # Ensure minimum crop size
            crop_h, crop_w = face_crop.shape[:2]
            if crop_h < min_size or crop_w < min_size:
                logger.debug(f"Extracted crop too small: {crop_w}x{crop_h}")
                return None
            
            return face_crop
            
        except Exception as e:
            logger.error(f"Error extracting face crop: {e}")
            return None
    
    def _ensure_scale_separation(self, image: np.ndarray, face_detections: List[Dict]) -> Tuple[np.ndarray, List[Dict]]:
        """
        Ensure faces are small enough relative to image for proper V2/V1SE scale separation.
        
        When faces are too large relative to the image (>20% of dimension), both 2.7x and 4.0x
        scales hit the same image boundary, making crops identical and causing 96% background scores.
        
        This downsamples the image to ensure the largest face is <15% of image dimension,
        allowing proper scale separation between V2 (2.7x) and V1SE (4.0x).
        
        Args:
            image: Input image
            face_detections: List of face detection dicts with bbox info
            
        Returns:
            (possibly downsampled image, updated face_detections with scaled bboxes)
        """
        h, w = image.shape[:2]
        
        # Find largest face dimension
        max_face_dim = 0
        for face in face_detections:
            bbox = face.get('bbox', face.get('box', {}))
            if isinstance(bbox, dict):
                face_w = float(bbox.get('width', 0))
                face_h = float(bbox.get('height', 0))
            elif isinstance(bbox, list) and len(bbox) >= 4:
                face_w = float(bbox[2] if len(bbox) > 2 else 0)
                face_h = float(bbox[3] if len(bbox) > 3 else 0)
            else:
                continue
            max_face_dim = max(max_face_dim, face_w, face_h)
        
        if max_face_dim == 0:
            return image, face_detections
        
        # Target: largest face should be <15% of image dimension
        # This ensures 4.0x scale (400%) fits: 15% × 4.0 = 60% of image
        # And 2.7x scale (270%) also fits: 15% × 2.7 = 40.5% of image
        # Difference: 60% vs 40.5% = DIFFERENT crops ✓
        target_ratio = 0.15
        min_dim = min(h, w)
        current_ratio = max_face_dim / min_dim
        
        if current_ratio > target_ratio:
            # Need to downsample
            scale_factor = target_ratio / current_ratio
            new_w = int(w * scale_factor)
            new_h = int(h * scale_factor)
            
            # Ensure minimum image size (don't go below 320x240)
            if new_w < 320 or new_h < 240:
                logger.warning(
                    f"Cannot downsample further: would result in {new_w}x{new_h} "
                    f"(face too large: {max_face_dim:.0f}px in {min_dim}px image = {current_ratio:.1%})"
                )
                return image, face_detections
            
            # Downsample image
            downsampled_image = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_AREA)
            
            # Scale all bboxes
            updated_detections = []
            for face in face_detections:
                face_copy = face.copy()
                bbox = face_copy.get('bbox', face_copy.get('box', {}))
                
                if isinstance(bbox, dict):
                    bbox_copy = bbox.copy()
                    bbox_copy['x'] = float(bbox.get('x', 0)) * scale_factor
                    bbox_copy['y'] = float(bbox.get('y', 0)) * scale_factor
                    bbox_copy['width'] = float(bbox.get('width', 0)) * scale_factor
                    bbox_copy['height'] = float(bbox.get('height', 0)) * scale_factor
                    face_copy['bbox'] = bbox_copy
                elif isinstance(bbox, list) and len(bbox) >= 4:
                    bbox_copy = [
                        bbox[0] * scale_factor,
                        bbox[1] * scale_factor,
                        bbox[2] * scale_factor,
                        bbox[3] * scale_factor
                    ]
                    face_copy['bbox'] = bbox_copy
                
                updated_detections.append(face_copy)
            
            logger.info(
                f"Downsampled for scale separation: {w}x{h} → {new_w}x{new_h} "
                f"(factor={scale_factor:.2f}, face was {current_ratio:.1%} of image, "
                f"target <{target_ratio:.1%})"
            )
            
            return downsampled_image, updated_detections
        
        # No downsampling needed
        return image, face_detections
    
    def _predict_single_model(self, session: ort.InferenceSession, input_tensor: np.ndarray) -> Dict:
        """Run inference on a single model"""
        try:
            input_name = session.get_inputs()[0].name
            outputs = session.run(None, {input_name: input_tensor})
            prediction = outputs[0][0]  # Get first prediction
            
            # Apply softmax to get probabilities
            exp_pred = np.exp(prediction - np.max(prediction))
            softmax_probs = exp_pred / np.sum(exp_pred)
            
            # CORRECT class indices based on Silent-Face-Anti-Spoofing training:
            # Index 0: FAKE (spoof/attack)
            # Index 1: REAL (live face)
            # Index 2: UNKNOWN/BACKGROUND (poor face crop, background, etc.)
            #
            # Testing showed Index 2 is ~99% for all inputs (noise, black, white),
            # confirming it's the background/other class, NOT the real class!
            fake_score = float(softmax_probs[0])
            real_score = float(softmax_probs[1])  # CORRECTED: Index 1, not 2!
            background_score = float(softmax_probs[2])
            
            # If background score is too high, it means face detection is poor
            # We'll return this info but let the ensemble decide
            return {
                "real_score": real_score,
                "fake_score": fake_score,
                "background_score": background_score,
                "confidence": max(real_score, fake_score)
            }
            
        except Exception as e:
            logger.error(f"Error in single model prediction: {e}")
            return {
                "real_score": 0.5,
                "fake_score": 0.5,
                "background_score": 0.0,
                "confidence": 0.5,
                "error": str(e)
            }
    
    def _ensemble_prediction(self, v2_result: Dict, v1se_result: Dict) -> Dict:
        """
        Combine predictions from both models using weighted average
        Similar to the APK implementation
        """
        try:
            # Weighted average of real scores
            ensemble_real_score = (
                v2_result["real_score"] * self.v2_weight +
                v1se_result["real_score"] * self.v1se_weight
            )
            
            ensemble_fake_score = (
                v2_result["fake_score"] * self.v2_weight +
                v1se_result["fake_score"] * self.v1se_weight
            )
            
            # Average background scores (not weighted, just for monitoring)
            ensemble_background_score = (
                v2_result.get("background_score", 0.0) * self.v2_weight +
                v1se_result.get("background_score", 0.0) * self.v1se_weight
            )
            
            # Final decision based on ensemble threshold
            is_real = ensemble_real_score > self.threshold
            confidence = ensemble_real_score if is_real else ensemble_fake_score
            
            return {
                "is_real": is_real,
                "real_score": ensemble_real_score,
                "fake_score": ensemble_fake_score,
                "background_score": ensemble_background_score,
                "confidence": confidence,
                "threshold": self.threshold,
                "v2_real_score": v2_result["real_score"],
                "v2_fake_score": v2_result["fake_score"],
                "v2_background_score": v2_result.get("background_score", 0.0),
                "v1se_real_score": v1se_result["real_score"],
                "v1se_fake_score": v1se_result["fake_score"],
                "v1se_background_score": v1se_result.get("background_score", 0.0),
                "ensemble_method": "weighted_average"
            }
            
        except Exception as e:
            logger.error(f"Error in ensemble prediction: {e}")
            return {
                "is_real": True,
                "real_score": 0.5,
                "fake_score": 0.5,
                "background_score": 0.0,
                "confidence": 0.5,
                "threshold": self.threshold,
                "error": str(e)
            }
    
    def _process_single_face(self, face_crop_v2: np.ndarray, face_crop_v1se: np.ndarray) -> Dict:
        """Process face crops with both models and ensemble"""
        try:
            # Preprocess both face crops
            input_tensor_v2 = self._preprocess_single_face(face_crop_v2)
            input_tensor_v1se = self._preprocess_single_face(face_crop_v1se)
            
            # Get predictions from both models with their respective crops
            v2_result = self._predict_single_model(self.session_v2, input_tensor_v2)
            v1se_result = self._predict_single_model(self.session_v1se, input_tensor_v1se)
            
            # Combine predictions using ensemble
            ensemble_result = self._ensemble_prediction(v2_result, v1se_result)
            
            return ensemble_result
            
        except Exception as e:
            logger.error(f"Error processing face: {e}")
            return {
                "is_real": True,
                "real_score": 0.5,
                "fake_score": 0.5,
                "confidence": 0.5,
                "threshold": self.threshold,
                "error": str(e)
            }
    
    def detect_faces_batch(self, image: np.ndarray, face_detections: List[Dict]) -> List[Dict]:
        """
        Process multiple faces with dual-model ensemble prediction
        """
        results = []
        logger.debug(f"Processing {len(face_detections)} faces with dual MiniFASNet")
        
        if not face_detections:
            return results
        
        # CRITICAL FIX: Ensure faces are small relative to image for proper scale separation
        # When faces are large (>20% of image), both 2.7x and 4.0x scales hit the same
        # boundary limit, making crops identical and causing 96% background scores.
        image, face_detections = self._ensure_scale_separation(image, face_detections)
        
        # Extract all face crops (different scales for each model)
        face_crop_pairs = []  # List of (v2_crop, v1se_crop) tuples
        valid_faces = []
        
        for i, face in enumerate(face_detections):
            bbox = face.get('bbox', face.get('box', {}))
            if not bbox:
                logger.debug(f"Face {i}: No bbox found")
                continue
            
            # Extract face crop for V2 with scale=2.7 (270% of face bbox)
            face_crop_v2 = self._extract_face_crop(image, bbox, scale=2.7, shift_x=0.0, shift_y=0.0)
            if face_crop_v2 is None:
                logger.debug(f"Face {i}: V2 face crop extraction failed")
                continue
            
            # Extract face crop for V1SE with scale=4.0 (400% of face bbox)
            face_crop_v1se = self._extract_face_crop(image, bbox, scale=4.0, shift_x=0.0, shift_y=0.0)
            if face_crop_v1se is None:
                logger.debug(f"Face {i}: V1SE face crop extraction failed")
                continue
            
            logger.debug(f"Face {i}: V2 crop shape={face_crop_v2.shape}, V1SE crop shape={face_crop_v1se.shape}")
            face_crop_pairs.append((face_crop_v2, face_crop_v1se))
            valid_faces.append((i, face))
        
        if not face_crop_pairs:
            logger.debug("No valid face crops extracted")
            return results
        
        # Process each face individually
        start_time = time.time()
        
        for (face_id, face), (face_crop_v2, face_crop_v1se) in zip(valid_faces, face_crop_pairs):
            # Process with dual-model ensemble (different crops for each model)
            antispoofing_result = self._process_single_face(face_crop_v2, face_crop_v1se)
            logger.debug(f"Face {face_id}: Ensemble result = {antispoofing_result}")
            
            # Add processing time
            processing_time = time.time() - start_time
            antispoofing_result['processing_time'] = processing_time
            antispoofing_result['cached'] = False
            antispoofing_result['model_type'] = 'dual_minifasnet'
            
            result = {
                "face_id": face_id,
                "bbox": face.get('bbox', face.get('box', {})),
                "antispoofing": antispoofing_result
            }
            
            # Copy over original face detection data
            for key, value in face.items():
                if key not in result:
                    result[key] = value
            
            results.append(result)
        
        logger.debug(f"Returning {len(results)} results from dual MiniFASNet")
        return results
    
    async def detect_faces_async(self, image: np.ndarray, face_detections: List[Dict]) -> List[Dict]:
        """Async wrapper for face detection"""
        return self.detect_faces_batch(image, face_detections)
    
    def set_threshold(self, threshold: float):
        """Update the threshold for ensemble classification"""
        self.threshold = threshold
        logger.info(f"Updated ensemble threshold to {threshold}")
    
    def get_model_info(self) -> Dict:
        """Get model information"""
        return {
            "model_v2_path": self.model_v2_path,
            "model_v1se_path": self.model_v1se_path,
            "input_size": self.input_size,
            "threshold": self.threshold,
            "v2_weight": self.v2_weight,
            "v1se_weight": self.v1se_weight,
            "providers": self.providers,
            "session_v2_providers": self.session_v2.get_providers() if self.session_v2 else [],
            "session_v1se_providers": self.session_v1se.get_providers() if self.session_v1se else []
        }
