import numpy as np
from typing import Dict, List


def softmax(prediction: np.ndarray) -> np.ndarray:
    """Apply softmax to prediction (supports both single and batch predictions)"""
    # Handle both single prediction [1, 3] and batch predictions [N, 3]
    if len(prediction.shape) == 1:
        prediction = prediction.reshape(1, -1)

    # Apply softmax along the last dimension (axis=-1) for each sample
    # Subtract max for numerical stability
    exp_pred = np.exp(prediction - np.max(prediction, axis=-1, keepdims=True))
    return exp_pred / np.sum(exp_pred, axis=-1, keepdims=True)


def deduplicate_detections(face_detections: List[Dict]) -> List[Dict]:
    """Deduplicate face detections based on bounding box and track_id"""
    seen_bboxes = {}
    deduplicated_detections = []

    for detection in face_detections:
        bbox = detection.get("bbox", {})
        if isinstance(bbox, dict):
            bbox_key = (
                bbox.get("x", 0),
                bbox.get("y", 0),
                bbox.get("width", 0),
                bbox.get("height", 0),
            )
        elif isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
            bbox_key = (int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3]))
        else:
            deduplicated_detections.append(detection)
            continue

        track_id = detection.get("track_id", None)
        if track_id is not None:
            if isinstance(track_id, (np.integer, np.int32, np.int64)):
                track_id = int(track_id)

        if bbox_key in seen_bboxes:
            existing_track_id = seen_bboxes[bbox_key].get("track_id", None)
            if existing_track_id is not None:
                if isinstance(existing_track_id, (np.integer, np.int32, np.int64)):
                    existing_track_id = int(existing_track_id)

            if track_id is not None and track_id >= 0:
                if existing_track_id is None or existing_track_id < 0:
                    idx = deduplicated_detections.index(seen_bboxes[bbox_key])
                    deduplicated_detections[idx] = detection
                    seen_bboxes[bbox_key] = detection
        else:
            deduplicated_detections.append(detection)
            seen_bboxes[bbox_key] = detection

    return deduplicated_detections


def process_prediction(
    raw_pred: np.ndarray, confidence_threshold: float, track_id=None
) -> Dict:
    """Process raw prediction into liveness result"""
    if track_id is not None:
        if isinstance(track_id, (np.integer, np.int32, np.int64)):
            track_id = int(track_id)

    live_score = float(raw_pred[0])
    print_score = float(raw_pred[1])
    replay_score = float(raw_pred[2])

    spoof_score = print_score + replay_score
    max_confidence = max(live_score, spoof_score)

    is_real = live_score > spoof_score and live_score >= confidence_threshold

    result = {
        "is_real": bool(is_real),
        "live_score": float(live_score),
        "spoof_score": float(spoof_score),
        "confidence": float(max_confidence),
        "status": "live" if is_real else "spoof",
    }

    return result
