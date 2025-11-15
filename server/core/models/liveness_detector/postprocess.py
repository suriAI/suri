import numpy as np
from typing import Dict, List, Tuple, Optional


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

    is_real = live_score >= confidence_threshold

    result = {
        "is_real": bool(is_real),
        "live_score": float(live_score),
        "spoof_score": float(spoof_score),
        "confidence": float(max_confidence),
        "status": "live" if is_real else "spoof",
    }

    return result


def validate_detection(
    detection: Dict, min_face_size: int
) -> Tuple[bool, Optional[Dict]]:
    """
    Validate detection and check if it meets minimum face size requirement.

    Returns:
        Tuple of (is_valid, liveness_status_dict)
        - is_valid: True if detection should be processed, False if skipped
        - liveness_status_dict: None if valid, or liveness dict if marked as too_small
    """
    # Skip if already marked as too_small
    if "liveness" in detection and detection["liveness"].get("status") == "too_small":
        return False, None

    bbox = detection.get("bbox", {})
    if not bbox:
        return False, None

    # Handle dict format: {"x": x, "y": y, "width": w, "height": h}
    if isinstance(bbox, dict):
        w = int(bbox.get("width", 0))
        h = int(bbox.get("height", 0))
    # Handle list/tuple format: [x, y, width, height]
    elif isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
        w = int(bbox[2])
        h = int(bbox[3])
    else:
        return False, None

    if w <= 0 or h <= 0:
        return False, None

    # Check minimum face size
    if min_face_size > 0:
        if w < min_face_size or h < min_face_size:
            liveness_status = {
                "is_real": False,
                "status": "too_small",
                "live_score": 0.0,
                "spoof_score": 1.0,
                "confidence": 0.0,
            }
            return False, liveness_status

    return True, None


def run_batch_inference(
    face_crops: List[np.ndarray],
    ort_session,
    input_name: str,
    preprocess_fn,
    postprocess_fn,
) -> List[Optional[np.ndarray]]:
    """
    Run inference on face crops (one at a time since model expects batch size 1).

    Returns:
        List of raw predictions (or None for failed predictions)
    """
    if not face_crops:
        return []

    raw_predictions = []
    if not ort_session:
        return [None] * len(face_crops)

    # Process each face individually since model expects batch size 1
    for i, face_crop in enumerate(face_crops):
        try:
            # Preprocess single face crop: [1, C, H, W]
            single_input = preprocess_fn(face_crop)  # Shape: [1, 3, 128, 128]

            # Run inference on single face
            onnx_results = ort_session.run([], {input_name: single_input})
            logits = onnx_results[0]  # Shape: [1, 3]

            # Validate output shape
            if logits.shape[1] != 3:
                raw_predictions.append(None)
                continue

            # Apply postprocessing (softmax)
            prediction = postprocess_fn(logits)  # Shape: [1, 3]
            raw_pred = prediction[0]  # Shape: [3]
            raw_predictions.append(raw_pred)

        except Exception:
            raw_predictions.append(None)

    return raw_predictions


def assemble_liveness_results(
    valid_detections: List[Dict],
    raw_predictions: List[Optional[np.ndarray]],
    confidence_threshold: float,
    results: List[Dict],
) -> List[Dict]:
    """Assemble liveness results from predictions and add to results list."""
    for detection, raw_pred in zip(valid_detections, raw_predictions):
        if raw_pred is None:
            results.append(detection)
            continue

        track_id = detection.get("track_id", None)
        prediction = process_prediction(
            raw_pred, confidence_threshold, track_id=track_id
        )

        detection["liveness"] = {
            "is_real": prediction["is_real"],
            "live_score": prediction["live_score"],
            "spoof_score": prediction["spoof_score"],
            "confidence": prediction["confidence"],
            "status": prediction["status"],
        }
        results.append(detection)

    return results
