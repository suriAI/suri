import os
import sys
from pathlib import Path
from typing import Dict, Any


def get_weights_dir() -> Path:
    """Get the weights directory path, handling both development and production modes"""
    # Check if running as PyInstaller executable
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        # Production mode - PyInstaller executable
        # Models are bundled in the weights directory relative to the executable
        return Path(sys._MEIPASS) / "weights"
    else:
        # Development mode - use the server weights directory
        base_dir = Path(__file__).parent
        return base_dir / "weights"


def get_data_dir() -> Path:
    """Get the data directory path, handling both development and production modes"""
    # Check if running as PyInstaller executable
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        # Production mode - PyInstaller executable
        # Data should be stored next to the executable (user-writable location)
        # sys.executable gives the path to the .exe file
        exe_dir = Path(sys.executable).parent
        data_dir = exe_dir / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        return data_dir
    else:
        # Development mode - use server/data directory
        base_dir = Path(__file__).parent
        data_dir = base_dir / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        return data_dir


# Base paths
BASE_DIR = Path(__file__).parent
PROJECT_ROOT = (
    BASE_DIR.parent if not getattr(sys, "frozen", False) else Path(sys._MEIPASS)
)
WEIGHTS_DIR = get_weights_dir()
DATA_DIR = get_data_dir()

# Server configuration
SERVER_CONFIG = {
    "host": "127.0.0.1",
    "port": 8700,
    "reload": False,  # Disabled to prevent log file reload loops
    "log_level": "info",
    "workers": 1,  # Single worker for development
}

# CORS configuration
CORS_CONFIG = {
    "allow_origins": [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:5173",  # Vite dev server
        "http://127.0.0.1:5173",
    ],
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}

# Auto-detect and configure GPU/CPU providers
# Automatically enables: NVIDIA GPU (CUDA/TensorRT) > Intel/AMD iGPU (DirectML) > CPU
try:
    import onnxruntime as ort

    # Get available providers
    available = ort.get_available_providers()
    providers = []
    gpu_name = "CPU Only"

    # Priority 1: NVIDIA CUDA
    if "CUDAExecutionProvider" in available:
        providers.append(
            (
                "CUDAExecutionProvider",
                {
                    "device_id": 0,
                    "arena_extend_strategy": "kNextPowerOfTwo",
                    "gpu_mem_limit": 2 * 1024 * 1024 * 1024,
                },
            )
        )
        gpu_name = "NVIDIA GPU (CUDA)"
        if "TensorrtExecutionProvider" in available:
            providers.append(("TensorrtExecutionProvider", {"device_id": 0}))
            gpu_name = "NVIDIA GPU (CUDA + TensorRT)"

    # Priority 2: DirectML (Intel/AMD iGPU)
    elif "DmlExecutionProvider" in available:
        providers.append(("DmlExecutionProvider", {"device_id": 0}))
        gpu_name = "Intel/AMD iGPU (DirectML)"

    # Always add CPU fallback
    providers.append(
        (
            "CPUExecutionProvider",
            {
                "arena_extend_strategy": "kSameAsRequested",
                "enable_cpu_mem_arena": True,
                "enable_memory_pattern": True,
            },
        )
    )

    OPTIMIZED_PROVIDERS = providers
    print(f"GPU Auto-Detection: {gpu_name}")

except Exception as e:
    print(f"GPU detection error: {e}")
    OPTIMIZED_PROVIDERS = [
        ("CUDAExecutionProvider", {"device_id": 0}),
        ("DmlExecutionProvider", {"device_id": 0}),
        (
            "CPUExecutionProvider",
            {
                "arena_extend_strategy": "kSameAsRequested",
                "enable_cpu_mem_arena": True,
                "enable_memory_pattern": True,
            },
        ),
    ]

# Optimized ONNX Session Options for maximum performance
# OPTIMIZED: Thread configuration tuned for face detection workloads
OPTIMIZED_SESSION_OPTIONS = {
    "enable_cpu_mem_arena": True,
    "enable_memory_pattern": True,
    "enable_profiling": False,
    "execution_mode": ort.ExecutionMode.ORT_SEQUENTIAL,  # Best for single-threaded inference
    "graph_optimization_level": ort.GraphOptimizationLevel.ORT_ENABLE_ALL,  # Maximum optimization
    "inter_op_num_threads": 0,  # Reduced from 0 (all cores) to 2 to avoid thread contention
    "intra_op_num_threads": 0,  # Reduced from 0 (all cores) to 4 for parallel ops within a node
    "log_severity_level": 3,  # Reduce logging overhead
}

