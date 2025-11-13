"""
API Router Aggregator
Combines all API route modules into a single router
"""

from fastapi import APIRouter

from api.routes import detection, recognition, websocket, attendance

router = APIRouter()

router.include_router(detection.router, tags=["detection"])
router.include_router(recognition.router, tags=["recognition"])
router.include_router(websocket.router, tags=["websocket"])
router.include_router(attendance.router, tags=["attendance"])

__all__ = ["router"]
