import logging
from fastapi import APIRouter, HTTPException, Depends

from api.schemas import (
    SuccessResponse,
    CleanupRequest,
)
from api.deps import get_repository
from database.repository import AttendanceRepository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="", tags=["maintenance"])


@router.post("/cleanup", response_model=SuccessResponse)
async def cleanup_old_data(
    cleanup_data: CleanupRequest,
    repo: AttendanceRepository = Depends(get_repository),
):
    """Clean up old attendance data"""
    try:
        days = cleanup_data.days_to_keep or 30
        results = await repo.cleanup_old_data(days)

        return SuccessResponse(
            message=f"Cleanup successful: {results['records_deleted']} records and {results['sessions_deleted']} sessions deleted."
        )

    except Exception as e:
        logger.error(f"Error cleaning up old data: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
