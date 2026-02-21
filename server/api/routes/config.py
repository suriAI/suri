import logging
from fastapi import APIRouter, HTTPException, Depends

from api.schemas import (
    AttendanceSettingsUpdate,
    AttendanceSettingsResponse,
)
from api.deps import get_repository
from database.repository import AttendanceRepository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/settings", tags=["settings"])

@router.get("", response_model=AttendanceSettingsResponse)
async def get_settings(repo: AttendanceRepository = Depends(get_repository)):
    """Get attendance settings"""
    try:
        settings = await repo.get_settings()
        return settings

    except Exception as e:
        logger.error(f"Error getting settings: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.put("", response_model=AttendanceSettingsResponse)
async def update_settings(
    updates: AttendanceSettingsUpdate,
    repo: AttendanceRepository = Depends(get_repository),
):
    """Update attendance settings"""
    try:
        update_data = {}
        for field, value in updates.model_dump(exclude_unset=True).items():
            if value is not None:
                update_data[field] = value

        if not update_data:
            settings = await repo.get_settings()
            return settings

        success = await repo.update_settings(update_data)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to update settings")

        updated_settings = await repo.get_settings()
        return updated_settings

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating settings: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
