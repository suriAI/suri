import numpy as np
import lap


def linear_assignment(cost_matrix: np.ndarray) -> np.ndarray:
    """Solve the linear assignment problem using LAP (optimized LAPJV algorithm)"""
    _, x, y = lap.lapjv(cost_matrix, extend_cost=True)
    return np.array([[y[i], i] for i in x if i >= 0])


def iou_batch(bb_test: np.ndarray, bb_gt: np.ndarray) -> np.ndarray:
    """Compute IOU between two sets of bounding boxes in format [x1, y1, x2, y2]"""
    bb_gt = np.expand_dims(bb_gt, 0)
    bb_test = np.expand_dims(bb_test, 1)

    xx1 = np.maximum(bb_test[..., 0], bb_gt[..., 0])
    yy1 = np.maximum(bb_test[..., 1], bb_gt[..., 1])
    xx2 = np.minimum(bb_test[..., 2], bb_gt[..., 2])
    yy2 = np.minimum(bb_test[..., 3], bb_gt[..., 3])

    w = np.maximum(0.0, xx2 - xx1)
    h = np.maximum(0.0, yy2 - yy1)
    wh = w * h

    area_test = (bb_test[..., 2] - bb_test[..., 0]) * (bb_test[..., 3] - bb_test[..., 1])
    area_gt = (bb_gt[..., 2] - bb_gt[..., 0]) * (bb_gt[..., 3] - bb_gt[..., 1])

    return wh / (area_test + area_gt - wh)


def convert_bbox_to_z(bbox: np.ndarray) -> np.ndarray:
    """Convert bounding box from [x1, y1, x2, y2] to [x, y, s, r] format"""
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = bbox[0] + w / 2.0
    y = bbox[1] + h / 2.0
    s = w * h
    r = w / float(h + 1e-6)
    return np.array([x, y, s, r]).reshape((4, 1))


def convert_x_to_bbox(x: np.ndarray, score: float = None) -> np.ndarray:
    """Convert bounding box from [x, y, s, r] to [x1, y1, x2, y2] format"""
    w = np.sqrt(x[2] * x[3])
    h = x[2] / (w + 1e-6)

    if score is None:
        return np.array(
            [x[0] - w / 2.0, x[1] - h / 2.0, x[0] + w / 2.0, x[1] + h / 2.0]
        ).reshape((1, 4))
    else:
        return np.array(
            [x[0] - w / 2.0, x[1] - h / 2.0, x[0] + w / 2.0, x[1] + h / 2.0, score]
        ).reshape((1, 5))


def cosine_distance(features: np.ndarray, gallery: np.ndarray) -> np.ndarray:
    """Compute cosine distance between features and gallery"""
    features = features / (np.linalg.norm(features, axis=1, keepdims=True) + 1e-6)
    gallery = gallery / (np.linalg.norm(gallery, axis=1, keepdims=True) + 1e-6)
    similarity = np.dot(features, gallery.T)
    return 1.0 - similarity

