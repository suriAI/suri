"""
Configuration settings for the face detection backend
"""

import os
import sys
from pathlib import Path
from typing import Dict, Any

def get_weights_dir() -> Path:
    """Get the weights directory path, handling both development and production modes"""
    # Check if running as PyInstaller executable
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        # Production mode - PyInstaller executable
        # Models are bundled in the weights directory relative to the executable
        return Path(sys._MEIPASS) / "weights"
    else:
        # Development mode - use the desktop public weights directory
        base_dir = Path(__file__).parent
        project_root = base_dir.parent
        return project_root / "desktop" / "public" / "weights"

# Base paths
BASE_DIR = Path(__file__).parent
PROJECT_ROOT = BASE_DIR.parent if not getattr(sys, 'frozen', False) else Path(sys._MEIPASS)
WEIGHTS_DIR = get_weights_dir()

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

# Optimized ONNX Runtime Providers (prioritized by performance)
OPTIMIZED_PROVIDERS = [
    # GPU providers (if available) - can provide 5-10x speedup
    ('CUDAExecutionProvider', {
        'device_id': 0,
        'arena_extend_strategy': 'kNextPowerOfTwo',
        'gpu_mem_limit': 2 * 1024 * 1024 * 1024,  # 2GB limit
        'cudnn_conv_algo_search': 'EXHAUSTIVE',
        'do_copy_in_default_stream': True,
    }),
    ('TensorrtExecutionProvider', {
        'device_id': 0,
        'trt_max_workspace_size': 2147483648,  # 2GB
        'trt_fp16_enable': True,
        'trt_engine_cache_enable': True,
    }),
    ('DirectMLExecutionProvider', {
        'device_id': 0,
    }),
    # CPU fallback with optimizations
    ('CPUExecutionProvider', {
        'arena_extend_strategy': 'kSameAsRequested',
        'enable_cpu_mem_arena': True,
        'enable_memory_pattern': True,
    })
]

# Import ONNX Runtime for proper enum values
import onnxruntime as ort

# Optimized ONNX Session Options for maximum performance
OPTIMIZED_SESSION_OPTIONS = {
    "enable_cpu_mem_arena": True,
    "enable_memory_pattern": True,
    "enable_profiling": False,
    "execution_mode": ort.ExecutionMode.ORT_SEQUENTIAL,  # Best for single-threaded inference
    "graph_optimization_level": ort.GraphOptimizationLevel.ORT_ENABLE_ALL,  # Maximum optimization
    "inter_op_num_threads": 0,  # Use all available cores
    "intra_op_num_threads": 0,  # Use all available cores
    "log_severity_level": 3,    # Reduce logging overhead
}

# Model configurations - OPTIMIZED FOR MAXIMUM PERFORMANCE
MODEL_CONFIGS = {
    "yunet": {
        "name": "YuNet",
        "model_path": WEIGHTS_DIR / "face_detection_yunet_2023mar.onnx",
        "input_size": (320, 320),  # Fixed size for consistent performance
        "score_threshold": 0.5,    # Balanced for speed vs accuracy
        "nms_threshold": 0.3,      # Optimized for speed vs accuracy balance
        "top_k": 5000,             # Reduced for faster processing
        "backend_id": 0,  # OpenCV DNN backend
        "target_id": 0,   # CPU target (can be changed to GPU if available)
        "description": "YuNet face detection model from OpenCV Zoo - OPTIMIZED",
        "version": "2023mar",
        "supported_formats": ["jpg", "jpeg", "png", "bmp", "webp"],
        "max_image_size": (1920, 1080),  # Limit max resolution for performance
        "min_face_size": (10, 10),
        "enable_dynamic_sizing": True
    },
    "antispoofing": {
        "name": "AntiSpoofing",
        "model_path": WEIGHTS_DIR / "AntiSpoofing_bin_1.5_128.onnx",
        "input_size": (128, 128),
        "threshold": 0.6,  # More conservative threshold for better accuracy with multiple faces
        "providers": OPTIMIZED_PROVIDERS,  # Use optimized providers
        "session_options": OPTIMIZED_SESSION_OPTIONS,
        "description": "Anti-spoofing model for real vs fake face detection - OPTIMIZED",
        "version": "1.5_128",
        "supported_formats": ["jpg", "jpeg", "png", "bmp", "webp"],
        "margin": 0.2,  # Face crop margin (20%)
        "max_batch_size": 8,  # Increased batch size for better throughput
        "enable_temporal_smoothing": True,  # Enable temporal smoothing to reduce flickering
        "smoothing_factor": 0.3,  # Moderate smoothing for stability
        "hysteresis_margin": 0.15,  # Increased margin for better stability
    },
    "edgeface": {
        "name": "EdgeFace",
        "model_path": WEIGHTS_DIR / "edgeface-recognition.onnx",
        "input_size": (112, 112),  # EdgeFace standard input size
        "similarity_threshold": 0.45,  # Reduced threshold for better movement tolerance
        "providers": OPTIMIZED_PROVIDERS,  # Use optimized providers
        "session_options": OPTIMIZED_SESSION_OPTIONS,
        "description": "EdgeFace recognition model for face identification - OPTIMIZED",
        "version": "production",
        "supported_formats": ["jpg", "jpeg", "png", "bmp", "webp"],
        "embedding_dimension": 512,  # Face embedding dimension
        "database_path": BASE_DIR / "data" / "face_database.db",  # SQLite database storage
        "requires_landmarks": True,  # Requires 5-point landmarks for alignment
        "landmark_count": 5,  # Number of required landmarks
        "batch_size": 4,  # Enable small batch processing
        "enable_face_alignment": True,
        "alignment_method": "similarity_transform",  # Fastest alignment method
        "enable_temporal_smoothing": True,  # Enable temporal smoothing for recognition
        "recognition_smoothing_factor": 0.3,  # Reduced for faster response and better stability
        "recognition_hysteresis_margin": 0.05,  # Reduced for less strict switching
        "min_consecutive_recognitions": 1,  # Reduced to 1 for immediate recognition
    }
}

