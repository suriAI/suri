import numpy as np


def clip_landmarks(
    landmarks_5: np.ndarray, img_width: int, img_height: int
) -> np.ndarray:
    """Clip landmarks to image boundaries.

    Vectorized clipping avoids mutating read-only arrays (safer, faster).
    """
    return np.clip(landmarks_5, [0, 0], [img_width - 1, img_height - 1])
