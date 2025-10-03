"""
MediaPipe FaceMesh Detector Implementation
Provides 468-point facial landmarks with conversion to 5-point landmarks for EdgeFace compatibility
Based on PINTO0309's facemesh_onnx_tensorrt implementation
"""

import logging
import time
from typing import List, Dict, Tuple, Optional, Union, Any
import os

import cv2
import numpy as np
import onnxruntime as ort

logger = logging.getLogger(__name__)

class FaceMeshDetector:
    """
    MediaPipe FaceMesh detector with ONNX runtime support
    Provides 468-point facial landmarks and converts to 5-point landmarks for EdgeFace compatibility
    """
    
    def __init__(
        self,
        model_path: str,
        input_size: Tuple[int, int] = (192, 192),
        providers: Optional[List[str]] = None,
        session_options: Optional[Dict[str, Any]] = None,
        score_threshold: float = 0.5,
        margin_ratio: float = 0.25  # 25% margin as recommended by MediaPipe
    ):
        """
        Initialize FaceMesh detector
        
        Args:
            model_path: Path to the FaceMesh ONNX model file
            input_size: Input size (width, height) - FaceMesh uses 192x192
            providers: ONNX runtime providers
            session_options: ONNX runtime session options for optimization
            score_threshold: Confidence threshold for landmark detection
            margin_ratio: Margin ratio for face cropping (0.25 = 25% margin)
        """
        self.model_path = model_path
        self.input_size = input_size
        self.providers = providers or ['CPUExecutionProvider']
        self.session_options = session_options
        self.score_threshold = score_threshold
        self.margin_ratio = margin_ratio
        
        # Model specifications
        self.INPUT_MEAN = 127.5
        self.INPUT_STD = 127.5
        
        # MediaPipe FaceMesh landmark indices for 5-point conversion
        # Based on MediaPipe's 468-point landmark model
        self.LANDMARK_INDICES = {
            'left_eye': 33,      # Left eye center
            'right_eye': 263,    # Right eye center  
            'nose_tip': 1,       # Nose tip
            'mouth_left': 61,    # Left mouth corner
            'mouth_right': 291   # Right mouth corner
        }
        
        # Alternative landmark indices for better accuracy
        self.LANDMARK_INDICES_ALT = {
            'left_eye': [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
            'right_eye': [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398],
            'nose_tip': [1, 2, 5, 4, 6, 19, 94, 168],
            'mouth_left': [61, 84, 17, 314, 405, 320, 307, 375, 321, 308, 324, 318],
            'mouth_right': [291, 303, 267, 269, 270, 267, 272, 271, 272, 271, 272, 271]
        }
        
        # Model components
        self.session = None
        
        # Initialize model
        self._initialize_model()
        
    def _initialize_model(self):
        """Initialize the ONNX model session"""
        try:
            if not os.path.exists(self.model_path):
                raise FileNotFoundError(f"Model file not found: {self.model_path}")
            
            # Create session options
            sess_options = ort.SessionOptions()
            if self.session_options:
                for key, value in self.session_options.items():
                    if hasattr(sess_options, key):
                        setattr(sess_options, key, value)
            
            # Initialize ONNX Runtime session
            self.session = ort.InferenceSession(
                self.model_path,
                sess_options,
                providers=self.providers
            )
            
            # Get model input/output info
            self.input_names = [input.name for input in self.session.get_inputs()]
            self.output_names = [output.name for output in self.session.get_outputs()]
            
        except Exception as e:
            logger.error(f"Failed to initialize FaceMesh model: {e}")
            raise
    
    def _preprocess_face_crop(self, image: np.ndarray, bbox: List[float]) -> Tuple[np.ndarray, Dict[str, int]]:
        """
        Preprocess face crop for FaceMesh input with margin
        
        Args:
            image: Input image
            bbox: Face bounding box [x1, y1, x2, y2]
            
        Returns:
            Preprocessed image and crop info
        """
        try:
            x1, y1, x2, y2 = bbox
            h, w = image.shape[:2]
            
            # Calculate face dimensions
            face_width = x2 - x1
            face_height = y2 - y1
            
            # Add margin (25% as recommended by MediaPipe)
            margin_x = int(face_width * self.margin_ratio)
            margin_y = int(face_height * self.margin_ratio)
            
            # Calculate crop coordinates with margin
            crop_x1 = max(0, int(x1 - margin_x))
            crop_y1 = max(0, int(y1 - margin_y))
            crop_x2 = min(w, int(x2 + margin_x))
            crop_y2 = min(h, int(y2 + margin_y))
            
            crop_width = crop_x2 - crop_x1
            crop_height = crop_y2 - crop_y1
            
            # Validate crop dimensions
            if crop_width <= 0 or crop_height <= 0:
                raise ValueError(f"Invalid crop dimensions: width={crop_width}, height={crop_height}")
            
            # Crop face region
            face_crop = image[crop_y1:crop_y2, crop_x1:crop_x2]
            
            # Validate face crop is not empty
            if face_crop.size == 0:
                raise ValueError(f"Empty face crop: shape={face_crop.shape}")
            
            # Resize to model input size (192x192) without preserving aspect ratio
            resized_face = cv2.resize(face_crop, self.input_size, interpolation=cv2.INTER_LINEAR)
            
            # Normalize to [0, 1] and convert to CHW format
            normalized = resized_face.astype(np.float32) / 255.0
            input_tensor = np.transpose(normalized, (2, 0, 1))  # HWC to CHW
            input_tensor = np.expand_dims(input_tensor, axis=0)  # Add batch dimension
            
            # Store crop information for coordinate transformation
            crop_info = {
                'crop_x1': crop_x1,
                'crop_y1': crop_y1,
                'crop_width': crop_width,
                'crop_height': crop_height,
                'original_width': w,
                'original_height': h
            }
            
            return input_tensor, crop_info
            
        except Exception as e:
            logger.error(f"Face crop preprocessing failed: {e}")
            raise
    
    def _run_inference(self, input_tensor: np.ndarray, crop_info: Dict[str, int]) -> Tuple[np.ndarray, float]:
        """
        Run FaceMesh inference
        
        Args:
            input_tensor: Preprocessed input tensor
            crop_info: Crop information for coordinate transformation
            
        Returns:
            468-point landmarks and confidence score
        """
        try:
            # Prepare inputs based on model requirements
            if len(self.input_names) == 5:
                # Model with post-processing (face_mesh_Nx3x192x192_post.onnx)
                inputs = {
                    self.input_names[0]: input_tensor,  # input image
                    self.input_names[1]: np.array([[crop_info['crop_x1']]], dtype=np.int32),  # crop_x1
                    self.input_names[2]: np.array([[crop_info['crop_y1']]], dtype=np.int32),  # crop_y1
                    self.input_names[3]: np.array([[crop_info['crop_width']]], dtype=np.int32),  # crop_width
                    self.input_names[4]: np.array([[crop_info['crop_height']]], dtype=np.int32)  # crop_height
                }
            else:
                # Simple model without post-processing
                inputs = {self.input_names[0]: input_tensor}
            
            # Run inference
            outputs = self.session.run(self.output_names, inputs)
            
            if len(outputs) >= 2:
                # Model with score output
                landmarks = outputs[1]  # final_landmarks
                score = outputs[0]      # score
                
                # Extract landmarks and score
                if landmarks.shape[-1] == 3:  # [N, 468, 3] format
                    landmarks_2d = landmarks[0, :, :2]  # Take first batch, X,Y coordinates
                    confidence = float(score[0, 0]) if score.size > 0 else 1.0
                else:
                    landmarks_2d = landmarks[0]  # [N, 468, 2] format
                    confidence = float(score[0, 0]) if score.size > 0 else 1.0
            else:
                # Single output (landmarks only)
                landmarks = outputs[0]
                if landmarks.shape[-1] == 3:
                    landmarks_2d = landmarks[0, :, :2]
                else:
                    landmarks_2d = landmarks[0]
                confidence = 1.0
            
            return landmarks_2d, confidence
            
        except Exception as e:
            logger.error(f"FaceMesh inference failed: {e}")
            raise
    
    def _convert_to_5_point_landmarks(self, landmarks_468: np.ndarray) -> np.ndarray:
        """
        Convert 468-point FaceMesh landmarks to 5-point landmarks for EdgeFace compatibility
        
        Args:
            landmarks_468: 468-point landmarks [468, 2]
            
        Returns:
            5-point landmarks [5, 2] in EdgeFace order: [left_eye, right_eye, nose, mouth_left, mouth_right]
        """
        try:
            # Extract key landmarks using MediaPipe indices
            landmarks_5 = np.zeros((5, 2), dtype=np.float32)
            
            # Method 1: Use single representative points
            landmarks_5[0] = landmarks_468[self.LANDMARK_INDICES['left_eye']]      # Left eye
            landmarks_5[1] = landmarks_468[self.LANDMARK_INDICES['right_eye']]     # Right eye
            landmarks_5[2] = landmarks_468[self.LANDMARK_INDICES['nose_tip']]      # Nose tip
            landmarks_5[3] = landmarks_468[self.LANDMARK_INDICES['mouth_left']]    # Left mouth corner
            landmarks_5[4] = landmarks_468[self.LANDMARK_INDICES['mouth_right']]   # Right mouth corner
            
            # Method 2: Use average of multiple points for better accuracy (optional)
            # This can be enabled for better stability
            use_averaged_landmarks = True
            if use_averaged_landmarks:
                # Left eye center (average of eye landmarks)
                left_eye_points = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
                landmarks_5[0] = np.mean(landmarks_468[left_eye_points], axis=0)
                
                # Right eye center (average of eye landmarks)
                right_eye_points = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]
                landmarks_5[1] = np.mean(landmarks_468[right_eye_points], axis=0)
                
                # Nose tip (average of nose landmarks)
                nose_points = [1, 2, 5, 4, 6, 19, 94, 168]
                landmarks_5[2] = np.mean(landmarks_468[nose_points], axis=0)
                
                # Mouth corners (use specific corner points)
                landmarks_5[3] = landmarks_468[61]   # Left mouth corner
                landmarks_5[4] = landmarks_468[291]  # Right mouth corner
            
            return landmarks_5
            
        except Exception as e:
            logger.error(f"Landmark conversion failed: {e}")
            # Fallback: return center points
            h, w = 192, 192  # Default size
            return np.array([
                [w*0.3, h*0.4],   # Left eye
                [w*0.7, h*0.4],   # Right eye
                [w*0.5, h*0.6],   # Nose
                [w*0.4, h*0.8],   # Left mouth
                [w*0.6, h*0.8]    # Right mouth
            ], dtype=np.float32)
    
    def detect_landmarks(self, image: np.ndarray, bbox: List[float]) -> Dict:
        """
        Detect facial landmarks using FaceMesh
        
        Args:
            image: Input image
            bbox: Face bounding box [x1, y1, x2, y2]
            
        Returns:
            Dictionary containing landmarks and metadata
        """
        try:
            start_time = time.time()
            
            # Preprocess face crop
            input_tensor, crop_info = self._preprocess_face_crop(image, bbox)
            
            # Run inference
            landmarks_468, confidence = self._run_inference(input_tensor, crop_info)
            
            # Convert to 5-point landmarks for EdgeFace compatibility
            landmarks_5 = self._convert_to_5_point_landmarks(landmarks_468)
            
            processing_time = time.time() - start_time
            
            return {
                'success': True,
                'landmarks_468': landmarks_468.tolist(),  # Full 468-point landmarks
                'landmarks_5': landmarks_5.tolist(),      # 5-point landmarks for EdgeFace
                'confidence': confidence,
                'processing_time': processing_time,
                'crop_info': crop_info,
                'landmark_count': 468
            }
            
        except Exception as e:
            logger.error(f"FaceMesh landmark detection failed: {e}")
            return {
                'success': False,
                'error': str(e),
                'landmarks_468': [],
                'landmarks_5': [],
                'confidence': 0.0,
                'processing_time': 0.0,
                'crop_info': {},
                'landmark_count': 0
            }
    
    def get_model_info(self) -> Dict:
        """Get model information"""
        return {
            'name': 'MediaPipe FaceMesh',
            'model_path': self.model_path,
            'input_size': self.input_size,
            'landmark_count': 468,
            'providers': self.session.get_providers() if self.session else [],
            'input_names': self.input_names if hasattr(self, 'input_names') else [],
            'output_names': self.output_names if hasattr(self, 'output_names') else [],
            'score_threshold': self.score_threshold,
            'margin_ratio': self.margin_ratio
        }