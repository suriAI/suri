from fastapi import APIRouter

from api.routes import (
    groups,
    members,
    records,
    stats,
    config,
    maintenance,
)

# Initialize router
router = APIRouter(prefix="/attendance")

# Include sub-routers
router.include_router(groups.router)
router.include_router(members.router)
router.include_router(records.router)
router.include_router(stats.router)
router.include_router(config.router)
router.include_router(maintenance.router)

# Face detection/recognition models (updated by core.lifespan)
face_detector = None
face_recognizer = None
