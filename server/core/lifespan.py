import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from config.settings import (
    DATA_DIR,
    FACE_DETECTOR_CONFIG,
    FACE_DETECTOR_MODEL_PATH,
    FACE_RECOGNIZER_CONFIG,
    FACE_RECOGNIZER_MODEL_PATH,
    FACE_TRACKER_CONFIG,
    FACE_TRACKER_MODEL_PATH,
    LIVENESS_DETECTOR_CONFIG,
)
from core.models import (
    LivenessDetector,
    FaceDetector,
    FaceRecognizer,
    FaceTracker,
)
from database.attendance import AttendanceDatabaseManager
from hooks import set_model_references

if not logging.getLogger().handlers:
    logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize global variables
face_detector = None
liveness_detector = None
face_recognizer = None
face_tracker = None
attendance_database = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global face_detector, liveness_detector, face_recognizer, face_tracker, attendance_database

    try:
        logger.info("Starting up backend server...")
        face_detector = FaceDetector(
            model_path=str(FACE_DETECTOR_MODEL_PATH),
            input_size=FACE_DETECTOR_CONFIG["input_size"],
            conf_threshold=FACE_DETECTOR_CONFIG["score_threshold"],
            nms_threshold=FACE_DETECTOR_CONFIG["nms_threshold"],
            top_k=FACE_DETECTOR_CONFIG["top_k"],
            min_face_size=FACE_DETECTOR_CONFIG["min_face_size"],
        )

        liveness_detector = LivenessDetector(
            model_path=str(LIVENESS_DETECTOR_CONFIG["model_path"]),
            model_img_size=LIVENESS_DETECTOR_CONFIG["model_img_size"],
            confidence_threshold=LIVENESS_DETECTOR_CONFIG["confidence_threshold"],
            min_face_size=LIVENESS_DETECTOR_CONFIG["min_face_size"],
            bbox_inc=LIVENESS_DETECTOR_CONFIG["bbox_inc"],
        )

        face_recognizer = FaceRecognizer(
            model_path=str(FACE_RECOGNIZER_MODEL_PATH),
            input_size=FACE_RECOGNIZER_CONFIG["input_size"],
            similarity_threshold=FACE_RECOGNIZER_CONFIG["similarity_threshold"],
            providers=FACE_RECOGNIZER_CONFIG["providers"],
            database_path=str(FACE_RECOGNIZER_CONFIG["database_path"]),
            session_options=FACE_RECOGNIZER_CONFIG["session_options"],
        )

        face_tracker = FaceTracker(
            model_path=str(FACE_TRACKER_MODEL_PATH),
            track_thresh=FACE_TRACKER_CONFIG["track_thresh"],
            match_thresh=FACE_TRACKER_CONFIG["match_thresh"],
            track_buffer=FACE_TRACKER_CONFIG["track_buffer"],
            frame_rate=FACE_TRACKER_CONFIG["frame_rate"],
            max_iou_distance=FACE_TRACKER_CONFIG["max_iou_distance"],
        )

        attendance_database = AttendanceDatabaseManager(str(DATA_DIR / "attendance.db"))

        # Set model references for hooks
        set_model_references(liveness_detector, face_tracker, face_recognizer)

        # Set model references for attendance routes
        from api.routes import attendance as attendance_routes

        attendance_routes.attendance_db = attendance_database
        attendance_routes.face_detector = face_detector
        attendance_routes.face_recognizer = face_recognizer

        logger.info("Startup complete")

    except Exception as e:
        logger.error(f"Failed to initialize models: {e}")
        raise

    yield

    logger.info("Shutdown complete")
