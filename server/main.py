import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime

import cv2
import numpy as np
import uvicorn
from fastapi import (
    FastAPI,
    WebSocket,
    WebSocketDisconnect,
    HTTPException,
    UploadFile,
    File,
)
from fastapi.middleware.cors import CORSMiddleware

from core.config import (
    CORS_CONFIG,
    DATA_DIR,
    FACE_DETECTOR_CONFIG,
    FACE_DETECTOR_MODEL_PATH,
    FACE_RECOGNIZER_CONFIG,
    FACE_RECOGNIZER_MODEL_PATH,
    FACE_TRACKER_CONFIG,
    LIVENESS_DETECTOR_CONFIG,
)
from database.attendance import AttendanceDatabaseManager
from hooks import (
    process_face_tracking,
    process_liveness_detection,
    set_model_references,
)
from core.models import (
    LivenessDetector,
    FaceDetector,
    FaceRecognizer,
    FaceTracker,
)
from routes import attendance_api as attendance
from schemas import (
    DetectionRequest,
    DetectionResponse,
    FaceRecognitionRequest,
    FaceRecognitionResponse,
    FaceRegistrationRequest,
    FaceRegistrationResponse,
    OptimizationRequest,
    PersonUpdateRequest,
    SimilarityThresholdRequest,
)
from utils.image_utils import decode_base64_image
from utils.websocket_manager import manager

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
    cleanup_task = None

    try:
        logger.info("Starting up backend server...")
        face_detector = FaceDetector(
            model_path=str(FACE_DETECTOR_MODEL_PATH),
            input_size=tuple(FACE_DETECTOR_CONFIG["input_size"]),
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

        matching_weights = FACE_TRACKER_CONFIG["matching_weights"]
        face_tracker = FaceTracker(
            max_age=FACE_TRACKER_CONFIG["max_age"],
            n_init=FACE_TRACKER_CONFIG["n_init"],
            max_iou_distance=FACE_TRACKER_CONFIG["max_iou_distance"],
            max_cosine_distance=FACE_TRACKER_CONFIG["max_cosine_distance"],
            nn_budget=FACE_TRACKER_CONFIG["nn_budget"],
            matching_weights=matching_weights,
        )

        attendance_database = AttendanceDatabaseManager(str(DATA_DIR / "attendance.db"))

        attendance.attendance_db = attendance_database
        attendance.face_detector = face_detector
        attendance.face_recognizer = face_recognizer

        set_model_references(liveness_detector, face_tracker, face_recognizer)

        async def cleanup_loop():
            while True:
                try:
                    await asyncio.sleep(300)
                    await manager.cleanup_inactive_connections(timeout_minutes=30)
                except asyncio.CancelledError:
                    break
                except Exception as e:
                    logger.error(f"Cleanup loop error: {e}")

        cleanup_task = asyncio.create_task(cleanup_loop())
        logger.info("Startup complete")

    except Exception as e:
        logger.error(f"Failed to initialize models: {e}")
        raise

    yield

    if cleanup_task:
        try:
            cleanup_task.cancel()
            await cleanup_task
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error stopping cleanup task: {e}")

    logger.info("Shutdown complete")
    logger.info("Shutting down backend server...")
    try:
        # Database connections use context managers - no explicit close needed
        logger.info("Releasing model references...")

        # Clear model references to free memory
        face_detector = None
        liveness_detector = None
        face_recognizer = None
        face_tracker = None
        attendance_database = None

        logger.info("Cleanup complete")

    except Exception as e:
        logger.error(f"Error during shutdown cleanup: {e}")


app = FastAPI(
    title="SURI",
    description="A desktop application for automated attendance tracking using Artificial Intelligence.",
    version="1.0.0",
    lifespan=lifespan,
)

# Configure CORS - Use configuration from core.config
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_CONFIG["allow_origins"],
    allow_credentials=CORS_CONFIG["allow_credentials"],
    allow_methods=CORS_CONFIG["allow_methods"],
    allow_headers=CORS_CONFIG["allow_headers"],
    expose_headers=CORS_CONFIG.get("expose_headers", []),
)

# Include attendance routes
app.include_router(attendance.router)


@app.get("/")
async def root():
    """Health check endpoint"""
    return {"message": "Face Detection API is running", "status": "healthy"}


