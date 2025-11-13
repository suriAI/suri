import logging
import uvicorn

from fastapi import FastAPI

from core.lifespan import lifespan
from api.endpoints import router as api_router
from middleware.cors import setup_cors

if not logging.getLogger().handlers:
    logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


app = FastAPI(
    title="SURI",
    description="A desktop application for automated attendance tracking using Artificial Intelligence.",
    version="1.0.0",
    lifespan=lifespan,
)

# Configure CORS
setup_cors(app)

# Include API router
app.include_router(api_router)


@app.get("/")
async def root():
    """Health check endpoint"""
    return {"message": "Face Detection API is running", "status": "healthy"}


@app.get("/models")
async def get_available_models():
    """Get information about available models"""
    from core.lifespan import face_detector, liveness_detector, face_recognizer

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


if __name__ == "__main__":
    uvicorn.run(
        app,  # Pass app object directly for PyInstaller compatibility
        host="127.0.0.1",
        port=8700,
    )