# Model configurations - OPTIMIZED FOR MAXIMUM PERFORMANCE
MODEL_CONFIGS = {
    "face_detector": {
        "model_path": WEIGHTS_DIR / "detector_fast.onnx",
        "input_size": (640, 640),  # Optimized for better distant face detection
        "score_threshold": 0.9,
        "nms_threshold": 0.3,
        "top_k": 5000,
        "min_face_size": 80,  # (IMPORTANT! DO NOT CHANGE) Minimum face size for anti-spoofing compatibility
        "backend_id": 0,
        "target_id": 0,
        "supported_formats": ["jpg", "jpeg", "png", "bmp", "webp"],
    },
    "liveness_detector": {
        "model_path": WEIGHTS_DIR / "antispoof.onnx",
        "confidence_threshold": 0.97,
        "bbox_inc": 1.5,
        "model_img_size": 128,
    },
    "face_recognizer": {
        "model_path": WEIGHTS_DIR / "recognizer_light.onnx",
        "input_size": (112, 112),  # Face recognizer standard input size
        "similarity_threshold": 0.4,
        "providers": OPTIMIZED_PROVIDERS,  # Use optimized providers
        "session_options": OPTIMIZED_SESSION_OPTIONS,
        "supported_formats": ["jpg", "jpeg", "png", "bmp", "webp"],
        "embedding_dimension": 512,  # Face embedding dimension
        "database_path": DATA_DIR
        / "face_database.db",  # SQLite database storage (auto-handles dev/prod)
    },
    "face_tracker": {
        "max_age": 30,  # Maximum frames to keep track alive without detection
        "n_init": 2,  # OPTIMIZED: Reduced from 3 to 2 (faster track confirmation)
        "max_iou_distance": 0.6,  # OPTIMIZED: Reduced from 0.7 to 0.6 (stricter motion gating)
        "max_cosine_distance": 0.25,  # OPTIMIZED: Reduced from 0.3 to 0.25 (stricter appearance gating)
        "nn_budget": 30,  # OPTIMIZED: Reduced from 100 to 30 (faster matching, less memory)
        "matching_weights": {
            "appearance": 0.7,  # 70% weight on appearance matching
            "motion": 0.3,  # 30% weight on IOU/motion matching
        },
    },
}

# API configuration
API_CONFIG = {
    "docs_url": "/docs",
    "redoc_url": "/redoc",
    "openapi_url": "/openapi.json",
}

# WebSocket configuration
WEBSOCKET_CONFIG = {
    "ping_interval": 30,  # seconds
    "ping_timeout": 10,  # seconds
    "close_timeout": 10,  # seconds
    "max_size": 10 * 1024 * 1024,  # 10MB max message size
    "max_queue": 32,  # Max queued messages
    "compression": None,  # Disable compression for better performance
}

# Image processing configuration
IMAGE_CONFIG = {
    "max_file_size": 10 * 1024 * 1024,  # 10MB
    "allowed_formats": ["jpg", "jpeg", "png", "bmp", "webp"],
    "default_quality": 85,  # JPEG quality
    "max_dimensions": (4096, 4096),
    "thumbnail_size": (256, 256),
}

# Streaming configuration
STREAMING_CONFIG = {
    "fps_limit": 15,  # OPTIMIZATION: Reduced from 30 to match frontend processing
    "buffer_size": 3,  # OPTIMIZATION: Reduced from 5 to minimize latency
    "quality": 70,  # OPTIMIZATION: Reduced from 80 for faster processing
    "format": "jpg",  # Stream format
    "timeout": 3.0,  # OPTIMIZATION: Reduced from 5.0 for faster timeout
}

# Logging configuration
LOGGING_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {
            "format": "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        },
        "detailed": {
            "format": "%(asctime)s - %(name)s - %(levelname)s - %(module)s - %(funcName)s - %(message)s",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "level": "INFO",
            "formatter": "default",
            "stream": "ext://sys.stdout",
        },
        "file": {
            "class": "logging.FileHandler",
            "level": "DEBUG",
            "formatter": "detailed",
            "filename": "backend.log",
            "mode": "a",
        },
    },
    "loggers": {
        "": {
            "level": "INFO",
            "handlers": ["console", "file"],
        },
        "uvicorn": {
            "level": "INFO",
            "handlers": ["console"],
            "propagate": False,
        },
        "fastapi": {
            "level": "INFO",
            "handlers": ["console"],
            "propagate": False,
        },
    },
}


