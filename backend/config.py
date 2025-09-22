"""
Configuration settings for the face detection backend
"""

import os
from pathlib import Path
from typing import Dict, Any

# Base paths
BASE_DIR = Path(__file__).parent
PROJECT_ROOT = BASE_DIR.parent
WEIGHTS_DIR = PROJECT_ROOT / "desktop" / "public" / "weights"

# Server configuration
SERVER_CONFIG = {
    "host": "127.0.0.1",
    "port": 8001,
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

# Model configurations
MODEL_CONFIGS = {
    "yunet": {
        "name": "YuNet",
        "model_path": WEIGHTS_DIR / "face_detection_yunet_2023mar.onnx",
        "input_size": (320, 320),  # Default input size
        "score_threshold": 0.8,    # Increased from 0.6 to reduce false positives
        "nms_threshold": 0.4,      # Increased from 0.3 to better suppress overlapping detections
        "top_k": 5000,
        "backend_id": 0,  # OpenCV DNN backend
        "target_id": 0,   # CPU target
        "description": "YuNet face detection model from OpenCV Zoo",
        "version": "2023mar",
        "supported_formats": ["jpg", "jpeg", "png", "bmp", "webp"],
        "max_image_size": (4096, 4096),
        "min_face_size": (10, 10),
    },
    "antispoofing": {
        "name": "AntiSpoofing",
        "model_path": WEIGHTS_DIR / "AntiSpoofing_bin_1.5_128.onnx",
        "input_size": (128, 128),
        "threshold": 0.5,  # Real/fake classification threshold
        "providers": ["CPUExecutionProvider"],  # ONNX runtime providers
        "description": "Anti-spoofing model for real vs fake face detection",
        "version": "1.5_128",
        "supported_formats": ["jpg", "jpeg", "png", "bmp", "webp"],
        "margin": 0.2,  # Face crop margin (20%)
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
    "fps_limit": 30,      # Max FPS for streaming
    "buffer_size": 5,     # Frame buffer size
    "quality": 80,        # Stream quality
    "format": "jpg",      # Stream format
    "timeout": 5.0,       # Processing timeout per frame
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
        config["server"]["port"] = 8001
        config["models"]["yunet"]["score_threshold"] = 0.5
    
    # Override with environment variables
    if os.getenv("SERVER_HOST"):
        config["server"]["host"] = os.getenv("SERVER_HOST")
    
    if os.getenv("SERVER_PORT"):
        config["server"]["port"] = int(os.getenv("SERVER_PORT"))
    
    if os.getenv("MODEL_PATH"):
        config["models"]["yunet"]["model_path"] = Path(os.getenv("MODEL_PATH"))
    
    return config

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