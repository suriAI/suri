import logging
import os
import uvicorn

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi import Request

from core.lifespan import lifespan
from api.endpoints import router
from middleware.cors import setup_cors

# Configure logging immediately
# We need to do this BEFORE other logic runs
if not logging.getLogger().handlers:
    from config.logging_config import get_logging_config

    try:
        logging_config = get_logging_config()
        logging.config.dictConfig(logging_config)
    except Exception as e:
        # Fallback if config fails
        logging.basicConfig(level=logging.INFO)
        print(f"Failed to load logging config: {e}")

logger = logging.getLogger(__name__)
logger.info("Server script started")


app = FastAPI(
    title="SURI",
    description="A desktop application for automated attendance tracking using Artificial Intelligence.",
    version="1.0.0",
    lifespan=lifespan,
)

# Configure CORS
setup_cors(app)

# Include API router
app.include_router(router)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch-all exception handler to prevent leaking details and ensure JSON response"""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": "Internal Server Error",
            "detail": str(exc) if os.getenv("ENVIRONMENT") != "production" else None,
        },
    )


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
    from database.migrate import run_migrations

    # Run database migrations before starting the server
    run_migrations()

    # logging_config is already applied at module level, but uvicorn needs it passed or it will reconfigure
    # We re-fetch it to pass to uvicorn
    from config.logging_config import get_logging_config

    logging_config = get_logging_config()

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8700,
        log_config=logging_config,
    )
