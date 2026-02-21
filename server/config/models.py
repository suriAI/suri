from .paths import MODELS_DIR, DATA_DIR
from .onnx import OPTIMIZED_PROVIDERS, OPTIMIZED_SESSION_OPTIONS

MODEL_CONFIGS = {
    "face_detector": {
        "model_path": MODELS_DIR / "detector.onnx",
        "input_size": (640, 640),
        "score_threshold": 0.8,
        "nms_threshold": 0.3,
        "top_k": 5000,
        "min_face_size": 60,
        "edge_margin": 5,
    },
    "liveness_detector": {
        "model_path": MODELS_DIR / "liveness.onnx",
        "confidence_threshold": 0.6,
        "bbox_inc": 1.5,
        "model_img_size": 128,
        "temporal_alpha": 0.5,
        "enable_temporal_smoothing": True,
    },
    "face_recognizer": {
        "model_path": MODELS_DIR / "recognizer.onnx",
        "input_size": (112, 112),
        "similarity_threshold": 0.5,
        "providers": OPTIMIZED_PROVIDERS,
        "session_options": OPTIMIZED_SESSION_OPTIONS,
        "embedding_dimension": 512,
        "database_path": DATA_DIR / "face_database.db",
    },
    "face_tracker": {
        "model_path": MODELS_DIR / "tracker.onnx",
        "track_thresh": 0.5,
        "match_thresh": 0.8,
        "track_buffer": 30,
        "frame_rate": 30,
    },
}

FACE_DETECTOR_MODEL_PATH = MODEL_CONFIGS["face_detector"]["model_path"]
FACE_DETECTOR_CONFIG = MODEL_CONFIGS["face_detector"]
LIVENESS_DETECTOR_CONFIG = MODEL_CONFIGS["liveness_detector"]
FACE_RECOGNIZER_MODEL_PATH = MODEL_CONFIGS["face_recognizer"]["model_path"]
FACE_RECOGNIZER_CONFIG = MODEL_CONFIGS["face_recognizer"]
FACE_TRACKER_MODEL_PATH = MODEL_CONFIGS["face_tracker"]["model_path"]
FACE_TRACKER_CONFIG = MODEL_CONFIGS["face_tracker"]


def validate_model_paths():
    missing_models = []
    for model_name, model_config in MODEL_CONFIGS.items():
        if "model_path" not in model_config:
            continue
        model_path = model_config["model_path"]
        if not model_path.exists():
            missing_models.append(f"{model_name}: {model_path}")
    if missing_models:
        raise FileNotFoundError("Missing model files:\n" + "\n".join(missing_models))


def validate_directories():
    from .paths import MODELS_DIR, BASE_DIR

    required_dirs = [
        MODELS_DIR,
        BASE_DIR / "core" / "models",
        BASE_DIR / "utils",
    ]
    for directory in required_dirs:
        directory.mkdir(parents=True, exist_ok=True)
