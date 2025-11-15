import cv2
import numpy as np
from typing import List, Dict, Tuple, Optional


def preprocess_image(img: np.ndarray, model_img_size: int) -> np.ndarray:
    """Preprocess image for model inference"""
    new_size = model_img_size
    old_size = img.shape[:2]

    ratio = float(new_size) / max(old_size)
    scaled_shape = tuple([int(x * ratio) for x in old_size])
    img = cv2.resize(img, (scaled_shape[1], scaled_shape[0]))

    delta_w = new_size - scaled_shape[1]
    delta_h = new_size - scaled_shape[0]
    top, bottom = delta_h // 2, delta_h - (delta_h // 2)
    left, right = delta_w // 2, delta_w - (delta_w // 2)

    img = cv2.copyMakeBorder(
        img, top, bottom, left, right, cv2.BORDER_CONSTANT, value=[0, 0, 0]
    )

    img = img.transpose(2, 0, 1).astype(np.float32) / 255.0
    img_batch = np.expand_dims(img, axis=0)
    return img_batch


def crop_with_margin(img: np.ndarray, bbox: tuple, bbox_inc: float) -> np.ndarray:
    """Crop face with expanded bounding box"""
    real_h, real_w = img.shape[:2]
    x, y, w, h = bbox

    w = w - x
    h = h - y
    max_dimension = max(w, h)

    xc = x + w / 2
    yc = y + h / 2

    x = int(xc - max_dimension * bbox_inc / 2)
    y = int(yc - max_dimension * bbox_inc / 2)

    x1 = 0 if x < 0 else x
    y1 = 0 if y < 0 else y
    x2 = (
        real_w
        if x + max_dimension * bbox_inc > real_w
        else x + int(max_dimension * bbox_inc)
    )
    y2 = (
        real_h
        if y + max_dimension * bbox_inc > real_h
        else y + int(max_dimension * bbox_inc)
    )

    img = img[y1:y2, x1:x2, :]

    pad_top = y1 - y
    pad_bottom = int(max_dimension * bbox_inc - y2 + y)
    pad_left = x1 - x
    pad_right = int(max_dimension * bbox_inc - x2 + x)

    img = cv2.copyMakeBorder(
        img,
        pad_top,
        pad_bottom,
        pad_left,
        pad_right,
        cv2.BORDER_CONSTANT,
        value=[0, 0, 0],
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
        except Exception:
            skipped_results.append(detection)
            continue

        face_crops.append(face_crop)
        valid_detections.append(detection)

    return face_crops, valid_detections, skipped_results
