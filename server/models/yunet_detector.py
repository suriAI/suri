"""
YuNet Face Detector
Simple, effective face detection using OpenCV's YuNet model
Based on the Face-AntiSpoofing prototype implementation
"""

import cv2
import numpy as np
import os
import logging
from typing import List, Dict, Tuple, Optional

logger = logging.getLogger(__name__)

class YuNet:
    def __init__(self,
                 model_path: str = None,
                 input_size: tuple = (320, 320),
                 conf_threshold: float = 0.6,
        nms_threshold: float = 0.3,
        top_k: int = 5000,
                 bbox_expansion: float = 0.3):
        """
        Initialize YuNet face detector
        
        Args:
            model_path: Path to the ONNX model file
            input_size: Input size (width, height) for the model
            conf_threshold: Confidence threshold for face detection
            nms_threshold: Non-maximum suppression threshold
            top_k: Maximum number of faces to detect
            bbox_expansion: Expansion factor for bounding boxes
        """
        self.model_path = model_path
        self.input_size = input_size
        self.conf_threshold = conf_threshold
        self.nms_threshold = nms_threshold
        self.top_k = top_k
        self.bbox_expansion = bbox_expansion
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
            logger.info(f"YuNet detector initialized with model: {self.model_path}")
        except Exception as e:
            logger.error(f"Error initializing YuNet detector: {e}")
            self.detector = None
    
    def detect_faces(self, image: np.ndarray) -> List[dict]:
        """
        Detect faces in image
        OPTIMIZED: Processes BGR image (OpenCV native format)
        
        Args:
            image: Input image (BGR format - OpenCV native)
            
        Returns:
            List of face detection dictionaries with bbox, confidence, and landmarks
        """
        if not self.detector:
            return []
    
        orig_height, orig_width = image.shape[:2]
        
        # OPTIMIZATION: No color conversion - YuNet expects BGR natively
        resized_img = cv2.resize(image, self.input_size)
        
        _, faces = self.detector.detect(resized_img)
        
        if faces is None or len(faces) == 0:
            return []
        
        # Convert detections to our format
        detections = []
        for face in faces:
            if face[4] >= self.conf_threshold:  # confidence check
                # YuNet returns [x, y, w, h, confidence, 10_landmarks]
                x, y, w, h, conf = face[:5]
                
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
                
                if face_width_orig < 50 or face_height_orig < 50:
                    continue
                
                bbox_expansion = self.bbox_expansion
                
                x1_expanded = int((x - w * bbox_expansion) * scale_x)
                y1_expanded = int((y - h * bbox_expansion) * scale_y)
                x2_expanded = int((x + w + w * bbox_expansion) * scale_x)
                y2_expanded = int((y + h + h * bbox_expansion) * scale_y)
                
                x1_expanded = max(0, x1_expanded)
                y1_expanded = max(0, y1_expanded)
                x2_expanded = min(orig_width, x2_expanded)
                y2_expanded = min(orig_height, y2_expanded)
                
                landmarks = []
                if len(face) > 5:
                    landmarks = face[5:15]
                    scaled_landmarks = []
                    for i in range(0, len(landmarks), 2):
                        lx = float(landmarks[i] * scale_x)
                        ly = float(landmarks[i+1] * scale_y)
                        scaled_landmarks.extend([lx, ly])
                    landmarks = scaled_landmarks
                
                normalized_conf = float(conf)
                if normalized_conf > 1.0:
                    normalized_conf = min(1.0, normalized_conf / 3.0)
                
                detection = {
                    'bbox': {
                        'x': x1_expanded,
                        'y': y1_expanded,
                        'width': x2_expanded - x1_expanded,
                        'height': y2_expanded - y1_expanded
                    },
                    'bbox_original': {
                        'x': x1_orig,
                        'y': y1_orig,
                        'width': face_width_orig,
                        'height': face_height_orig
                    },
                    'confidence': normalized_conf,
                    'landmarks': landmarks
                }
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

    def get_model_info(self):
        """Get model information"""
        return {
            "name": "YuNet",
            "model_path": self.model_path,
            "input_size": self.input_size,
            "conf_threshold": self.conf_threshold,
            "nms_threshold": self.nms_threshold,
            "top_k": self.top_k,
            "bbox_expansion": self.bbox_expansion,
            "description": "YuNet face detection model from OpenCV Zoo - SIMPLE",
            "version": "2023mar"
        }

    def detect_and_correct_rotation(self, img: np.ndarray) -> Tuple[np.ndarray, float]:
        """Detect if image is rotated and return corrected image with rotation info - optimized"""
        # First try without rotation
        faces = self.detect_faces(img)
        if len(faces) > 0:
            return img, 0  # No rotation needed
        
        # If no faces detected, try common rotations in order of likelihood
        # Most common rotations first: 90, 270 (portrait), then 180 (upside down)
        best_angle = 0
        best_face_count = 0
        best_img = img.copy()
        
        # Test rotations in order of likelihood: 90, 270, 180
        for angle in [90, 270, 180]:
            # Rotate image
            h, w = img.shape[:2]
            center = (w // 2, h // 2)
            rotation_matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
            test_img = cv2.warpAffine(img, rotation_matrix, (w, h))
            
            # Quick face detection test
            test_faces = self.detect_faces(test_img)
            face_count = len(test_faces)
            
            if face_count > best_face_count:
                best_face_count = face_count
                best_angle = angle
                best_img = test_img
                
                # Early exit if we find faces - no need to test remaining rotations
                if face_count > 0:
                    break
        
        return best_img, best_angle

    def multi_scale_detection(self, img: np.ndarray) -> List[Dict]:
        """Try detection at multiple scales to catch rotated or small faces - optimized version"""
        all_faces = []
        
        # Original scale - use the detector's built-in NMS
        faces = self.detect_faces(img)
        if faces:
            all_faces.extend(faces)
        
        # Only try 2 most effective scales for speed: 0.8x (small faces) and 1.2x (large faces)
        # Removed 1.5x as it's rarely needed and expensive
        for scale in [0.8, 1.2]:
            h, w = img.shape[:2]
            new_h, new_w = int(h * scale), int(w * scale)
            
            # Skip if image becomes too small or too large
            if new_h < 50 or new_w < 50 or new_h > 2000 or new_w > 2000:
                continue
                
            scaled_img = cv2.resize(img, (new_w, new_h))
            faces = self.detect_faces(scaled_img)
            
            if faces:
                # Scale coordinates back to original size
                for face in faces:
                    bbox = face['bbox']
                    face['bbox'] = {
                        'x': int(bbox['x'] / scale),
                        'y': int(bbox['y'] / scale),
                        'width': int(bbox['width'] / scale),
                        'height': int(bbox['height'] / scale)
                    }
                all_faces.extend(faces)
        
        # Apply improved NMS to remove duplicate detections from different scales
        if len(all_faces) > 1:
            all_faces = self._apply_improved_nms(all_faces)
        
        return all_faces

    def _apply_improved_nms(self, faces: List[Dict], iou_threshold: float = 0.3) -> List[Dict]:
        """Apply improved Non-Maximum Suppression to remove duplicate face detections"""
        if len(faces) <= 1:
            return faces
        
        # Convert to format suitable for NMS
        boxes = []
        scores = []
        
        for face in faces:
            bbox = face['bbox']
            x, y, w, h = bbox['x'], bbox['y'], bbox['width'], bbox['height']
            boxes.append([x, y, x + w, y + h])  # Convert to [x1, y1, x2, y2]
            scores.append(face['confidence'])
        
        boxes = np.array(boxes, dtype=np.float32)
        scores = np.array(scores, dtype=np.float32)
        
        # Apply NMS with score threshold 0.0 (we already filtered by confidence in detect_faces)
        keep_indices = cv2.dnn.NMSBoxes(boxes.tolist(), scores.tolist(), 0.0, iou_threshold)
        
        if len(keep_indices) > 0:
            # Flatten the indices if they're nested
            if len(keep_indices.shape) > 1:
                keep_indices = keep_indices.flatten()
            
            # Return only the faces that passed NMS, sorted by confidence
            filtered_faces = [faces[i] for i in keep_indices]
            return sorted(filtered_faces, key=lambda f: f['confidence'], reverse=True)
        else:
            # If NMS removes everything, return the face with highest confidence
            best_face = max(faces, key=lambda f: f['confidence'])
            return [best_face]

    def detect_faces_with_corrections(self, image: np.ndarray, enable_rotation_correction: bool = False, enable_multi_scale: bool = False) -> List[Dict]:
        """Detect faces with smart conditional rotation correction and multi-scale detection"""
        # First, try normal detection for maximum speed
        faces = self.detect_faces(image)
        
        # Only use expensive corrections if no faces found or very few faces
        if len(faces) == 0:
            # No faces detected - try rotation correction first (faster than multi-scale)
            if enable_rotation_correction:
                corrected_img, rotation_angle = self.detect_and_correct_rotation(image)
                if rotation_angle != 0:
                    logger.info(f"Rotation correction applied: angle={rotation_angle}")
                    faces = self.detect_faces(corrected_img)
                    if faces:
                        return faces
            
            # Still no faces - try multi-scale detection (most expensive)
            if enable_multi_scale and len(faces) == 0:
                faces = self.multi_scale_detection(image)
                if faces:
                    logger.info(f"Multi-scale detection: found {len(faces)} faces")
        
        # If we have faces but want to improve detection, use multi-scale sparingly
        elif enable_multi_scale and len(faces) < 2:  # Only if we have very few faces
            # Try multi-scale to catch any missed faces
            multi_scale_faces = self.multi_scale_detection(image)
            if len(multi_scale_faces) > len(faces):
                logger.info(f"Multi-scale improved detection: {len(faces)} -> {len(multi_scale_faces)} faces")
                faces = multi_scale_faces
        
        return faces