@app.get("/models")
async def get_available_models():
    """Get information about available models"""
    models_info = {}

    # Check if face_detector exists and is actually functional
    if (
        face_detector
        and hasattr(face_detector, "detector")
        and face_detector.detector is not None
    ):
        models_info["face_detector"] = {
            "available": True,
        }
    else:
        models_info["face_detector"] = {"available": False}

    # Check if liveness_detector exists and is actually functional
    if (
        liveness_detector
        and hasattr(liveness_detector, "ort_session")
        and liveness_detector.ort_session is not None
    ):
        models_info["liveness_detector"] = {
            "available": True,
        }
    else:
        models_info["liveness_detector"] = {"available": False}

    # Check if face_recognizer exists and is actually functional
    if (
        face_recognizer
        and hasattr(face_recognizer, "session")
        and face_recognizer.session is not None
    ):
        models_info["face_recognizer"] = {"available": True}
    else:
        models_info["face_recognizer"] = {"available": False}

    return {"models": models_info}


@app.post("/optimize/liveness")
async def configure_liveness_optimization(request: OptimizationRequest):
    """Configure liveness detection optimization settings"""
    if not liveness_detector:
        raise HTTPException(status_code=500, detail="Liveness detector not available")

    try:
        return {
            "success": True,
            "message": "Optimization settings updated",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update settings: {e}")


@app.post("/optimize/face_detector")
async def configure_face_detector_optimization(request: dict):
    """Configure face detector optimization settings including minimum face size"""
    try:
        if face_detector:
            if "min_face_size" in request:
                min_size = int(request["min_face_size"])
                face_detector.set_min_face_size(min_size)
                return {
                    "success": True,
                    "message": "Face detector settings updated successfully",
                    "new_settings": {"min_face_size": min_size},
                }
            else:
                return {"success": False, "message": "min_face_size parameter required"}
        else:
            return {"success": False, "message": "Face detector not available"}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to update face detector settings: {e}"
        )


@app.post("/detect", response_model=DetectionResponse)
async def detect_faces(request: DetectionRequest):
    """
    Detect faces in a single image
    """
    start_time = time.time()

    try:
        # OPTIMIZATION: Keep BGR format throughout (OpenCV native format)
        image = decode_base64_image(request.image)  # Returns BGR

        if request.model_type == "face_detector":
            if not face_detector:
                raise HTTPException(
                    status_code=500, detail="Face detector model not available"
                )

            face_detector.set_confidence_threshold(request.confidence_threshold)
            face_detector.set_nms_threshold(request.nms_threshold)

            # When liveness detection is disabled, remove minimum face size limit
            # When enabled, restore default minimum face size from config (single source of truth)
            if not request.enable_liveness_detection:
                face_detector.set_min_face_size(
                    0
                )  # No limit when spoof detection is off
            else:
                default_min_size = FACE_DETECTOR_CONFIG["min_face_size"]
                face_detector.set_min_face_size(default_min_size)

            faces = face_detector.detect_faces(image)

            # CRITICAL: Add face tracking for consistent track_id (Deep SORT with embeddings)
            faces = await process_face_tracking(faces, image)

            faces = await process_liveness_detection(
                faces, image, request.enable_liveness_detection
            )

        else:
            raise HTTPException(
                status_code=400, detail=f"Unsupported model type: {request.model_type}"
            )

        processing_time = time.time() - start_time

        serialized_faces = []
        for face in faces:
            # Validate required fields - no fallbacks
            if "bbox" not in face or not isinstance(face["bbox"], dict):
                logger.warning(f"Face missing bbox in /detect endpoint: {face}")
                continue

            # Use bbox_original if present, otherwise use bbox
            if "bbox_original" in face:
                bbox_orig = face["bbox_original"]
                if not isinstance(bbox_orig, dict):
                    logger.warning(f"Face bbox_original is not a dict: {face}")
                    continue
            else:
                bbox_orig = face["bbox"]

            # Validate bbox has all required fields
            required_bbox_fields = ["x", "y", "width", "height"]
            if not all(field in bbox_orig for field in required_bbox_fields):
                logger.warning(f"Face bbox missing required fields: {bbox_orig}")
                continue

            # Validate confidence is present
            if "confidence" not in face or face["confidence"] is None:
                logger.warning(f"Face missing confidence: {face}")
                continue

            # Serialize bbox as array [x, y, width, height]
            face["bbox"] = [
                bbox_orig["x"],
                bbox_orig["y"],
                bbox_orig["width"],
                bbox_orig["height"],
            ]

            # Convert track_id to int if present
            if "track_id" in face and face["track_id"] is not None:
                track_id_value = face["track_id"]
                if isinstance(track_id_value, (np.integer, np.int32, np.int64)):
                    face["track_id"] = int(track_id_value)

            # Validate liveness data if present
            if "liveness" in face:
                liveness = face["liveness"]
                if not isinstance(liveness, dict):
                    logger.warning(f"Face liveness is not a dict: {face}")
                    del face["liveness"]
                else:
                    # Validate required liveness fields
                    if "status" not in liveness:
                        logger.warning(f"Face liveness missing status: {liveness}")
                        del face["liveness"]
                    elif "is_real" not in liveness:
                        logger.warning(f"Face liveness missing is_real: {liveness}")
                        del face["liveness"]

            # Remove embedding to reduce payload size
            if "embedding" in face:
                del face["embedding"]

            serialized_faces.append(face)

        processing_time_ms = processing_time * 1000
        if processing_time_ms > 50:
            suggested_skip = 2
        elif processing_time_ms > 30:
            suggested_skip = 1
        else:
            suggested_skip = 0

        return DetectionResponse(
            success=True,
            faces=serialized_faces,
            processing_time=processing_time,
            model_used=request.model_type,
            suggested_skip=suggested_skip,
        )

    except Exception as e:
        logger.error(f"Detection error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/detect/upload")