# Environment-specific overrides
def get_config() -> Dict[str, Any]:
    """
    Get configuration with environment-specific overrides

    Returns:
        Complete configuration dictionary
    """
    config = {
        "server": SERVER_CONFIG.copy(),
        "cors": CORS_CONFIG.copy(),
        "models": MODEL_CONFIGS.copy(),
        "api": API_CONFIG.copy(),
        "websocket": WEBSOCKET_CONFIG.copy(),
        "image": IMAGE_CONFIG.copy(),
        "streaming": STREAMING_CONFIG.copy(),
        "logging": LOGGING_CONFIG.copy(),
    }

    # Environment overrides
    env = os.getenv("ENVIRONMENT", "development")

    if env == "production":
        config["server"]["reload"] = False
        config["server"]["workers"] = 4
        config["logging"]["handlers"]["console"]["level"] = "WARNING"
    elif env == "development":
        # Development mode: show INFO level logs
        config["server"]["log_level"] = "info"
    elif env == "testing":
        config["server"]["port"] = 8700
        config["models"]["face_detector"]["score_threshold"] = 0.5

    # Override with environment variables
    if os.getenv("SERVER_HOST"):
        config["server"]["host"] = os.getenv("SERVER_HOST")

    if os.getenv("SERVER_PORT"):
        config["server"]["port"] = int(os.getenv("SERVER_PORT"))

    if os.getenv("MODEL_PATH"):
        config["models"]["face_detector"]["model_path"] = Path(os.getenv("MODEL_PATH"))

    return config


# Performance Optimization Settings for Maximum Face Detection and Recognition Performance
PERFORMANCE_CONFIG = {
    "enable_model_warmup": True,
    "warmup_iterations": 5,
    "enable_memory_pooling": True,
    "enable_graph_optimization": True,
    "enable_quantization": False,  # Disable if accuracy is priority
    "enable_tensorrt_fp16": True,  # Enable if TensorRT is available
    "max_concurrent_requests": 4,
    "request_timeout": 30,
}

# Image Processing Optimizations
IMAGE_PROCESSING_CONFIG = {
    "jpeg_quality": 0.8,  # Higher quality than current 0.4
    "enable_image_caching": True,
    "resize_interpolation": "INTER_LINEAR",  # Fastest interpolation
    "color_conversion": "BGR2RGB",
    "enable_preprocessing_cache": True,
}

# Frame Processing Optimizations
FRAME_PROCESSING_CONFIG = {
    "target_fps": 30,
    "enable_frame_buffering": True,
    "buffer_size": 3,
    "enable_async_processing": True,
    "max_processing_queue": 2,
}


# Validation functions
def validate_model_paths():
    """Validate that all model files exist"""
    missing_models = []

    for model_name, model_config in MODEL_CONFIGS.items():
        # Skip ensemble configs that don't have direct model_path
        if "model_path" not in model_config:
            continue

        model_path = model_config["model_path"]
        if not model_path.exists():
            missing_models.append(f"{model_name}: {model_path}")

    if missing_models:
        raise FileNotFoundError("Missing model files:\n" + "\n".join(missing_models))


def validate_directories():
    """Validate that required directories exist"""
    required_dirs = [
        WEIGHTS_DIR,
        BASE_DIR / "models",
        BASE_DIR / "utils",
    ]

    for directory in required_dirs:
        directory.mkdir(parents=True, exist_ok=True)


# Initialize configuration
config = get_config()

# Export commonly used values
HOST = config["server"]["host"]
PORT = config["server"]["port"]
FACE_DETECTOR_MODEL_PATH = config["models"]["face_detector"]["model_path"]
FACE_DETECTOR_CONFIG = config["models"]["face_detector"]
LIVENESS_DETECTOR_CONFIG = config["models"]["liveness_detector"]
FACE_RECOGNIZER_MODEL_PATH = config["models"]["face_recognizer"]["model_path"]
FACE_RECOGNIZER_CONFIG = config["models"]["face_recognizer"]
FACE_TRACKER_CONFIG = config["models"]["face_tracker"]
