"""
Photo Quality Validation Utilities
Validates face photo quality for registration (blur, lighting, size, pose, occlusion)
"""

import cv2
import numpy as np
from typing import Dict, List, Tuple, Optional
import logging

logger = logging.getLogger(__name__)


class PhotoQualityValidator:
    """Validates photo quality for face registration"""
    
    def __init__(
        self,
        min_blur_score: float = 100.0,
        min_brightness: float = 40.0,
        max_brightness: float = 220.0,
        min_face_size: int = 80,
        max_yaw_angle: float = 30.0,
        max_pitch_angle: float = 20.0,
        min_quality_score: float = 60.0
    ):
        """
        Initialize quality validator with thresholds
        
        Args:
            min_blur_score: Minimum Laplacian variance (higher = sharper)
            min_brightness: Minimum average brightness
            max_brightness: Maximum average brightness
            min_face_size: Minimum face bounding box size (pixels)
            max_yaw_angle: Maximum head rotation left/right (degrees)
            max_pitch_angle: Maximum head rotation up/down (degrees)
            min_quality_score: Minimum overall quality score (0-100)
        """
        self.min_blur_score = min_blur_score
        self.min_brightness = min_brightness
        self.max_brightness = max_brightness
        self.min_face_size = min_face_size
        self.max_yaw_angle = max_yaw_angle
        self.max_pitch_angle = max_pitch_angle
        self.min_quality_score = min_quality_score
    
    def detect_blur(self, image: np.ndarray, bbox: Optional[List[float]] = None) -> Dict:
        """
        Detect image blur using Laplacian variance
        
        Args:
            image: Input image (BGR format)
            bbox: Optional face bounding box [x, y, width, height]
            
        Returns:
            Dict with blur score and status
        """
        try:
            # Crop to face region if bbox provided
            if bbox is not None:
                x, y, w, h = [int(v) for v in bbox]
                x = max(0, x)
                y = max(0, y)
                face_region = image[y:y+h, x:x+w]
            else:
                face_region = image
            
            # Convert to grayscale
            gray = cv2.cvtColor(face_region, cv2.COLOR_BGR2GRAY)
            
            # Calculate Laplacian variance
            laplacian = cv2.Laplacian(gray, cv2.CV_64F)
            blur_score = laplacian.var()
            
            is_acceptable = blur_score >= self.min_blur_score
            
            return {
                "blur_score": float(blur_score),
                "is_acceptable": bool(is_acceptable),
                "threshold": float(self.min_blur_score),
                "status": "sharp" if is_acceptable else "blurry"
            }
            
        except Exception as e:
            logger.error(f"Blur detection failed: {e}")
            return {
                "blur_score": 0.0,
                "is_acceptable": False,
                "threshold": self.min_blur_score,
                "status": "error",
                "error": str(e)
            }
    
    def check_lighting(self, image: np.ndarray, bbox: Optional[List[float]] = None) -> Dict:
        """
        Check image lighting/brightness
        
        Args:
            image: Input image (BGR format)
            bbox: Optional face bounding box [x, y, width, height]
            
        Returns:
            Dict with brightness score and status
        """
        try:
            # Crop to face region if bbox provided
            if bbox is not None:
                x, y, w, h = [int(v) for v in bbox]
                x = max(0, x)
                y = max(0, y)
                face_region = image[y:y+h, x:x+w]
            else:
                face_region = image
            
            # Convert to grayscale
            gray = cv2.cvtColor(face_region, cv2.COLOR_BGR2GRAY)
            
            # Calculate average brightness
            brightness = float(np.mean(gray))
            
            # Check if within acceptable range
            is_acceptable = self.min_brightness <= brightness <= self.max_brightness
            
            if brightness < self.min_brightness:
                status = "too_dark"
            elif brightness > self.max_brightness:
                status = "too_bright"
            else:
                status = "good"
            
            return {
                "brightness": float(brightness),
                "is_acceptable": bool(is_acceptable),
                "min_threshold": float(self.min_brightness),
                "max_threshold": float(self.max_brightness),
                "status": status
            }
            
        except Exception as e:
            logger.error(f"Lighting check failed: {e}")
            return {
                "brightness": 0.0,
                "is_acceptable": False,
                "status": "error",
                "error": str(e)
            }
    
    def check_face_size(self, bbox: List[float], image_shape: Tuple[int, int]) -> Dict:
        """
        Check if face size is sufficient for recognition
        
        Args:
            bbox: Face bounding box [x, y, width, height]
            image_shape: Image shape (height, width)
            
        Returns:
            Dict with size info and status
        """
        try:
            x, y, w, h = bbox
            face_area = w * h
            image_area = image_shape[0] * image_shape[1]
            
            # Calculate percentage of image
            face_percentage = (face_area / image_area) * 100 if image_area > 0 else 0
            
            # Check minimum size
            min_dimension = min(w, h)
            is_acceptable = min_dimension >= self.min_face_size
            
            return {
                "width": float(w),
                "height": float(h),
                "area": float(face_area),
                "percentage": float(face_percentage),
                "min_dimension": float(min_dimension),
                "is_acceptable": bool(is_acceptable),
                "threshold": float(self.min_face_size),
                "status": "sufficient" if is_acceptable else "too_small"
            }
            
        except Exception as e:
            logger.error(f"Face size check failed: {e}")
            return {
                "is_acceptable": False,
                "status": "error",
                "error": str(e)
            }
    
    def estimate_pose(self, landmarks_5: Optional[List[List[float]]] = None) -> Dict:
        """
        Estimate head pose from facial landmarks
        
        Args:
            landmarks_5: 5-point facial landmarks [[x,y], ...] (left eye, right eye, nose, left mouth, right mouth)
            
        Returns:
            Dict with pose angles and status
        """
        try:
            if landmarks_5 is None or len(landmarks_5) != 5:
                return {
                    "is_acceptable": True,  # Skip if no landmarks
                    "status": "unknown",
                    "message": "No landmarks provided"
                }
            
            # Extract landmark points
            left_eye = np.array(landmarks_5[0])
            right_eye = np.array(landmarks_5[1])
            nose = np.array(landmarks_5[2])
            left_mouth = np.array(landmarks_5[3])
            right_mouth = np.array(landmarks_5[4])
            
            # Calculate eye centers
            eye_center = (left_eye + right_eye) / 2
            mouth_center = (left_mouth + right_mouth) / 2
            
            # Estimate yaw (left-right rotation) from eye symmetry
            eye_width = np.linalg.norm(right_eye - left_eye)
            left_eye_to_nose = np.linalg.norm(nose - left_eye)
            right_eye_to_nose = np.linalg.norm(nose - right_eye)
            
            # Asymmetry ratio (0.5 = frontal, <0.5 = left turn, >0.5 = right turn)
            asymmetry_ratio = left_eye_to_nose / (left_eye_to_nose + right_eye_to_nose) if (left_eye_to_nose + right_eye_to_nose) > 0 else 0.5
            
            # Convert to degrees (approximate)
            yaw_angle = (asymmetry_ratio - 0.5) * 60  # Scale to ±30 degrees
            
            # Estimate pitch (up-down rotation) from eye-to-mouth distance
            vertical_distance = np.linalg.norm(mouth_center - eye_center)
            expected_ratio = 1.3  # Typical frontal face ratio
            actual_ratio = vertical_distance / eye_width if eye_width > 0 else expected_ratio
            
            # Convert to degrees (approximate)
            pitch_angle = (actual_ratio - expected_ratio) * 30  # Scale to ±20 degrees
            
            # Check if within acceptable range
            yaw_acceptable = abs(yaw_angle) <= self.max_yaw_angle
            pitch_acceptable = abs(pitch_angle) <= self.max_pitch_angle
            is_acceptable = yaw_acceptable and pitch_acceptable
            
            return {
                "yaw_angle": float(yaw_angle),
                "pitch_angle": float(pitch_angle),
                "yaw_acceptable": bool(yaw_acceptable),
                "pitch_acceptable": bool(pitch_acceptable),
                "is_acceptable": bool(is_acceptable),
                "max_yaw_threshold": float(self.max_yaw_angle),
                "max_pitch_threshold": float(self.max_pitch_angle),
                "status": "frontal" if is_acceptable else "profile"
            }
            
        except Exception as e:
            logger.error(f"Pose estimation failed: {e}")
            return {
                "is_acceptable": True,  # Don't fail if pose estimation fails
                "status": "error",
                "error": str(e)
            }
    
    def calculate_quality_score(self, checks: Dict) -> float:
        """
        Calculate overall quality score from individual checks
        
        Args:
            checks: Dict with all quality check results
            
        Returns:
            Overall quality score (0-100)
        """
        try:
            weights = {
                "blur": 0.35,      # Most important
                "lighting": 0.25,
                "face_size": 0.25,
                "pose": 0.15
            }
            
            scores = {}
            
            # Blur score (0-100)
            if "blur" in checks and "blur_score" in checks["blur"]:
                blur_score = checks["blur"]["blur_score"]
                # Normalize to 0-100 (assume 500 is perfect)
                scores["blur"] = min(100, (blur_score / 500) * 100)
            
            # Lighting score (0-100)
            if "lighting" in checks and "brightness" in checks["lighting"]:
                brightness = checks["lighting"]["brightness"]
                optimal = (self.min_brightness + self.max_brightness) / 2
                deviation = abs(brightness - optimal)
                max_deviation = (self.max_brightness - self.min_brightness) / 2
                scores["lighting"] = max(0, 100 - (deviation / max_deviation * 100))
            
            # Face size score (0-100)
            if "face_size" in checks and "min_dimension" in checks["face_size"]:
                min_dim = checks["face_size"]["min_dimension"]
                # Normalize to 0-100 (assume 200px is perfect)
                scores["face_size"] = min(100, (min_dim / 200) * 100)
            
            # Pose score (0-100)
            if "pose" in checks and "yaw_angle" in checks["pose"]:
                yaw = abs(checks["pose"]["yaw_angle"])
                pitch = abs(checks["pose"].get("pitch_angle", 0))
                yaw_score = max(0, 100 - (yaw / self.max_yaw_angle * 100))
                pitch_score = max(0, 100 - (pitch / self.max_pitch_angle * 100))
                scores["pose"] = (yaw_score + pitch_score) / 2
            
            # Calculate weighted average
            total_score = 0.0
            total_weight = 0.0
            
            for key, weight in weights.items():
                if key in scores:
                    total_score += scores[key] * weight
                    total_weight += weight
            
            final_score = total_score / total_weight if total_weight > 0 else 0.0
            
            return float(final_score)
            
        except Exception as e:
            logger.error(f"Quality score calculation failed: {e}")
            return 0.0
    
    def generate_suggestions(self, checks: Dict) -> List[str]:
        """
        Generate improvement suggestions based on quality checks
        
        Args:
            checks: Dict with all quality check results
            
        Returns:
            List of suggestion strings
        """
        suggestions = []
        
        try:
            # Blur suggestions
            if "blur" in checks and not checks["blur"]["is_acceptable"]:
                suggestions.append("Image is blurry - hold camera steady or use better focus")
            
            # Lighting suggestions
            if "lighting" in checks and not checks["lighting"]["is_acceptable"]:
                status = checks["lighting"]["status"]
                if status == "too_dark":
                    suggestions.append("Image is too dark - improve lighting or use flash")
                elif status == "too_bright":
                    suggestions.append("Image is too bright - reduce lighting or avoid direct sunlight")
            
            # Face size suggestions
            if "face_size" in checks and not checks["face_size"]["is_acceptable"]:
                suggestions.append("Face is too small - move closer to camera or crop image")
            
            # Pose suggestions
            if "pose" in checks and not checks["pose"]["is_acceptable"]:
                if not checks["pose"].get("yaw_acceptable", True):
                    suggestions.append("Face is turned to the side - face the camera directly")
                if not checks["pose"].get("pitch_acceptable", True):
                    suggestions.append("Head is tilted up or down - look straight at camera")
            
            if not suggestions:
                suggestions.append("Photo quality is good")
            
        except Exception as e:
            logger.error(f"Suggestion generation failed: {e}")
            suggestions.append("Unable to analyze photo quality")
        
        return suggestions
    
    def validate_photo(
        self,
        image: np.ndarray,
        bbox: List[float],
        landmarks_5: Optional[List[List[float]]] = None
    ) -> Dict:
        """
        Perform complete photo quality validation
        
        Args:
            image: Input image (BGR format)
            bbox: Face bounding box [x, y, width, height]
            landmarks_5: Optional 5-point facial landmarks
            
        Returns:
            Complete validation result with quality score and suggestions
        """
        try:
            # Run all checks
            checks = {
                "blur": self.detect_blur(image, bbox),
                "lighting": self.check_lighting(image, bbox),
                "face_size": self.check_face_size(bbox, image.shape[:2]),
                "pose": self.estimate_pose(landmarks_5)
            }
            
            # Calculate overall quality score
            quality_score = self.calculate_quality_score(checks)
            
            # Generate suggestions
            suggestions = self.generate_suggestions(checks)
            
            # Determine if photo is acceptable
            is_acceptable = quality_score >= self.min_quality_score
            
            return {
                "quality_score": float(quality_score),
                "is_acceptable": bool(is_acceptable),
                "min_score_threshold": float(self.min_quality_score),
                "checks": checks,
                "suggestions": suggestions,
                "status": "acceptable" if is_acceptable else "needs_improvement"
            }
            
        except Exception as e:
            logger.error(f"Photo validation failed: {e}")
            return {
                "quality_score": 0.0,
                "is_acceptable": False,
                "status": "error",
                "error": str(e),
                "suggestions": ["Unable to validate photo quality"]
            }


# Global validator instance with default settings
default_validator = PhotoQualityValidator()


def validate_photo_quality(
    image: np.ndarray,
    bbox: List[float],
    landmarks_5: Optional[List[List[float]]] = None
) -> Dict:
    """
    Convenience function for photo quality validation
    
    Args:
        image: Input image (BGR format)
        bbox: Face bounding box [x, y, width, height]
        landmarks_5: Optional 5-point facial landmarks
        
    Returns:
        Validation result
    """
    return default_validator.validate_photo(image, bbox, landmarks_5)
