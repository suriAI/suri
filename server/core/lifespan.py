import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from config.models import (
    FACE_DETECTOR_CONFIG,
    FACE_DETECTOR_MODEL_PATH,
    FACE_RECOGNIZER_CONFIG,
    FACE_RECOGNIZER_MODEL_PATH,
    LIVENESS_DETECTOR_CONFIG,
)
from core.models import (
    LivenessDetector,
    FaceDetector,
    FaceRecognizer,
)
from hooks import set_model_references

if not logging.getLogger().handlers:
    logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize global variables
face_detector = None
liveness_detector = None
face_recognizer = None
face_recognizer = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global face_detector, liveness_detector, face_recognizer

    try:
        logger.info("Starting up backend server...")

        face_detector = FaceDetector(
            model_path=str(FACE_DETECTOR_MODEL_PATH),
            input_size=FACE_DETECTOR_CONFIG["input_size"],
            conf_threshold=FACE_DETECTOR_CONFIG["score_threshold"],
            nms_threshold=FACE_DETECTOR_CONFIG["nms_threshold"],
            top_k=FACE_DETECTOR_CONFIG["top_k"],
            min_face_size=FACE_DETECTOR_CONFIG["min_face_size"],
            edge_margin=FACE_DETECTOR_CONFIG["edge_margin"],
        )

        liveness_detector = LivenessDetector(
            model_path=str(LIVENESS_DETECTOR_CONFIG["model_path"]),
            model_img_size=LIVENESS_DETECTOR_CONFIG["model_img_size"],
            confidence_threshold=LIVENESS_DETECTOR_CONFIG["confidence_threshold"],
            bbox_inc=LIVENESS_DETECTOR_CONFIG["bbox_inc"],
            temporal_alpha=LIVENESS_DETECTOR_CONFIG[
                "temporal_alpha"
            ],  # Use config value directly
            enable_temporal_smoothing=LIVENESS_DETECTOR_CONFIG[
                "enable_temporal_smoothing"
            ],
        )

        face_recognizer = FaceRecognizer(
            model_path=str(FACE_RECOGNIZER_MODEL_PATH),
            input_size=FACE_RECOGNIZER_CONFIG["input_size"],
            similarity_threshold=FACE_RECOGNIZER_CONFIG["similarity_threshold"],
            providers=FACE_RECOGNIZER_CONFIG["providers"],
            database_path=str(FACE_RECOGNIZER_CONFIG["database_path"]),
            session_options=FACE_RECOGNIZER_CONFIG["session_options"],
        )
        await face_recognizer.initialize()

        set_model_references(liveness_detector, None, face_recognizer, face_detector)

        # Set model references for attendance routes - DB is now handled via Dependency Injection
        from api.routes import attendance as attendance_routes

        attendance_routes.face_detector = face_detector
        attendance_routes.face_recognizer = face_recognizer

        logger.info("Startup complete")

    except Exception as e:
        logger.error(f"Failed to initialize models: {e}")
        raise

    yield

    logger.info("Shutting down...")
    logger.info("Shutdown complete")
