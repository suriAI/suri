import numpy as np
from typing import Dict


def process_detection(
    face: np.ndarray,
    orig_width: int,
    orig_height: int,
    min_face_size: int,
    landmarks_5: np.ndarray,
) -> Dict:
    """Process a single face detection and format output.

    Args:
        face: Raw detection array from FaceDetectorYN
        orig_width: Original image width
        orig_height: Original image height
        min_face_size: Minimum face size threshold
        landmarks_5: Landmarks array (not clipped - clipping handled in frontend)

    Returns:
        Detection dictionary with bbox, confidence, landmarks, and optional liveness
    """
    x, y, w, h = face[:4]
    conf = float(face[14])

    # Keep float precision until final conversion (no clipping - handled in frontend for UI)
    x1_orig = float(x)
    y1_orig = float(y)
    x2_orig = float(x + w)
    y2_orig = float(y + h)

    face_width_orig = x2_orig - x1_orig
    face_height_orig = y2_orig - y1_orig

    # Convert to int at final step to preserve precision
    detection = {
        "bbox": {
            "x": int(x1_orig),
            "y": int(y1_orig),
            "width": int(face_width_orig),
            "height": int(face_height_orig),
        },
        "confidence": conf,
        "landmarks_5": landmarks_5.tolist(),
    }

    # Check liveness detection conditions if enabled
    if min_face_size > 0:
        is_bounding_box_too_small = (
            face_width_orig < min_face_size or face_height_orig < min_face_size
        )

        if is_bounding_box_too_small:
            detection["liveness"] = {
                "is_real": False,
                "status": "too_small",
            }

    return detection