# API configuration
API_CONFIG = {
    "title": "Face Detection API",
    "description": "High-performance async face detection API with YuNet and other models",
    "version": "1.0.0",
    "docs_url": "/docs",
    "redoc_url": "/redoc",
    "openapi_url": "/openapi.json",
}

# WebSocket configuration
WEBSOCKET_CONFIG = {
    "ping_interval": 30,  # seconds
    "ping_timeout": 10,   # seconds
    "close_timeout": 10,  # seconds
    "max_size": 10 * 1024 * 1024,  # 10MB max message size
    "max_queue": 32,      # Max queued messages
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
    "fps_limit": 15,      # OPTIMIZATION: Reduced from 30 to match frontend processing
    "buffer_size": 3,     # OPTIMIZATION: Reduced from 5 to minimize latency
    "quality": 70,        # OPTIMIZATION: Reduced from 80 for faster processing
    "format": "jpg",      # Stream format
    "timeout": 3.0,       # OPTIMIZATION: Reduced from 5.0 for faster timeout
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
            "level": "DEBUG",
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
            "level": "DEBUG",
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
    
    elif env == "testing":
        config["server"]["port"] = 8700
        config["models"]["yunet"]["score_threshold"] = 0.5
    
    # Override with environment variables
    if os.getenv("SERVER_HOST"):
        config["server"]["host"] = os.getenv("SERVER_HOST")
    
    if os.getenv("SERVER_PORT"):
        config["server"]["port"] = int(os.getenv("SERVER_PORT"))
    
    if os.getenv("MODEL_PATH"):
        config["models"]["yunet"]["model_path"] = Path(os.getenv("MODEL_PATH"))
    
    return config

# Performance Optimization Settings for Maximum YuNet and EdgeFace Performance
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
    "max_image_size": (1920, 1080),  # Limit max resolution
    "resize_interpolation": "INTER_LINEAR",  # Fastest interpolation
    "color_conversion": "BGR2RGB",
    "enable_preprocessing_cache": True,
}

# Frame Processing Optimizations
FRAME_PROCESSING_CONFIG = {
    "target_fps": 30,
    "skip_frame_threshold": 2,  # Process every 2nd frame for 15 FPS effective
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
        model_path = model_config["model_path"]
        if not model_path.exists():
            missing_models.append(f"{model_name}: {model_path}")
    
    if missing_models:
        raise FileNotFoundError(
            f"Missing model files:\n" + "\n".join(missing_models)
        )

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
YUNET_MODEL_PATH = config["models"]["yunet"]["model_path"]
YUNET_CONFIG = config["models"]["yunet"]
ANTISPOOFING_MODEL_PATH = config["models"]["antispoofing"]["model_path"]
ANTISPOOFING_CONFIG = config["models"]["antispoofing"]
EDGEFACE_MODEL_PATH = config["models"]["edgeface"]["model_path"]
EDGEFACE_CONFIG = config["models"]["edgeface"]