"""
Image utility functions for the face detection API
"""

import base64
import io
from typing import Union, Tuple

import cv2
import numpy as np
from PIL import Image

def decode_base64_image(base64_string: str) -> np.ndarray:
    """
    Decode base64 string to OpenCV image
    
    Args:
        base64_string: Base64 encoded image string
        
    Returns:
        OpenCV image as numpy array (BGR format)
    """
    try:
        # Remove data URL prefix if present
        if base64_string.startswith('data:image'):
            base64_string = base64_string.split(',')[1]
        
        # Decode base64
        image_data = base64.b64decode(base64_string)
        
        # Convert to numpy array
        nparr = np.frombuffer(image_data, np.uint8)
        
        # Decode image
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if image is None:
            raise ValueError("Failed to decode image")
        
        return image
        
    except Exception as e:
        raise ValueError(f"Failed to decode base64 image: {e}")

def encode_image_to_base64(image: np.ndarray, format: str = 'jpg') -> str:
    """
    Encode OpenCV image to base64 string
    
    Args:
        image: OpenCV image as numpy array
        format: Image format ('jpg', 'png', etc.)
        
    Returns:
        Base64 encoded image string
    """
    try:
        # Encode image
        _, buffer = cv2.imencode(f'.{format}', image)
        
        # Convert to base64
        image_base64 = base64.b64encode(buffer).decode('utf-8')
        
        return image_base64
        
    except Exception as e:
        raise ValueError(f"Failed to encode image to base64: {e}")

def resize_image(
    image: np.ndarray,
    target_size: Tuple[int, int],
    maintain_aspect_ratio: bool = True,
    interpolation: int = cv2.INTER_LINEAR
) -> np.ndarray:
    """
    Resize image to target size
    
    Args:
        image: Input image
        target_size: Target size as (width, height)
        maintain_aspect_ratio: Whether to maintain aspect ratio
        interpolation: Interpolation method
        
    Returns:
        Resized image
    """
    h, w = image.shape[:2]
    target_w, target_h = target_size
    
    if maintain_aspect_ratio:
        # Calculate scaling factor
        scale = min(target_w / w, target_h / h)
        new_w = int(w * scale)
        new_h = int(h * scale)
        
        # Resize image
        resized = cv2.resize(image, (new_w, new_h), interpolation=interpolation)
        
        # Create padded image
        padded = np.zeros((target_h, target_w, image.shape[2]), dtype=image.dtype)
        
        # Calculate padding
        pad_x = (target_w - new_w) // 2
        pad_y = (target_h - new_h) // 2
        
        # Place resized image in center
        padded[pad_y:pad_y + new_h, pad_x:pad_x + new_w] = resized
        
        return padded
    else:
        return cv2.resize(image, target_size, interpolation=interpolation)

def normalize_image(image: np.ndarray, mean: Tuple[float, float, float] = (0.485, 0.456, 0.406),
                   std: Tuple[float, float, float] = (0.229, 0.224, 0.225)) -> np.ndarray:
    """
    Normalize image with mean and standard deviation
    
    Args:
        image: Input image (0-255 range)
        mean: Mean values for normalization
        std: Standard deviation values for normalization
        
    Returns:
        Normalized image
    """
    # Convert to float and normalize to 0-1
    image = image.astype(np.float32) / 255.0
    
    # Apply normalization
    mean = np.array(mean, dtype=np.float32)
    std = np.array(std, dtype=np.float32)
    
    image = (image - mean) / std
    
    return image

def convert_color_space(image: np.ndarray, conversion: int) -> np.ndarray:
    """
    Convert image color space
    
    Args:
        image: Input image
        conversion: OpenCV color conversion code
        
    Returns:
        Converted image
    """
    return cv2.cvtColor(image, conversion)

def validate_image(image: np.ndarray) -> bool:
    """
    Validate if image is valid
    
    Args:
        image: Input image
        
    Returns:
        True if valid, False otherwise
    """
    if image is None:
        return False
    
    if len(image.shape) not in [2, 3]:
        return False
    
    if image.shape[0] == 0 or image.shape[1] == 0:
        return False
    
    return True

def crop_face(image: np.ndarray, bbox: dict, padding: float = 0.2) -> np.ndarray:
    """
    Crop face from image with padding
    
    Args:
        image: Input image
        bbox: Bounding box dictionary with x, y, width, height
        padding: Padding factor (0.2 = 20% padding)
        
    Returns:
        Cropped face image
    """
    h, w = image.shape[:2]
    
    x = int(bbox['x'])
    y = int(bbox['y'])
    face_w = int(bbox['width'])
    face_h = int(bbox['height'])
    
    # Calculate padding
    pad_w = int(face_w * padding)
    pad_h = int(face_h * padding)
    
    # Calculate crop coordinates with padding
    x1 = max(0, x - pad_w)
    y1 = max(0, y - pad_h)
    x2 = min(w, x + face_w + pad_w)
    y2 = min(h, y + face_h + pad_h)
    
    # Crop face
    face_crop = image[y1:y2, x1:x2]
    
    return face_crop

def draw_detection_info(
    image: np.ndarray,
    faces: list,
    fps: float = None,
    model_name: str = None
) -> np.ndarray:
    """
    Draw detection information on image
    
    Args:
        image: Input image
        faces: List of detected faces
        fps: FPS value to display
        model_name: Model name to display
        
    Returns:
        Image with drawn information
    """
    output = image.copy()
    
    # Draw FPS
    if fps is not None:
        cv2.putText(
            output,
            f'FPS: {fps:.1f}',
            (10, 30),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (0, 255, 0),
            2
        )
    
    # Draw model name
    if model_name is not None:
        cv2.putText(
            output,
            f'Model: {model_name}',
            (10, 60),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (0, 255, 0),
            2
        )
    
    # Draw face count
    cv2.putText(
        output,
        f'Faces: {len(faces)}',
        (10, 90),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (0, 255, 0),
        2
    )
    
    return output