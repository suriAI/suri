import numpy as np
from typing import Dict, List, Tuple, Optional


def softmax(prediction: np.ndarray) -> np.ndarray:
    """Apply softmax to prediction"""
    exp_pred = np.exp(prediction - np.max(prediction, axis=-1, keepdims=True))
    return exp_pred / np.sum(exp_pred, axis=-1, keepdims=True)


def deduplicate_detections(face_detections: List[Dict]) -> List[Dict]:
    """Deduplicate face detections based on bounding box.

    Tracker already handles tracking, so we just remove exact bbox duplicates.
    If same bbox appears multiple times, keep the first one.
    """
    seen_bboxes = set()
    deduplicated_detections = []

    for detection in face_detections:
        bbox = detection.get("bbox", {})
        if not isinstance(bbox, dict):
            deduplicated_detections.append(detection)
            continue

        bbox_key = (
            bbox.get("x", 0),
            bbox.get("y", 0),
            bbox.get("width", 0),
            bbox.get("height", 0),
        )

        if bbox_key not in seen_bboxes:
            deduplicated_detections.append(detection)
            seen_bboxes.add(bbox_key)

    return deduplicated_detections


def process_prediction(raw_pred: np.ndarray, confidence_threshold: float) -> Dict:
    """Process raw prediction into liveness result"""
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
    if not isinstance(bbox, dict):
        return False, None

    w = int(bbox.get("width", 0))
    h = int(bbox.get("height", 0))

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
    for face_crop in face_crops:
        try:
            # Preprocess single face crop: [1, C, H, W]
            single_input = preprocess_fn(face_crop)  # Shape: [1, 3, 128, 128]

            # Run inference on single face
            onnx_results = ort_session.run([], {input_name: single_input})
            logits = onnx_results[0]  # Shape: [1, 3]

            # Apply postprocessing (softmax) and extract single prediction
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
            # Fail-safe: Mark as spoofed if prediction fails
            detection["liveness"] = {
                "is_real": False,
                "live_score": 0.0,
                "spoof_score": 1.0,
                "confidence": 0.0,
                "status": "error",
            }
            results.append(detection)
            continue

        prediction = process_prediction(raw_pred, confidence_threshold)

        detection["liveness"] = {
            "is_real": prediction["is_real"],
            "live_score": prediction["live_score"],
            "spoof_score": prediction["spoof_score"],
            "confidence": prediction["confidence"],
            "status": prediction["status"],
        }
        results.append(detection)

    return results
