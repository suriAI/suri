"""
YuNet Face Detection Model Implementation
Based on OpenCV Zoo's YuNet implementation
"""

import asyncio
import logging
import time
from typing import List, Dict, Tuple, Optional
import os

import cv2
import numpy as np

logger = logging.getLogger(__name__)

class YuNetDetector:
    """
    YuNet face detection model wrapper with async support
    """
    
    def __init__(
        self,
        model_path: str,
        input_size: List[int] = [320, 320],
        conf_threshold: float = 0.6,
        nms_threshold: float = 0.3,
        top_k: int = 5000,
        backend_id: int = 0,
        target_id: int = 0
    ):
        """
        Initialize YuNet detector
        
        Args:
            model_path: Path to the ONNX model file
            input_size: Input size [width, height]
            conf_threshold: Confidence threshold for detection
            nms_threshold: NMS threshold
            top_k: Maximum number of detections to keep
            backend_id: OpenCV DNN backend ID
            target_id: OpenCV DNN target ID
        """
        self.model_path = model_path
        self.input_size = tuple(input_size)  # [w, h]
        self.conf_threshold = conf_threshold
        self.nms_threshold = nms_threshold
        self.top_k = top_k
        self.backend_id = backend_id
        self.target_id = target_id
        
        # Initialize the model
        self._initialize_model()
        
    def _initialize_model(self):
        """Initialize the OpenCV FaceDetectorYN model"""
        try:
            # Check if model file exists
            if not os.path.exists(self.model_path):
                raise FileNotFoundError(f"Model file not found: {self.model_path}")
            
            # Create FaceDetectorYN instance
            self.model = cv2.FaceDetectorYN.create(
                model=self.model_path,
                config="",
                input_size=self.input_size,
                score_threshold=self.conf_threshold,
                nms_threshold=self.nms_threshold,
                top_k=self.top_k,
                backend_id=self.backend_id,
                target_id=self.target_id
            )
            
            logger.info(f"YuNet model initialized successfully from {self.model_path}")
            
        except Exception as e:
            logger.error(f"Failed to initialize YuNet model: {e}")
            raise
    
    def set_input_size(self, size: Tuple[int, int]):
        """
        Set input size for the model
        
        Args:
            size: (width, height) tuple
        """
        self.input_size = size
        self.model.setInputSize(size)
    
    def set_confidence_threshold(self, threshold: float):
        """Set confidence threshold"""
        self.conf_threshold = threshold
        self.model.setScoreThreshold(threshold)
    
    def set_nms_threshold(self, threshold: float):
        """Set NMS threshold"""
        self.nms_threshold = threshold
        self.model.setNMSThreshold(threshold)
    
    def detect(self, image: np.ndarray) -> List[Dict]:
        """
        Detect faces in an image (synchronous)
        
        Args:
            image: Input image as numpy array (BGR format)
            
        Returns:
            List of detected faces with bounding boxes and landmarks
        """
        try:
            # Set input size based on image dimensions
            h, w = image.shape[:2]
            self.set_input_size((w, h))
            
            # Perform detection
            _, faces = self.model.detect(image)
            
            # Convert results to list of dictionaries
            return self._format_detections(faces)
            
        except Exception as e:
            logger.error(f"Detection error: {e}")
            return []
    
    async def detect_async(self, image: np.ndarray) -> List[Dict]:
        """
        Detect faces in an image (asynchronous)
        
        Args:
            image: Input image as numpy array (BGR format)
            
        Returns:
            List of detected faces with bounding boxes and landmarks
        """
        # Run detection in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.detect, image)
    
    def _format_detections(self, faces: Optional[np.ndarray]) -> List[Dict]:
        """
        Format detection results into structured format
        
        Args:
            faces: Raw detection results from OpenCV
            
        Returns:
            List of formatted face detections
        """
        if faces is None or len(faces) == 0:
            return []
        
        formatted_faces = []
        
        for face in faces:
            # Face format: [x, y, w, h, x_re, y_re, x_le, y_le, x_nt, y_nt, x_rcm, y_rcm, x_lcm, y_lcm, confidence]
            # Where: re=right_eye, le=left_eye, nt=nose_tip, rcm=right_corner_mouth, lcm=left_corner_mouth
            
            face_dict = {
                "bbox": [
                    float(face[0]),  # x
                    float(face[1]),  # y
                    float(face[2]),  # width
                    float(face[3])   # height
                ],
                "landmarks": [
                    [float(face[4]), float(face[5])],   # right_eye
                    [float(face[6]), float(face[7])],   # left_eye
                    [float(face[8]), float(face[9])],   # nose_tip
                    [float(face[10]), float(face[11])], # right_mouth_corner
                    [float(face[12]), float(face[13])]  # left_mouth_corner
                ],
                "confidence": float(face[14])
            }
            
            formatted_faces.append(face_dict)
        
        return formatted_faces
    
    def visualize_detections(
        self,
        image: np.ndarray,
        faces: List[Dict],
        box_color: Tuple[int, int, int] = (0, 255, 0),
        text_color: Tuple[int, int, int] = (0, 0, 255),
        landmark_colors: Optional[List[Tuple[int, int, int]]] = None
    ) -> np.ndarray:
        """
        Visualize detection results on image
        
        Args:
            image: Input image
            faces: List of face detections
            box_color: Color for bounding boxes (BGR)
            text_color: Color for text (BGR)
            landmark_colors: Colors for landmarks (BGR)
            
        Returns:
            Image with visualized detections
        """
        if landmark_colors is None:
            landmark_colors = [
                (255, 0, 0),    # right eye - red
                (0, 0, 255),    # left eye - blue
                (0, 255, 0),    # nose tip - green
                (255, 0, 255),  # right mouth corner - magenta
                (0, 255, 255)   # left mouth corner - cyan
            ]
        
        output = image.copy()
        
        for face in faces:
            bbox = face["bbox"]
            landmarks = face["landmarks"]
            confidence = face["confidence"]
            
            # Draw bounding box
            x, y, w, h = int(bbox["x"]), int(bbox["y"]), int(bbox["width"]), int(bbox["height"])
            cv2.rectangle(output, (x, y), (x + w, y + h), box_color, 2)
            
            # Draw confidence score
            cv2.putText(
                output,
                f"{confidence:.2f}",
                (x, y - 10),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                text_color,
                1
            )
            
            # Draw landmarks
            landmark_points = [
                (landmarks["right_eye"]["x"], landmarks["right_eye"]["y"]),
                (landmarks["left_eye"]["x"], landmarks["left_eye"]["y"]),
                (landmarks["nose_tip"]["x"], landmarks["nose_tip"]["y"]),
                (landmarks["right_mouth_corner"]["x"], landmarks["right_mouth_corner"]["y"]),
                (landmarks["left_mouth_corner"]["x"], landmarks["left_mouth_corner"]["y"])
            ]
            
            for i, (lx, ly) in enumerate(landmark_points):
                color = landmark_colors[i % len(landmark_colors)]
                cv2.circle(output, (int(lx), int(ly)), 2, color, -1)
        
        return output
    
    def get_model_info(self) -> Dict:
        """Get model information"""
        return {
            "model_name": "YuNet",
            "model_path": self.model_path,
            "input_size": self.input_size,
            "conf_threshold": self.conf_threshold,
            "nms_threshold": self.nms_threshold,
            "top_k": self.top_k,
            "backend_id": self.backend_id,
            "target_id": self.target_id
        }