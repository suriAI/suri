import logging
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Depends

from api.schemas import (
    AttendanceStatsResponse,
    DatabaseStatsResponse,
)
from api.deps import get_repository
from database.repository import AttendanceRepository
from services.attendance_service import AttendanceService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="", tags=["stats"])

@router.get("/groups/{group_id}/stats", response_model=AttendanceStatsResponse)
async def get_group_stats(
    group_id: str,
    date: Optional[str] = Query(
        None, description="YYYY-MM-DD format, defaults to today"
    ),
    repo: AttendanceRepository = Depends(get_repository),
):
    """Get attendance statistics for a group"""
    try:
        # Check if group exists
        group = await repo.get_group(group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")

        target_date = date or datetime.now().date().strftime("%Y-%m-%d")

        # Get group members
        members = await repo.get_group_members(group_id)

        # Get the group's late threshold and class start time settings
        late_threshold_minutes = group.late_threshold_minutes or 15
        class_start_time = group.class_start_time or datetime.now().strftime("%H:%M")
        late_threshold_enabled = group.late_threshold_enabled or False

        # Get existing sessions for the target date
        sessions = await repo.get_sessions(
            group_id=group_id, start_date=target_date, end_date=target_date
        )

        # Check if we need to recompute sessions (missing or outdated)
        needs_recompute = not sessions
        if sessions:
            for session in sessions:
                if session.status == "present" and session.check_in_time is None:
                    needs_recompute = True
                    break

        if needs_recompute:
            target_datetime = datetime.strptime(target_date, "%Y-%m-%d")
            start_of_day = target_datetime.replace(hour=0, minute=0, second=0)
            end_of_day = target_datetime.replace(hour=23, minute=59, second=59)

            records = await repo.get_records(
                group_id=group_id, start_date=start_of_day, end_date=end_of_day
            )

            service = AttendanceService(repo)
            session_dicts = service.compute_sessions_from_records(
                records=records,
                members=members,
                late_threshold_minutes=late_threshold_minutes,
                target_date=target_date,
                class_start_time=class_start_time,
                late_threshold_enabled=late_threshold_enabled,
                existing_sessions=sessions,
            )

            for session_data in session_dicts:
                await repo.upsert_session(session_data)

        # Re-fetch sessions
        sessions = await repo.get_sessions(
            group_id=group_id, start_date=target_date, end_date=target_date
        )

        # Calculate statistics
        service = AttendanceService(repo)
        stats = service.calculate_group_stats(members, sessions)

        return AttendanceStatsResponse(**stats)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting group stats for {group_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.get("/stats", response_model=DatabaseStatsResponse)
async def get_database_stats(
    repo: AttendanceRepository = Depends(get_repository),
):
    """Get database statistics"""
    try:
        stats = await repo.get_stats()
        return DatabaseStatsResponse(**stats)

    except Exception as e:
        logger.error(f"Error getting database stats: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
