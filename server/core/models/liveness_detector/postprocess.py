import numpy as np
from typing import Dict, List, Tuple, Optional
from .preprocess import preprocess_batch


def softmax(prediction: np.ndarray) -> np.ndarray:
    exp_pred = np.exp(prediction - np.max(prediction, axis=-1, keepdims=True))
    return exp_pred / np.sum(exp_pred, axis=-1, keepdims=True)


def process_prediction(raw_pred: np.ndarray, confidence_threshold: float) -> Dict:
    """Process raw prediction into liveness result."""
    if len(raw_pred) < 3:
        raise ValueError(f"Expected 3-class prediction, got {len(raw_pred)} classes")

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
    detection: Dict
) -> Tuple[bool, Optional[Dict]]:
    if "liveness" in detection and detection["liveness"].get("status") == "too_small":
        return False, None

    bbox = detection.get("bbox", {})
    if not isinstance(bbox, dict):
        return False, None

    w = float(bbox.get("width", 0))
    h = float(bbox.get("height", 0))

    if w <= 0 or h <= 0:
        return False, None

    return True, None


def run_batch_inference(
    face_crops: List[np.ndarray],
    ort_session,
    input_name: str,
    postprocess_fn,
    model_img_size: int,
) -> List[np.ndarray]:
    if not face_crops:
        return []

    if not ort_session:
        raise RuntimeError("ONNX session is not available")

    batch_input = preprocess_batch(face_crops, model_img_size)
    onnx_results = ort_session.run([], {input_name: batch_input})
    logits = onnx_results[0]

    if len(logits.shape) != 2 or logits.shape[1] != 3:
        raise ValueError(
            f"Model output has invalid shape: {logits.shape}, expected [N, 3]"
        )

    if logits.shape[0] != len(face_crops):
        raise ValueError(
            f"Model output batch size mismatch: got {logits.shape[0]} predictions "
            f"for {len(face_crops)} face crops"
        )

    predictions = postprocess_fn(logits)
    raw_predictions = [predictions[i] for i in range(len(face_crops))]

    return raw_predictions


def assemble_liveness_results(
    valid_detections: List[Dict],
    raw_predictions: List[np.ndarray],
    confidence_threshold: float,
    results: List[Dict],
    temporal_smoother=None,
    frame_number: int = 0,
) -> List[Dict]:
    if len(valid_detections) != len(raw_predictions):
        raise ValueError(
            f"Length mismatch: {len(valid_detections)} detections but "
            f"{len(raw_predictions)} predictions. This indicates a bug in the pipeline."
        )

    for detection, raw_pred in zip(valid_detections, raw_predictions):
        prediction = process_prediction(raw_pred, confidence_threshold)

        live_score = prediction["live_score"]
        spoof_score = prediction["spoof_score"]

        if temporal_smoother:
            track_id = detection.get("track_id")
            if track_id is not None and track_id > 0:
                live_score, spoof_score = temporal_smoother.smooth(
                    track_id, live_score, spoof_score, frame_number
                )

        max_confidence = max(live_score, spoof_score)
        is_real = live_score >= confidence_threshold

        detection["liveness"] = {
            "is_real": is_real,
            "live_score": live_score,
            "spoof_score": spoof_score,
            "confidence": max_confidence,
            "status": "live" if is_real else "spoof",
        }

        results.append(detection)

    return results
