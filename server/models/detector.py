import cv2
import numpy as np
import os
import logging
from typing import List

logger = logging.getLogger(__name__)

class FaceDetector:
    def __init__(self,
                 model_path: str,
                 input_size: tuple,
                 conf_threshold: float,
                 nms_threshold: float,
                 top_k: int,
                 min_face_size: int = 80):

        self.model_path = model_path
        self.input_size = input_size
        self.conf_threshold = conf_threshold
        self.nms_threshold = nms_threshold
        self.top_k = top_k
        self.min_face_size = min_face_size  # Minimum face size for liveness detection compatibility
        self.detector = None
        
        if model_path and os.path.isfile(model_path):
            self._init_detector()

    def _init_detector(self):
        """Initialize the OpenCV FaceDetectorYN"""
        try:
            self.detector = cv2.FaceDetectorYN.create(
                self.model_path,
                "",
                self.input_size,
                self.conf_threshold,
                self.nms_threshold,
                self.top_k
            )
        except Exception as e:
            logger.error(f"Error initializing face detector: {e}")
            self.detector = None
    
    def detect_faces(self, image: np.ndarray) -> List[dict]:
        """
        Detect faces in image
        OPTIMIZED: Processes BGR image (OpenCV native format)
        
        Args:
            image: Input image (BGR format - OpenCV native)
            
        Returns:
            List of face detection dictionaries with bbox and confidence
        """
        if not self.detector:
            return []
        
        # Early exit for invalid images
        if image is None or image.size == 0:
            logger.warning("Invalid image provided to face detector")
            return []
    
        orig_height, orig_width = image.shape[:2]
        
        # OPTIMIZATION: No color conversion - face detector expects BGR natively
        resized_img = cv2.resize(image, self.input_size)
        
        _, faces = self.detector.detect(resized_img)
        
        if faces is None or len(faces) == 0:
            return []
        
        # Convert detections to our format
        detections = []
        for face in faces:
            # Face detector official format: [x, y, w, h, landmarks..., confidence]
            # Extract bbox
            x, y, w, h = face[:4]
            
            # Extract landmarks (indices 4:14)
            landmarks_5 = None
            if len(face) >= 15:
                landmarks_resized = face[4:14].reshape(5, 2)  # Official format!
                
            # Extract confidence (last element)
            conf = face[14] if len(face) >= 15 else 0.0
            
            # Confidence check
            if conf >= self.conf_threshold:
                
                # Scale coordinates from resized image back to original image
                scale_x = orig_width / self.input_size[0]
                scale_y = orig_height / self.input_size[1]
                
                x1_orig = int(x * scale_x)
                y1_orig = int(y * scale_y)
                x2_orig = int((x + w) * scale_x)
                y2_orig = int((y + h) * scale_y)
                
                x1_orig = max(0, x1_orig)
                y1_orig = max(0, y1_orig)
                x2_orig = min(orig_width, x2_orig)
                y2_orig = min(orig_height, y2_orig)
                
                face_width_orig = x2_orig - x1_orig
                face_height_orig = y2_orig - y1_orig
                
                # Scale landmarks to original image coordinates
                if len(face) >= 15:
                    landmarks_5 = landmarks_resized.copy()
                    landmarks_5[:, 0] *= scale_x  # Scale X coordinates
                    landmarks_5[:, 1] *= scale_y  # Scale Y coordinates
                
                # 🎯 LIVENESS DETECTION SIZE FILTER: Ensure face meets minimum size for liveness detection
                # Liveness detection model was trained with 1.5x expanded bboxes resized to 128x128
                # Minimum face size of 80px ensures adequate texture density after 1.5x expansion
                is_face_too_small = face_width_orig < self.min_face_size or face_height_orig < self.min_face_size
                
                # 🚀 OPTIMIZATION: Remove bbox expansion here
                # Anti-spoofing already handles bbox expansion with its bbox_inc parameter (1.2)
                # This eliminates redundant expansion that was applied TWICE (30% perf loss)
                
                
                # Confidence is already normalized (0.0 - 1.0)
                normalized_conf = float(conf)
                
                # 🚀 OPTIMIZATION: Use original bbox as primary (no expansion)
                # This removes redundant bbox expansion that was causing 30% performance loss
                detection = {
                    'bbox': {
                        'x': x1_orig,
                        'y': y1_orig,
                        'width': face_width_orig,
                        'height': face_height_orig
                    },
                    'bbox_original': {
                        'x': x1_orig,
                        'y': y1_orig,
                        'width': face_width_orig,
                        'height': face_height_orig
                    },
                    'confidence': normalized_conf
                }
                
                # Add liveness status for small faces
                if is_face_too_small:
                    detection['liveness'] = {
                        'is_real': False,
                        'status': 'insufficient_quality',
                        'decision_reason': f'Face too small ({face_width_orig}x{face_height_orig}px) for reliable liveness detection (minimum: {self.min_face_size}px)',
                        'quality_check_failed': True,
                        'live_score': 0.0,
                        'spoof_score': 1.0,
                        'confidence': 0.0
                    }
                
                # Add landmarks if available
                if landmarks_5 is not None:
                    detection['landmarks_5'] = landmarks_5.tolist()
                
                detections.append(detection)
        
        return detections

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
        if min_size < 32:
            logger.warning(f"Very small minimum face size ({min_size}px) may impact liveness detection accuracy")
        elif min_size > 200:
            logger.warning(f"Large minimum face size ({min_size}px) may reject too many valid faces")
        
        self.min_face_size = min_size
        # Minimum face size updated for liveness detection compatibility

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
            "size_filter_description": f"Faces smaller than {self.min_face_size}px are filtered for liveness detection model compatibility"
        }
