"""
Anti-Spoofing Detector
Simple, effective anti-spoofing using ONNX model
Based on the Face-AntiSpoofing prototype implementation
"""

import cv2
import numpy as np
import onnxruntime as ort
import os
import logging
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

class AntiSpoof:
    def __init__(self,
                 model_path: str = None,
                 model_img_size: int = 128):
        """
        Initialize Anti-Spoofing detector
        
        Args:
            model_path: Path to the ONNX model file
            model_img_size: Input image size for the model
        """
        self.model_path = model_path
        self.model_img_size = model_img_size
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
                logger.info(f"AntiSpoof model loaded with providers: {ort_session.get_providers()}")
            except Exception as e:
                logger.error(f"Error loading AntiSpoof model: {e}")
                try:
                    ort_session = ort.InferenceSession(onnx_model_path, 
                                                       providers=['CPUExecutionProvider'])
                    logger.info("AntiSpoof model loaded with CPU provider")
                except Exception as e2:
                    logger.error(f"Failed to load AntiSpoof model with CPU: {e2}")
                    return None, None
            
            if ort_session:
                input_name = ort_session.get_inputs()[0].name
                logger.info(f"AntiSpoof model input name: {input_name}")
        
        return ort_session, input_name

    def preprocessing(self, img: np.ndarray) -> np.ndarray:
        """
        Preprocess image for anti-spoofing model
        OPTIMIZED: Convert BGR to RGB only at model input (not earlier)
        
        Args:
            img: Input image (BGR format from OpenCV)
            
        Returns:
            Preprocessed image tensor (RGB format for ONNX model)
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

    def increased_crop(self, img: np.ndarray, bbox: tuple, bbox_inc: float = 1.2) -> np.ndarray:
        """
        Crop face with increased bounding box for better anti-spoofing accuracy
        Matches Face-AntiSpoofing prototype implementation exactly
        
        Args:
            img: Input image (RGB format)
            bbox: Bounding box (x1, y1, x2, y2)
            bbox_inc: Bounding box expansion factor (default 1.2 from prototype)
            
        Returns:
            Cropped face image in RGB format
        """
        real_h, real_w = img.shape[:2]
        
        x, y, w, h = bbox
        w, h = w - x, h - y
        l = max(w, h)
        
        xc, yc = x + w/2, y + h/2
        x, y = int(xc - l*bbox_inc/2), int(yc - l*bbox_inc/2)
        x1 = 0 if x < 0 else x 
        y1 = 0 if y < 0 else y
        x2 = real_w if x + l*bbox_inc > real_w else x + int(l*bbox_inc)
        y2 = real_h if y + l*bbox_inc > real_h else y + int(l*bbox_inc)
        
        img = img[y1:y2, x1:x2, :]
        img = cv2.copyMakeBorder(img, 
                                 y1-y, int(l*bbox_inc-y2+y), 
                                 x1-x, int(l*bbox_inc)-x2+x, 
                                 cv2.BORDER_CONSTANT, value=[0, 0, 0])
        return img

    def predict(self, imgs: List[np.ndarray]) -> List[Dict]:
        """
        Predict anti-spoofing for list of face images
        OPTIMIZED: Accepts BGR input, converts to RGB in preprocessing
        
        Args:
            imgs: List of face images (BGR format - OpenCV native)
            
        Returns:
            List of prediction results
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
                
                live_score = float(pred[0][0])
                print_score = float(pred[0][1])
                replay_score = float(pred[0][2])
                
                predicted_class = np.argmax(pred[0])
                
                spoof_score = print_score + replay_score
                
                is_real = (predicted_class == 0)
                
                result = {
                    'is_real': bool(is_real),
                    'live_score': float(live_score),
                    'spoof_score': float(spoof_score),
                    'confidence': float(max(live_score, spoof_score)),
                    'label': 'Live' if is_real else 'Spoof',
                    'predicted_class': int(predicted_class),
                    'print_score': float(print_score),
                    'replay_score': float(replay_score)
                }
                results.append(result)
                
            except Exception as e:
                logger.error(f"Error in anti-spoofing prediction: {e}")
                results.append({
                    'is_real': False,
                    'live_score': 0.0,
                    'spoof_score': 1.0,
                    'confidence': 0.0,
                    'label': 'Error',
                    'predicted_class': 1,
                    'print_score': 0.5,
                    'replay_score': 0.5
                })
        
        return results

    def detect_faces(self, image: np.ndarray, face_detections: List[Dict]) -> List[Dict]:
        """
        Process face detections with anti-spoofing
        CRITICAL: Input is already RGB from main.py - NO CONVERSION NEEDED
        
        Args:
            image: Input image (RGB format - already converted in main.py)
            face_detections: List of face detection dictionaries
            
        Returns:
            List of face detections with anti-spoofing results
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
                face_crop = self.increased_crop(image, (x, y, x+w, y+h), bbox_inc=1.2)
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
            if i < len(valid_detections):
                valid_idx = valid_detections.index(detection)
                prediction = predictions[valid_idx]
                
                detection['antispoofing'] = {
                    'is_real': prediction['is_real'],
                    'live_score': prediction['live_score'],
                    'spoof_score': prediction['spoof_score'],
                    'confidence': prediction['confidence'],
                    'label': prediction['label'],
                    'status': 'real' if prediction['is_real'] else 'fake',
                    'predicted_class': prediction['predicted_class'],
                    'print_score': prediction['print_score'],
                    'replay_score': prediction['replay_score']
                }
            else:
                detection['antispoofing'] = {
                    'is_real': False,
                    'live_score': 0.0,
                    'spoof_score': 1.0,
                    'confidence': 0.0,
                    'label': 'Error',
                    'status': 'error',
                    'predicted_class': 1,
                    'print_score': 0.5,
                    'replay_score': 0.5
                }
            
            results.append(detection)
        
        return results

    async def detect_faces_async(self, image, faces):
        """Async wrapper for detect_faces method"""
        return self.detect_faces(image, faces)

    def get_model_info(self):
        """Get model information"""
        return {
            "name": "SimpleAntiSpoof",
            "model_path": self.model_path,
            "model_img_size": self.model_img_size,
            "description": "Simple anti-spoofing detector based on Face-AntiSpoofing prototype",
            "version": "prototype_accurate"
        }
