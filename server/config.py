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

# Auto-detect and configure GPU/CPU providers
# Automatically enables: NVIDIA GPU (CUDA/TensorRT) > Intel/AMD iGPU (DirectML) > CPU
try:
    import onnxruntime as ort
    
    # Get available providers
    available = ort.get_available_providers()
    providers = []
    gpu_name = "CPU Only"
    
    # Priority 1: NVIDIA CUDA
    if 'CUDAExecutionProvider' in available:
        providers.append(('CUDAExecutionProvider', {
            'device_id': 0,
            'arena_extend_strategy': 'kNextPowerOfTwo',
            'gpu_mem_limit': 2 * 1024 * 1024 * 1024,
        }))
        gpu_name = "NVIDIA GPU (CUDA)"
        if 'TensorrtExecutionProvider' in available:
            providers.append(('TensorrtExecutionProvider', {'device_id': 0}))
            gpu_name = "NVIDIA GPU (CUDA + TensorRT)"
    
    # Priority 2: DirectML (Intel/AMD iGPU)
    elif 'DmlExecutionProvider' in available:
        providers.append(('DmlExecutionProvider', {'device_id': 0}))
        gpu_name = "Intel/AMD iGPU (DirectML)"
    
    # Always add CPU fallback
    providers.append(('CPUExecutionProvider', {
        'arena_extend_strategy': 'kSameAsRequested',
        'enable_cpu_mem_arena': True,
        'enable_memory_pattern': True,
    }))
    
    OPTIMIZED_PROVIDERS = providers
    print(f"GPU Auto-Detection: {gpu_name}")
    
except Exception as e:
    print(f"GPU detection error: {e}")
    OPTIMIZED_PROVIDERS = [
        ('CUDAExecutionProvider', {'device_id': 0}),
        ('DmlExecutionProvider', {'device_id': 0}),
        ('CPUExecutionProvider', {
            'arena_extend_strategy': 'kSameAsRequested',
            'enable_cpu_mem_arena': True,
            'enable_memory_pattern': True,
        })
    ]

# Optimized ONNX Session Options for maximum performance
# 🚀 OPTIMIZED: Thread configuration tuned for face detection workloads
OPTIMIZED_SESSION_OPTIONS = {
    "enable_cpu_mem_arena": True,
    "enable_memory_pattern": True,
    "enable_profiling": False,
    "execution_mode": ort.ExecutionMode.ORT_SEQUENTIAL,  # Best for single-threaded inference
    "graph_optimization_level": ort.GraphOptimizationLevel.ORT_ENABLE_ALL,  # Maximum optimization
    "inter_op_num_threads": 2,  # Reduced from 0 (all cores) to 2 to avoid thread contention
    "intra_op_num_threads": 4,  # Reduced from 0 (all cores) to 4 for parallel ops within a node
    "log_severity_level": 3,    # Reduce logging overhead
}

