import cv2
import numpy as np
from typing import List, Dict, Tuple, Optional


def preprocess_image(img: np.ndarray, model_img_size: int) -> np.ndarray:
    """
    Preprocess single image for model inference.
    
    Returns:
        np.ndarray: Preprocessed image with shape [3, H, W] (no batch dimension)
    """
    new_size = model_img_size
    old_size = img.shape[:2]

    ratio = float(new_size) / max(old_size)
    scaled_shape = tuple([int(x * ratio) for x in old_size])

    # Use INTER_LANCZOS4 for better upscaling quality (especially for small faces)
    interpolation = cv2.INTER_LANCZOS4 if ratio > 1.0 else cv2.INTER_AREA
    img = cv2.resize(
        img, (scaled_shape[1], scaled_shape[0]), interpolation=interpolation
    )

    delta_w = new_size - scaled_shape[1]
    delta_h = new_size - scaled_shape[0]
    top, bottom = delta_h // 2, delta_h - (delta_h // 2)
    left, right = delta_w // 2, delta_w - (delta_w // 2)

    img = cv2.copyMakeBorder(img, top, bottom, left, right, cv2.BORDER_REFLECT_101)

    # Convert to CHW format and normalize: [H, W, 3] -> [3, H, W]
    img = img.transpose(2, 0, 1).astype(np.float32) / 255.0

    return img


def preprocess_batch(face_crops: List[np.ndarray], model_img_size: int) -> np.ndarray:
    """
    Preprocess multiple face crops into a batch tensor for batch inference.
    
    Args:
        face_crops: List of face crop images (each is [H, W, 3] RGB)
        model_img_size: Target image size for the model
        
    Returns:
        np.ndarray: Batch tensor with shape [N, 3, H, W] where N is the number of faces
    """
    if not face_crops:
        raise ValueError("face_crops list cannot be empty")
    
    preprocessed_images = []
    for face_crop in face_crops:
        preprocessed = preprocess_image(face_crop, model_img_size)
        preprocessed_images.append(preprocessed)
    
    # Stack all preprocessed images into a batch: [N, 3, H, W]
    batch_tensor = np.stack(preprocessed_images, axis=0)
    
    return batch_tensor


def crop_with_margin(img: np.ndarray, bbox: tuple, bbox_inc: float) -> np.ndarray:
    """Crop face with expanded bounding box. Matches hairymax's exact implementation."""
    real_h, real_w = img.shape[:2]
    x, y, w, h = bbox

    w = w - x
    h = h - y

    if w <= 0 or h <= 0:
        raise ValueError(f"Invalid bbox dimensions: w={w}, h={h}")

    max_dim = max(w, h)
    xc = x + w / 2
    yc = y + h / 2

    if xc < -real_w or xc > real_w * 2 or yc < -real_h or yc > real_h * 2:
        raise ValueError(
            f"Bbox center completely outside reasonable bounds: "
            f"center=({xc}, {yc}), image_size=({real_w}, {real_h})"
        )

    x = int(xc - max_dim * bbox_inc / 2)
    y = int(yc - max_dim * bbox_inc / 2)

    x1 = 0 if x < 0 else x
    y1 = 0 if y < 0 else y
    x2 = real_w if x + max_dim * bbox_inc > real_w else x + int(max_dim * bbox_inc)
    y2 = real_h if y + max_dim * bbox_inc > real_h else y + int(max_dim * bbox_inc)

    if x1 >= real_w or y1 >= real_h or x2 <= x1 or y2 <= y1:
        raise ValueError(
            f"Invalid crop region: x1={x1}, y1={y1}, x2={x2}, y2={y2}, "
            f"image_size=({real_w}, {real_h})"
        )

    img = img[y1:y2, x1:x2, :]

    top_pad = y1 - y
    bottom_pad = int(max_dim * bbox_inc - y2 + y)
    left_pad = x1 - x
    right_pad = int(max_dim * bbox_inc) - x2 + x

    max_pad = int(max_dim * bbox_inc * 2)
    if (
        abs(top_pad) > max_pad
        or abs(bottom_pad) > max_pad
        or abs(left_pad) > max_pad
        or abs(right_pad) > max_pad
    ):
        raise ValueError(
            f"Extreme padding values detected: top={top_pad}, bottom={bottom_pad}, "
            f"left={left_pad}, right={right_pad}. This may indicate an error."
        )

    img = cv2.copyMakeBorder(
        img,
        top_pad,
        bottom_pad,
        left_pad,
        right_pad,
        cv2.BORDER_REFLECT_101,
    )

    expected_size = int(max_dim * bbox_inc)
    if img.shape[0] != expected_size or img.shape[1] != expected_size:
        raise ValueError(
            f"Crop size mismatch: expected {expected_size}x{expected_size}, "
            f"got {img.shape[0]}x{img.shape[1]}"
        )

    return img


def extract_bbox_coordinates(detection: Dict) -> Optional[Tuple[int, int, int, int]]:
    """Extract bbox coordinates from detection (expects dict format)."""
    bbox = detection.get("bbox", {})
    if not isinstance(bbox, dict):
        return None

    x = int(bbox.get("x", 0))
    y = int(bbox.get("y", 0))
    w = int(bbox.get("width", 0))
    h = int(bbox.get("height", 0))

    if w <= 0 or h <= 0:
        return None

    return (x, y, w, h)


def extract_face_crops_from_detections(
    rgb_image: np.ndarray,
    detections: List[Dict],
    bbox_inc: float,
    crop_fn,
) -> Tuple[List[np.ndarray], List[Dict], List[Dict]]:
    """
    Extract face crops from detections.

    Returns:
        Tuple of (face_crops, valid_detections, skipped_results)
        - face_crops: List of cropped face images
        - valid_detections: List of detections with valid crops
        - skipped_results: List of detections that were skipped
    """
    face_crops = []
    valid_detections = []
    skipped_results = []

    for detection in detections:
        bbox_coords = extract_bbox_coordinates(detection)
        if bbox_coords is None:
            skipped_results.append(detection)
            continue

        x, y, w, h = bbox_coords

        try:
            face_crop = crop_fn(rgb_image, (x, y, x + w, y + h), bbox_inc)
            if len(face_crop.shape) != 3 or face_crop.shape[2] != 3:
                skipped_results.append(detection)
                continue
            if face_crop.shape[0] != face_crop.shape[1]:
                skipped_results.append(detection)
                continue
        except (ValueError, IndexError):
            skipped_results.append(detection)
            continue
        except Exception:
            skipped_results.append(detection)
            continue

        face_crops.append(face_crop)
        valid_detections.append(detection)

    return face_crops, valid_detections, skipped_results
