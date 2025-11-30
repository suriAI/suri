import logging
import time

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException, UploadFile, File

from api.schemas import (
    DetectionRequest,
    DetectionResponse,
    OptimizationRequest,
)
from config.settings import FACE_DETECTOR_CONFIG
from hooks import (
    process_face_detection,
    process_liveness_detection,
)
from utils import serialize_faces
from utils.image_utils import decode_base64_image

if not logging.getLogger().handlers:
    logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/optimize/liveness")
async def configure_liveness_optimization(request: OptimizationRequest):
    """Configure liveness detection optimization settings"""
    from core.lifespan import liveness_detector

    if not liveness_detector:
        raise HTTPException(status_code=500, detail="Liveness detector not available")

    try:
        return {
            "success": True,
            "message": "Optimization settings updated",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update settings: {e}")


@router.post("/optimize/face_detector")
async def configure_face_detector_optimization(request: dict):
    """Configure face detector optimization settings including minimum face size"""
    from core.lifespan import face_detector

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


@router.post("/detect", response_model=DetectionResponse)
async def detect_faces(request: DetectionRequest):
    """
    Detect faces in a single image
    """
    start_time = time.time()

    try:

        image = decode_base64_image(request.image)

        if request.model_type == "face_detector":
            min_face_size = (
                0
                if not request.enable_liveness_detection
                else FACE_DETECTOR_CONFIG["min_face_size"]
            )

            faces = process_face_detection(
                image,
                confidence_threshold=request.confidence_threshold,
                nms_threshold=request.nms_threshold,
                min_face_size=min_face_size,
            )

            for face in faces:
                if "track_id" not in face:
                    face["track_id"] = -1

            faces = process_liveness_detection(
                faces, image, request.enable_liveness_detection
            )

        else:
            raise HTTPException(
                status_code=400, detail=f"Unsupported model type: {request.model_type}"
            )

        processing_time = time.time() - start_time
        serialized_faces = serialize_faces(faces, "/detect endpoint")

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


@router.post("/detect/upload")
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

        image = image_bgr

        if model_type == "face_detector":
            min_face_size = (
                0
                if not enable_liveness_detection
                else FACE_DETECTOR_CONFIG["min_face_size"]
            )

            faces = process_face_detection(
                image,
                confidence_threshold=confidence_threshold,
                nms_threshold=nms_threshold,
                min_face_size=min_face_size,
            )

            for face in faces:
                if "track_id" not in face:
                    face["track_id"] = -1

            faces = process_liveness_detection(
                faces, image, enable_liveness_detection
            )

        else:
            raise HTTPException(
                status_code=400, detail=f"Unsupported model type: {model_type}"
            )

        processing_time = time.time() - start_time
        serialized_faces = serialize_faces(faces, "/detect/upload endpoint")

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