# Model configurations - OPTIMIZED FOR MAXIMUM PERFORMANCE
MODEL_CONFIGS = {
    "yunet": {
        "name": "YuNet",
        "model_path": WEIGHTS_DIR / "face_detection_yunet_2023mar.onnx",
        "input_size": (320, 320),
        "score_threshold": 0.4,
        "nms_threshold": 0.2,
        "top_k": 100,
        "backend_id": 0,
        "target_id": 0,
        "description": "YuNet face detection",
        "version": "2023mar",
        "supported_formats": ["jpg", "jpeg", "png", "bmp", "webp"],
        "max_image_size": (1920, 1080),
        "min_face_size": (50, 50),
        "enable_dynamic_sizing": True,
        "enable_rotation_correction": False,
        "enable_multi_scale": False
    },
    "antispoofing": {
        "name": "SimpleAntiSpoof",
        "model_path": WEIGHTS_DIR / "AntiSpoofing_print-replay_1.5_128.onnx",
        "threshold": 0.5,
        "bbox_inc": 1.2,
        "model_img_size": 128,
        "description": "Anti-spoofing detector - Matches Face-AntiSpoofing prototype exactly",
        "version": "prototype_accurate_fixed"
    },
    "facemesh": {
        "name": "MediaPipe FaceMesh",
        "model_path": WEIGHTS_DIR / "face_mesh_Nx3x192x192_post.onnx",
        "input_size": (192, 192),  # FaceMesh standard input size
        "score_threshold": 0.5,    # Confidence threshold for landmark detection
        "margin_ratio": 0.25,      # 25% margin for face cropping as recommended by MediaPipe
        "providers": OPTIMIZED_PROVIDERS,  # Use optimized providers
        "session_options": OPTIMIZED_SESSION_OPTIONS,
        "description": "MediaPipe FaceMesh model for 468-point facial landmark detection - OPTIMIZED",
        "version": "PINTO0309_tensorrt",
        "supported_formats": ["jpg", "jpeg", "png", "bmp", "webp"],
        "landmark_count": 468,     # Full 468-point facial mesh
        "output_5_point": True,    # Also outputs 5-point landmarks for EdgeFace compatibility
        "enable_dense_mesh": True, # Enable full 468-point mesh output
        "batch_size": 1,           # Single face processing for accuracy
        "alignment_method": "facemesh_dense",  # Dense mesh alignment method
    },
    "edgeface": {
        "name": "EdgeFace-XS",
        "model_path": WEIGHTS_DIR / "edgeface-recognition-xs.onnx",
        "input_size": (112, 112),  # EdgeFace standard input size
        "similarity_threshold": 0.45,  # Reduced threshold for better movement tolerance
        "providers": OPTIMIZED_PROVIDERS,  # Use optimized providers
        "session_options": OPTIMIZED_SESSION_OPTIONS,
        "description": "EdgeFace-XS Gamma 0.6 - Fast & Accurate Face Recognition - OPTIMIZED",
        "version": "production",
        "supported_formats": ["jpg", "jpeg", "png", "bmp", "webp"],
        "embedding_dimension": 512,  # Face embedding dimension
        "database_path": BASE_DIR / "data" / "face_database.db",  # SQLite database storage
        "requires_landmarks": False,  # Uses FaceMesh alignment instead of external landmarks
        "landmark_count": 0,  # No external landmarks required
        "batch_size": 4,  # Enable small batch processing
        "enable_face_alignment": True,
        "alignment_method": "facemesh_dense",  # Use FaceMesh for high-quality alignment
        "enable_temporal_smoothing": True,  # Enable temporal smoothing for recognition
        "recognition_smoothing_factor": 0.3,  # Reduced for faster response and better stability
        "recognition_hysteresis_margin": 0.05,  # Reduced for less strict switching
        "min_consecutive_recognitions": 1,  # Reduced to 1 for immediate recognition
        "facemesh_alignment": True,  # Enable FaceMesh-based alignment
        "facemesh_model": "facemesh",  # Reference to FaceMesh model config
    },
    "deep_sort": {
        "name": "Deep SORT",
        "max_age": 30,  # Maximum frames to keep track alive without detection
        "n_init": 2,  # 🚀 OPTIMIZED: Reduced from 3 to 2 (faster track confirmation)
        "max_iou_distance": 0.6,  # 🚀 OPTIMIZED: Reduced from 0.7 to 0.6 (stricter motion gating)
        "max_cosine_distance": 0.25,  # 🚀 OPTIMIZED: Reduced from 0.3 to 0.25 (stricter appearance gating)
        "nn_budget": 30,  # 🚀 OPTIMIZED: Reduced from 100 to 30 (faster matching, less memory)
        "description": "Deep SORT tracker - OPTIMIZED: Faster matching with stricter gating",
        "version": "1.0.0",
        "enable_appearance_matching": True,  # Use EdgeFace embeddings for tracking
        "matching_weights": {
            "appearance": 0.7,  # 70% weight on appearance matching
            "motion": 0.3  # 30% weight on IOU/motion matching
        }
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
        # Skip ensemble configs that don't have direct model_path
        if "model_path" not in model_config:
            continue
            
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
ANTISPOOFING_CONFIG = config["models"]["antispoofing"]
EDGEFACE_MODEL_PATH = config["models"]["edgeface"]["model_path"]
EDGEFACE_CONFIG = config["models"]["edgeface"]
DEEP_SORT_CONFIG = config["models"]["deep_sort"]