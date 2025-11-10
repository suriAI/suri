import cv2
import numpy as np


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
