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
        landmarks_5: Clipped landmarks array

    Returns:
        Detection dictionary with bbox, confidence, landmarks, and optional liveness
    """
    x, y, w, h = face[:4]
    conf = float(face[14])

    # Keep float precision until final conversion
    x1_unclipped = float(x)
    y1_unclipped = float(y)
    x2_unclipped = float(x + w)
    y2_unclipped = float(y + h)

    x1_orig = max(0, x1_unclipped)
    y1_orig = max(0, y1_unclipped)
    x2_orig = min(orig_width, x2_unclipped)
    y2_orig = min(orig_height, y2_unclipped)

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
        else:
            # Calculate visibility and edge detection only when needed
            original_width = x2_unclipped - x1_unclipped
            original_height = y2_unclipped - y1_unclipped
            original_area = original_width * original_height
            clipped_area = face_width_orig * face_height_orig
            visibility_ratio = clipped_area / (original_area + 1e-6)

            edge_threshold_x = max(orig_width * 0.05, 10)
            edge_threshold_y = max(orig_height * 0.05, 10)
            is_near_edge = (
                x1_orig < edge_threshold_x
                or y1_orig < edge_threshold_y
                or x2_orig > (orig_width - edge_threshold_x)
                or y2_orig > (orig_height - edge_threshold_y)
            )

            landmarks_near_edge = np.any(
                (landmarks_5[:, 0] < edge_threshold_x)
                | (landmarks_5[:, 1] < edge_threshold_y)
                | (landmarks_5[:, 0] > orig_width - edge_threshold_x)
                | (landmarks_5[:, 1] > orig_height - edge_threshold_y)
            )

            if visibility_ratio < 0.50:
                detection["liveness"] = {
                    "is_real": False,
                    "status": "spoof",
                }
            elif is_near_edge or landmarks_near_edge:
                detection["liveness"] = {
                    "is_real": False,
                    "status": "spoof",
                }

    return detection