async def detect_faces_upload(
    file: UploadFile = File(...),
    model_type: str = "face_detector",
    confidence_threshold: float = 0.6,
    nms_threshold: float = 0.3,
    enable_liveness_detection: bool = True,
):
    """
    Detect faces in an uploaded image file
    """
    start_time = time.time()

    try:
        contents = await file.read()

        nparr = np.frombuffer(contents, np.uint8)
        image_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if image_bgr is None:
            raise HTTPException(status_code=400, detail="Invalid image file")

        # OPTIMIZATION: Keep BGR format (no conversion needed)
        image = image_bgr

        if model_type == "face_detector":
            if not face_detector:
                raise HTTPException(
                    status_code=500, detail="Face detector model not available"
                )

            face_detector.set_confidence_threshold(confidence_threshold)
            face_detector.set_nms_threshold(nms_threshold)

            # When liveness detection is disabled, remove minimum face size limit
            # When enabled, restore default minimum face size from config (single source of truth)
            if not enable_liveness_detection:
                face_detector.set_min_face_size(
                    0
                )  # No limit when spoof detection is off
            else:
                default_min_size = FACE_DETECTOR_CONFIG["min_face_size"]
                face_detector.set_min_face_size(default_min_size)

            faces = face_detector.detect_faces(image)

            # CRITICAL: Add face tracking for consistent track_id (Deep SORT with embeddings)
            faces = await process_face_tracking(faces, image)

            faces = await process_liveness_detection(
                faces, image, enable_liveness_detection
            )

        else:
            raise HTTPException(
                status_code=400, detail=f"Unsupported model type: {model_type}"
            )

        processing_time = time.time() - start_time

        serialized_faces = []
        for face in faces:
            # Validate required fields - no fallbacks
            if "bbox" not in face or not isinstance(face["bbox"], dict):
                logger.warning(f"Face missing bbox in /detect/upload endpoint: {face}")
                continue

            # Use bbox_original if present, otherwise use bbox
            if "bbox_original" in face:
                bbox_orig = face["bbox_original"]
                if not isinstance(bbox_orig, dict):
                    logger.warning(f"Face bbox_original is not a dict: {face}")
                    continue
            else:
                bbox_orig = face["bbox"]

            # Validate bbox has all required fields
            required_bbox_fields = ["x", "y", "width", "height"]
            if not all(field in bbox_orig for field in required_bbox_fields):
                logger.warning(f"Face bbox missing required fields: {bbox_orig}")
                continue

            # Validate confidence is present
            if "confidence" not in face or face["confidence"] is None:
                logger.warning(f"Face missing confidence: {face}")
                continue

            # Serialize bbox as array [x, y, width, height]
            face["bbox"] = [
                bbox_orig["x"],
                bbox_orig["y"],
                bbox_orig["width"],
                bbox_orig["height"],
            ]

            # Convert track_id to int if present
            if "track_id" in face and face["track_id"] is not None:
                track_id_value = face["track_id"]
                if isinstance(track_id_value, (np.integer, np.int32, np.int64)):
                    face["track_id"] = int(track_id_value)

            # Validate liveness data if present
            if "liveness" in face:
                liveness = face["liveness"]
                if not isinstance(liveness, dict):
                    logger.warning(f"Face liveness is not a dict: {face}")
                    del face["liveness"]
                else:
                    # Validate required liveness fields
                    if "status" not in liveness:
                        logger.warning(f"Face liveness missing status: {liveness}")
                        del face["liveness"]
                    elif "is_real" not in liveness:
                        logger.warning(f"Face liveness missing is_real: {liveness}")
                        del face["liveness"]

            # Remove embedding to reduce payload size
            if "embedding" in face:
                del face["embedding"]

            serialized_faces.append(face)

        processing_time_ms = processing_time * 1000
        if processing_time_ms > 50:
            suggested_skip = 2
        elif processing_time_ms > 30:
            suggested_skip = 1
        else:
            suggested_skip = 0

        return {
            "success": True,
            "faces": serialized_faces,
            "processing_time": processing_time,
            "model_used": model_type,
            "suggested_skip": suggested_skip,
        }

    except Exception as e:
        logger.error(f"Detection error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Face Recognition Endpoints


@app.post("/face/recognize", response_model=FaceRecognitionResponse)
async def recognize_face(request: FaceRecognitionRequest):
    """
    Recognize a face using face recognizer with liveness detection validation
    """
    start_time = time.time()

    try:
        if not face_recognizer:
            raise HTTPException(status_code=500, detail="Face recognizer not available")

        # OPTIMIZATION: Keep BGR format (no conversion needed)
        image = decode_base64_image(request.image)

        # Only perform liveness detection if enabled
        if liveness_detector and request.enable_liveness_detection:
            # landmarks_5 completely removed from liveness detection (rotation removed from anti-spoof)
            temp_face = {
                "bbox": {
                    "x": request.bbox[0],
                    "y": request.bbox[1],
                    "width": request.bbox[2],
                    "height": request.bbox[3],
                },
                "confidence": 1.0,
                "track_id": -1,
            }

            # Process liveness detection
            loop = asyncio.get_event_loop()
            liveness_results = await loop.run_in_executor(
                None, liveness_detector.detect_faces, image, [temp_face]
            )

            if liveness_results and len(liveness_results) > 0:
                liveness_data = liveness_results[0].get("liveness", {})
                is_real = liveness_data.get("is_real", False)
                status = liveness_data.get("status", "unknown")

                # Block recognition for spoofed faces
                if not is_real or status == "spoof":
                    processing_time = time.time() - start_time
                    return FaceRecognitionResponse(
                        success=False,
                        person_id=None,
                        similarity=0.0,
                        processing_time=processing_time,
                        error=f"Recognition blocked: spoofed face detected (status: {status})",
                    )

                # Also block other problematic statuses
                # Security & Efficiency: Block at recognition stage (first) rather than logging (later)
                # This prevents wasted API calls and potential misidentification of partial/edge faces
                if status in [
                    "too_small",
                    "error",
                ]:
                    processing_time = time.time() - start_time
                    logger.warning(
                        f"Recognition blocked for face with status: {status}"
                    )
                    return FaceRecognitionResponse(
                        success=False,
                        person_id=None,
                        similarity=0.0,
                        processing_time=processing_time,
                        error=f"Recognition blocked: face status {status}",
                    )

        # Get landmarks_5 for face_recognizer (required for face alignment)
        landmarks_5 = request.landmarks_5
        if landmarks_5 is None:
            raise HTTPException(
                status_code=400,
                detail="Landmarks required for face recognition",
            )

        # Get person_ids for group filtering (if group_id provided)
        allowed_person_ids = None
        if request.group_id and attendance_database:
            allowed_person_ids = attendance_database.get_group_person_ids(
                request.group_id
            )

        result = await face_recognizer.recognize_face_async(
            image, request.bbox, landmarks_5, allowed_person_ids
        )

        processing_time = time.time() - start_time

        return FaceRecognitionResponse(
            success=result["success"],
            person_id=result.get("person_id"),
            similarity=result.get("similarity", 0.0),
            processing_time=processing_time,
            error=result.get("error"),
        )

    except Exception as e:
        processing_time = time.time() - start_time
        logger.error(f"Face recognition error: {e}")
        return FaceRecognitionResponse(
            success=False,
            person_id=None,
            similarity=0.0,
            processing_time=processing_time,
            error=str(e),
        )


@app.post("/face/register", response_model=FaceRegistrationResponse)
async def register_person(request: FaceRegistrationRequest):
    """
    Register a new person in the face database with liveness detection validation
    """
    start_time = time.time()

    try:
        if not face_recognizer:
            raise HTTPException(status_code=500, detail="Face recognizer not available")

        # OPTIMIZATION: Keep BGR format (no conversion needed)
        image = decode_base64_image(request.image)

        # Only perform liveness detection if enabled
        if liveness_detector and request.enable_liveness_detection:
            # landmarks_5 completely removed from liveness detection (rotation removed from anti-spoof)
            temp_face = {
                "bbox": {
                    "x": request.bbox[0],
                    "y": request.bbox[1],
                    "width": request.bbox[2],
                    "height": request.bbox[3],
                },
                "confidence": 1.0,
                "track_id": -1,
            }

            # Process liveness detection (sync method wrapped in executor for true parallelism)
            loop = asyncio.get_event_loop()
            liveness_results = await loop.run_in_executor(
                None, liveness_detector.detect_faces, image, [temp_face]
            )

            if liveness_results and len(liveness_results) > 0:
                liveness_data = liveness_results[0].get("liveness", {})
                is_real = liveness_data.get("is_real", False)
                status = liveness_data.get("status", "unknown")

                # Block registration for spoofed faces
                if not is_real or status == "spoof":
                    processing_time = time.time() - start_time
                    logger.warning(
                        f"Registration blocked for spoofed face: status={status}, is_real={is_real}"
                    )
                    return FaceRegistrationResponse(
                        success=False,
                        person_id=request.person_id,
                        total_persons=0,
                        processing_time=processing_time,
                        error=f"Registration blocked: spoofed face detected (status: {status})",
                    )

                # Also block other problematic statuses
                # Block problematic statuses to prevent registration of unreliable edge cases
                # Edge cases have insufficient quality for reliable face registration
                if status in [
                    "too_small",
                    "error",
                ]:
                    processing_time = time.time() - start_time
                    logger.warning(
                        f"Registration blocked for face with status: {status}"
                    )
                    return FaceRegistrationResponse(
                        success=False,
                        person_id=request.person_id,
                        total_persons=0,
                        processing_time=processing_time,
                        error=f"Registration blocked: face status {status}",
                    )

        # Get landmarks_5 for face_recognizer (required for face alignment)
        landmarks_5 = request.landmarks_5
        if landmarks_5 is None:
            raise HTTPException(
                status_code=400,
                detail="Landmarks required for face recognition",
            )

        result = await face_recognizer.register_person_async(
            request.person_id, image, request.bbox, landmarks_5
        )

        processing_time = time.time() - start_time

        return FaceRegistrationResponse(
            success=result["success"],
            person_id=request.person_id,
            total_persons=result.get("total_persons", 0),
            processing_time=processing_time,
            error=result.get("error"),
        )

    except Exception as e:
        processing_time = time.time() - start_time
        logger.error(f"Person registration error: {e}")
        return FaceRegistrationResponse(
            success=False,
            person_id=request.person_id,
            total_persons=0,
            processing_time=processing_time,
            error=str(e),
        )


@app.delete("/face/person/{person_id}")
async def remove_person(person_id: str):
    """
    Remove a person from the face database
    """
    try:
        if not face_recognizer:
            raise HTTPException(status_code=500, detail="Face recognizer not available")

        result = face_recognizer.remove_person(person_id)

        if result["success"]:
            return {
                "success": True,
                "message": f"Person {person_id} removed successfully",
                "total_persons": result.get("total_persons", 0),
            }
        else:
            raise HTTPException(
                status_code=404, detail=result.get("error", "Person not found")
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Person removal error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to remove person: {e}")


@app.put("/face/person")
async def update_person(request: PersonUpdateRequest):
    """
    Update a person's ID in the face database
    """
    try:
        if not face_recognizer:
            raise HTTPException(status_code=500, detail="Face recognizer not available")

        # Validate input
        if not request.old_person_id.strip() or not request.new_person_id.strip():
            raise HTTPException(
                status_code=400, detail="Both old and new person IDs must be provided"
            )

        if request.old_person_id.strip() == request.new_person_id.strip():
            raise HTTPException(
                status_code=400, detail="Old and new person IDs must be different"
            )

        # Update person ID using face recognizer method
        result = face_recognizer.update_person_id(
            request.old_person_id.strip(), request.new_person_id.strip()
        )

        if result["success"]:
            return result
        else:
            raise HTTPException(
                status_code=404, detail=result.get("error", "Update failed")
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Person update error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update person: {e}")


@app.get("/face/persons")
async def get_all_persons():
    """
    Get list of all registered persons
    """
    try:
        if not face_recognizer:
            raise HTTPException(status_code=500, detail="Face recognizer not available")

        persons = face_recognizer.get_all_persons()
        stats = face_recognizer.get_stats()

        return {
            "success": True,
            "persons": persons,
            "total_count": len(persons),
            "stats": stats,
        }

    except Exception as e:
        logger.error(f"Get persons error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get persons: {e}")


@app.post("/face/threshold")
async def set_similarity_threshold(request: SimilarityThresholdRequest):
    """
    Set similarity threshold for face recognition
    """
    try:
        if not face_recognizer:
            raise HTTPException(status_code=500, detail="Face recognizer not available")

        if not (0.0 <= request.threshold <= 1.0):
            raise HTTPException(
                status_code=400, detail="Threshold must be between 0.0 and 1.0"
            )

        face_recognizer.set_similarity_threshold(request.threshold)

        return {
            "success": True,
            "message": f"Similarity threshold updated to {request.threshold}",
            "threshold": request.threshold,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Threshold update error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update threshold: {e}")


@app.delete("/face/database")
async def clear_database():
    """
    Clear all persons from the face database
    """
    try:
        if not face_recognizer:
            raise HTTPException(status_code=500, detail="Face recognizer not available")

        result = face_recognizer.clear_database()

        if result["success"]:
            return {
                "success": True,
                "message": "Face database cleared successfully",
                "total_persons": 0,
            }
        else:
            raise HTTPException(
                status_code=500, detail=result.get("error", "Failed to clear database")
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Database clear error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to clear database: {e}")


@app.get("/face/stats")
async def get_face_stats():
    """
    Get face recognition statistics and configuration
    """
    try:
        if not face_recognizer:
            raise HTTPException(status_code=500, detail="Face recognizer not available")

        stats = face_recognizer.get_stats()

        # Return stats directly in the format expected by the Settings component
        return stats

    except Exception as e:
        logger.error(f"Get stats error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get stats: {e}")


@app.websocket("/ws/detect/{client_id}")
async def websocket_detect_endpoint(websocket: WebSocket, client_id: str):
    logger.info(f"[WebSocket] Client {client_id} attempting to connect...")
    await websocket.accept()
    logger.info(f"[WebSocket] Client {client_id} connected successfully")

    if client_id not in manager.active_connections:
        manager.active_connections[client_id] = websocket
    if client_id not in manager.connection_metadata:
        manager.connection_metadata[client_id] = {
            "connected_at": datetime.now(),
            "last_activity": datetime.now(),
            "message_count": 0,
            "streaming": False,
        }

    # Store enable_liveness_detection per client (default to True)
    enable_liveness_detection = True

    # Initialize min_face_size based on default enable_liveness_detection state
    # This ensures correct face size limiting from the first frame
    # Using config as single source of truth
    if face_detector:
        default_min_size = FACE_DETECTOR_CONFIG["min_face_size"]
        face_detector.set_min_face_size(default_min_size)

    try:
        await websocket.send_text(
            json.dumps(
                {
                    "type": "connection",
                    "status": "connected",
                    "client_id": client_id,
                    "timestamp": time.time(),
                }
            )
        )
        logger.info(f"[WebSocket] Sent connection confirmation to client {client_id}")

        logger.info(f"[WebSocket] Starting message loop for client {client_id}")

        while True:
            try:
                message_data = await websocket.receive()

                if "text" in message_data:
                    message = json.loads(message_data["text"])

                    if message.get("type") == "ping":
                        if client_id in manager.connection_metadata:
                            manager.connection_metadata[client_id][
                                "last_activity"
                            ] = datetime.now()
                        await websocket.send_text(
                            json.dumps(
                                {
                                    "type": "pong",
                                    "client_id": client_id,
                                    "timestamp": time.time(),
                                }
                            )
                        )
                        continue

                    if message.get("type") == "disconnect":
                        logger.info(
                            f"[WebSocket] Client {client_id} requested disconnect"
                        )
                        break

                    elif message.get("type") == "config":
                        # Update enable_liveness_detection from config
                        if "enable_liveness_detection" in message:
                            enable_liveness_detection = message.get(
                                "enable_liveness_detection", True
                            )
                            # When liveness detection is disabled, remove minimum face size limit
                            # When enabled, restore default minimum face size from config (single source of truth)
                            if face_detector:
                                if not enable_liveness_detection:
                                    face_detector.set_min_face_size(
                                        0
                                    )  # No limit when spoof detection is off
                                else:
                                    default_min_size = FACE_DETECTOR_CONFIG[
                                        "min_face_size"
                                    ]
                                    face_detector.set_min_face_size(default_min_size)

                        await websocket.send_text(
                            json.dumps(
                                {
                                    "type": "config_ack",
                                    "success": True,
                                    "timestamp": time.time(),
                                }
                            )
                        )
                        continue

                elif "bytes" in message_data:
                    if client_id in manager.connection_metadata:
                        manager.connection_metadata[client_id][
                            "last_activity"
                        ] = datetime.now()
                    start_time = time.time()
                    frame_bytes = message_data["bytes"]

                    nparr = np.frombuffer(frame_bytes, np.uint8)
                    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                    if image is None:
                        await websocket.send_text(
                            json.dumps(
                                {
                                    "type": "error",
                                    "message": "Failed to decode frame",
                                    "timestamp": time.time(),
                                }
                            )
                        )
                        continue

                    if not face_detector:
                        raise HTTPException(
                            status_code=500, detail="Face detector model not available"
                        )

                    faces = face_detector.detect_faces(image)
                    faces = await process_face_tracking(faces, image)
                    faces = await process_liveness_detection(
                        faces, image, enable_liveness_detection
                    )

                    serialized_faces = []
                    for face in faces:
                        # Validate required fields - no fallbacks, fail if data is incomplete
                        if "bbox" not in face or not isinstance(face["bbox"], dict):
                            logger.warning(f"Face missing bbox: {face}")
                            continue

                        # Use bbox_original if present, otherwise use bbox (no fallback - both should exist)
                        if "bbox_original" in face:
                            bbox_orig = face["bbox_original"]
                            if not isinstance(bbox_orig, dict):
                                logger.warning(
                                    f"Face bbox_original is not a dict: {face}"
                                )
                                continue
                        else:
                            bbox_orig = face["bbox"]

                        # Validate bbox has all required fields
                        required_bbox_fields = ["x", "y", "width", "height"]
                        if not all(
                            field in bbox_orig for field in required_bbox_fields
                        ):
                            logger.warning(
                                f"Face bbox missing required fields: {bbox_orig}"
                            )
                            continue

                        # Validate confidence is present and valid
                        if "confidence" not in face:
                            logger.warning(f"Face missing confidence: {face}")
                            continue
                        if face["confidence"] is None:
                            logger.warning(f"Face confidence is None: {face}")
                            continue

                        # Serialize bbox as array [x, y, width, height]
                        face["bbox"] = [
                            bbox_orig["x"],
                            bbox_orig["y"],
                            bbox_orig["width"],
                            bbox_orig["height"],
                        ]

                        # Convert track_id to int if present
                        if "track_id" in face and face["track_id"] is not None:
                            track_id_value = face["track_id"]
                            if isinstance(
                                track_id_value, (np.integer, np.int32, np.int64)
                            ):
                                face["track_id"] = int(track_id_value)

                        # Validate liveness data if present
                        if "liveness" in face:
                            liveness = face["liveness"]
                            if not isinstance(liveness, dict):
                                logger.warning(f"Face liveness is not a dict: {face}")
                                del face["liveness"]
                            else:
                                # Validate required liveness fields
                                if "status" not in liveness:
                                    logger.warning(
                                        f"Face liveness missing status: {liveness}"
                                    )
                                    del face["liveness"]
                                elif "is_real" not in liveness:
                                    logger.warning(
                                        f"Face liveness missing is_real: {liveness}"
                                    )
                                    del face["liveness"]

                        # Remove embedding to reduce payload size
                        if "embedding" in face:
                            del face["embedding"]

                        serialized_faces.append(face)

                    processing_time = time.time() - start_time

                    current_timestamp = time.time()
                    response_data = {
                        "type": "detection_response",
                        "faces": serialized_faces,
                        "model_used": "face_detector",
                        "processing_time": processing_time,
                        "timestamp": current_timestamp,
                        "frame_timestamp": current_timestamp,
                        "success": True,
                    }

                    # Calculate suggested_skip based on processing time
                    if processing_time * 1000 > 50:
                        suggested_skip = 2
                    elif processing_time * 1000 > 30:
                        suggested_skip = 1
                    else:
                        suggested_skip = 0

                    response_data["suggested_skip"] = suggested_skip

                    await websocket.send_text(json.dumps(response_data))

            except WebSocketDisconnect:
                # Connection closed by client, exit gracefully
                logger.info(
                    f"[WebSocket] Client {client_id} disconnected (inner loop - WebSocketDisconnect exception)"
                )
                break
            except Exception as e:
                # Check if it's a connection-related error
                error_str = str(e).lower()
                if "disconnect" in error_str or "close" in error_str:
                    logger.info(
                        f"[WebSocket] Client {client_id} disconnected due to connection error: {e}"
                    )
                    break
                # Only log if it's not a connection-related error
                logger.error(
                    f"[WebSocket] Detection processing error for client {client_id}: {e}"
                )
                try:
                    await websocket.send_text(
                        json.dumps(
                            {
                                "type": "error",
                                "message": f"Detection failed: {str(e)}",
                                "timestamp": time.time(),
                            }
                        )
                    )
                except (WebSocketDisconnect, RuntimeError) as send_error:
                    # Connection already closed, ignore
                    logger.info(
                        f"[WebSocket] Client {client_id} disconnected during error handling: {send_error}"
                    )
                    break

    except WebSocketDisconnect:
        logger.info(
            f"[WebSocket] Client {client_id} disconnected (outer exception - WebSocketDisconnect)"
        )
    except Exception as e:
        error_str = str(e).lower()
        if (
            "disconnect" not in error_str
            and "close" not in error_str
            and "send" not in error_str
        ):
            logger.error(f"[WebSocket] Detection error for client {client_id}: {e}")
        else:
            logger.info(
                f"[WebSocket] Client {client_id} disconnected due to exception: {e}"
            )
    finally:
        if client_id in manager.active_connections:
            await manager.disconnect(client_id)
        logger.info(f"[WebSocket] Detection endpoint closed for client {client_id}")


@app.websocket("/ws/notifications/{client_id}")
async def websocket_notifications_endpoint(websocket: WebSocket, client_id: str):
    await manager.connect(websocket, client_id)
    # Notification client connected

    try:
        await websocket.send_text(
            json.dumps(
                {
                    "type": "connection",
                    "status": "connected",
                    "client_id": client_id,
                    "timestamp": asyncio.get_event_loop().time(),
                }
            )
        )

        while True:
            message_data = await websocket.receive()

            if "text" in message_data:
                message = json.loads(message_data["text"])

                if message.get("type") == "ping":
                    await websocket.send_text(
                        json.dumps(
                            {
                                "type": "pong",
                                "client_id": client_id,
                                "timestamp": asyncio.get_event_loop().time(),
                            }
                        )
                    )

    except WebSocketDisconnect:
        # Notification client disconnected
        await manager.disconnect(client_id)
    except Exception as e:
        logger.error(f"WebSocket notification error: {e}")
        await manager.disconnect(client_id)


if __name__ == "__main__":
    uvicorn.run(
        app,  # Pass app object directly for PyInstaller compatibility
        host="127.0.0.1",
        port=8700,
        reload=False,  # Disabled to prevent log file reload loops
        log_level="info",
    )
