import numpy as np
from typing import Dict


def process_detection(
    face: np.ndarray,
    min_face_size: int,
    landmarks_5: np.ndarray,
) -> Dict:
    x, y, w, h = face[:4]
    conf = float(face[14])

    x1_orig = float(x)
    y1_orig = float(y)
    x2_orig = float(x + w)
    y2_orig = float(y + h)

    face_width_orig = x2_orig - x1_orig
    face_height_orig = y2_orig - y1_orig

    detection = {
        "bbox": {
            "x": x1_orig,
            "y": y1_orig,
            "width": face_width_orig,
            "height": face_height_orig,
        },
        "confidence": conf,
        "landmarks_5": landmarks_5.tolist(),
    }

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
