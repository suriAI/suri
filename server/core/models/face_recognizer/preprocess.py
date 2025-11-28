import cv2
import numpy as np
from typing import List, Tuple


# Reference points for face alignment (112x112 standard)
REFERENCE_POINTS = np.array(
    [
        [38.2946, 51.6963],  # left eye
        [73.5318, 51.5014],  # right eye
        [56.0252, 71.7366],  # nose
        [41.5493, 92.3655],  # left mouth
        [70.7299, 92.2041],  # right mouth
    ],
    dtype=np.float32,
)


def align_face(
    image: np.ndarray, landmarks: np.ndarray, input_size: Tuple[int, int]
) -> np.ndarray:
    """
    Align face using similarity transformation based on 5 landmarks.

    Args:
        image: Input image (BGR format)
        landmarks: 5 facial landmarks as numpy array
        input_size: Target size (width, height) for aligned face

    Returns:
        Aligned face image
    """
    tform, _ = cv2.estimateAffinePartial2D(
        landmarks,
        REFERENCE_POINTS,
        method=cv2.LMEDS,
        maxIters=1,
        refineIters=0,
    )

    if tform is None:
        raise ValueError("Failed to compute similarity transformation matrix")

    aligned_face = cv2.warpAffine(
        image,
        tform,
        input_size,
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )

    return aligned_face


def preprocess_image(
    aligned_face: np.ndarray, input_mean: float = 127.5, input_std: float = 127.5
) -> np.ndarray:
    """
    Preprocess aligned face for model inference.

    Args:
        aligned_face: Aligned face image (BGR format)
        input_mean: Mean value for normalization
        input_std: Standard deviation for normalization

    Returns:
        Preprocessed tensor with shape [C, H, W] (no batch dimension)
    """
    rgb_image = cv2.cvtColor(aligned_face, cv2.COLOR_BGR2RGB)
    normalized = (rgb_image.astype(np.float32) - input_mean) / input_std
    input_tensor = np.transpose(normalized, (2, 0, 1))
    return input_tensor


def align_faces_batch(
    image: np.ndarray, face_data_list: List[dict], input_size: Tuple[int, int]
) -> List[np.ndarray]:
    """
    Align multiple faces from a single image.

    Args:
        image: Input image (BGR format)
        face_data_list: List of face data dicts with 'landmarks_5' key
        input_size: Target size (width, height) for aligned faces

    Returns:
        List of aligned face images
    """
    aligned_faces = []
    for face_data in face_data_list:
        try:
            landmarks_5 = face_data.get("landmarks_5")
            if landmarks_5 is None:
                continue
            landmarks = np.array(landmarks_5, dtype=np.float32)
            
            if landmarks.shape != (5, 2):
                continue
                
            aligned_face = align_face(image, landmarks, input_size)
            aligned_faces.append(aligned_face)
        except Exception:
            continue

    return aligned_faces


def preprocess_batch(
    aligned_faces: List[np.ndarray],
    input_mean: float = 127.5,
    input_std: float = 127.5,
) -> np.ndarray:
    """
    Preprocess multiple aligned faces into a batch tensor.

    Args:
        aligned_faces: List of aligned face images
        input_mean: Mean value for normalization
        input_std: Standard deviation for normalization

    Returns:
        Batch tensor [N, C, H, W] ready for model inference
    """
    if not aligned_faces:
        return np.array([])

    batch_tensors = [
        preprocess_image(face, input_mean, input_std) for face in aligned_faces
    ]
    return np.stack(batch_tensors, axis=0)
