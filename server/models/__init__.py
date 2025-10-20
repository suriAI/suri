"""
Face detection models package

Contains implementations of various face detection models.
"""

from .detector import FaceDetector
from .validator import LivenessValidator

__all__ = ["FaceDetector", "LivenessValidator"]