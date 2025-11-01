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
            x, y, w, h = face[:4]
            landmarks_5 = face[4:14].reshape(5, 2)
            conf = face[14]
            
            if conf >= self.conf_threshold:
                
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
                
                landmarks_5[:, 0] *= scale_x
                landmarks_5[:, 1] *= scale_y
                
                # Only check face size if min_face_size > 0 (when spoof detection is enabled)
                is_face_too_small = self.min_face_size > 0 and (face_width_orig < self.min_face_size or face_height_orig < self.min_face_size)
                
                detection = {
                    'bbox': {
                        'x': x1_orig,
                        'y': y1_orig,
                        'width': face_width_orig,
                        'height': face_height_orig
                    },
                    'confidence': float(conf)
                }
                
                # Add liveness status for small faces (only if min_face_size > 0)
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
        self.min_face_size = min_size

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
