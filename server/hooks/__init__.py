"""
Hooks package for request processing pipelines
"""

from .face_processing import (
    process_liveness_detection,
    process_face_tracking,
    set_model_references,
)

__all__ = [
    "process_liveness_detection",
    "process_face_tracking",
    "set_model_references",
]