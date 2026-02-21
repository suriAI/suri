import logging
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query, Depends

from api.schemas import (
    AttendanceRecordCreate,
    AttendanceRecordResponse,
    AttendanceSessionResponse,
    AttendanceEventCreate,
    AttendanceEventResponse,
)
from api.deps import get_repository
from database.repository import AttendanceRepository
from services.attendance_service import AttendanceService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="", tags=["records"])

@router.post("/records", response_model=AttendanceRecordResponse)
async def add_record(
    record_data: AttendanceRecordCreate,
    repo: AttendanceRepository = Depends(get_repository),
):
    """Add a new attendance record"""
    try:
        # Check if member exists
        member = await repo.get_member(record_data.person_id)
        if not member:
            raise HTTPException(status_code=404, detail="Member not found")

        # Prepare record data
        service = AttendanceService(repo)
        record_id = service.generate_id()
        timestamp = record_data.timestamp or datetime.now()

        db_record_data = {
            "id": record_id,
            "person_id": record_data.person_id,
            "group_id": member.group_id,
            "timestamp": timestamp,
            "confidence": record_data.confidence,
            "location": record_data.location,
            "notes": record_data.notes,
            "is_manual": record_data.is_manual,
            "created_by": record_data.created_by,
        }

        created_record = await repo.add_record(db_record_data)
        return created_record

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding record: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.get("/records", response_model=List[AttendanceRecordResponse])
async def get_records(
    group_id: Optional[str] = Query(None),
    person_id: Optional[str] = Query(None),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    limit: Optional[int] = Query(100, ge=1, le=1000),
    repo: AttendanceRepository = Depends(get_repository),
):
    """Get attendance records with optional filters"""
    try:
        records = await repo.get_records(
            group_id=group_id,
            person_id=person_id,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
        )
        return records

    except Exception as e:
        logger.error(f"Error getting records: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.get("/sessions", response_model=List[AttendanceSessionResponse])
async def get_sessions(
    group_id: Optional[str] = Query(None),
    person_id: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None, description="YYYY-MM-DD format"),
    end_date: Optional[str] = Query(None, description="YYYY-MM-DD format"),
    repo: AttendanceRepository = Depends(get_repository),
):
    """Get attendance sessions, computing from records if needed"""
    try:
        # Get existing sessions from database
        sessions = await repo.get_sessions(
            group_id=group_id,
            person_id=person_id,
            start_date=start_date,
            end_date=end_date,
        )

        # Recompute sessions from records
        if group_id and start_date:
            group = await repo.get_group(group_id)
            if not group:
                raise HTTPException(status_code=404, detail="Group not found")

            late_threshold_minutes = (
                group.late_threshold_minutes
                if group.late_threshold_minutes is not None
                else 15
            )
            class_start_time = group.class_start_time or datetime.now().strftime(
                "%H:%M"
            )
            late_threshold_enabled = group.late_threshold_enabled or False

            members = await repo.get_group_members(group_id)
            end_date_to_use = end_date or start_date
            start_datetime = datetime.strptime(start_date, "%Y-%m-%d")
            end_datetime = datetime.strptime(end_date_to_use, "%Y-%m-%d")

            computed_sessions = []
            current_date = start_datetime
            while current_date <= end_datetime:
                date_str = current_date.strftime("%Y-%m-%d")
                day_start = current_date.replace(hour=0, minute=0, second=0)
                day_end = current_date.replace(hour=23, minute=59, second=59)

                records = await repo.get_records(
                    group_id=group_id, start_date=day_start, end_date=day_end
                )

                existing_day_sessions = [
                    s for s in sessions if s.date == date_str
                ]

                service = AttendanceService(repo)
                day_sessions = service.compute_sessions_from_records(
                    records=records,
                    members=members,
                    late_threshold_minutes=late_threshold_minutes,
                    target_date=date_str,
                    class_start_time=class_start_time,
                    late_threshold_enabled=late_threshold_enabled,
                    existing_sessions=existing_day_sessions,
                )

                for session in day_sessions:
                    await repo.upsert_session(session)

                computed_sessions.extend(day_sessions)
                current_date += timedelta(days=1)

            sessions = computed_sessions

        return sessions

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting sessions: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.get("/sessions/{person_id}/{date}", response_model=AttendanceSessionResponse)
async def get_session(
    person_id: str,
    date: str,
    repo: AttendanceRepository = Depends(get_repository),
):
    """Get a specific attendance session"""
    try:
        session = await repo.get_session(person_id, date)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        return session

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting session for {person_id} on {date}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.post("/events", response_model=AttendanceEventResponse)
async def process_attendance_event(
    event_data: AttendanceEventCreate,
    repo: AttendanceRepository = Depends(get_repository),
):
    """Process an attendance event"""
    try:
        from core.lifespan import face_detector, face_recognizer
        from utils.websocket_manager import notification_manager as ws_manager

        # Check if member exists
        member = await repo.get_member(event_data.person_id)
        if not member:
            raise HTTPException(status_code=404, detail="Member not found")

        # Get current settings to check confidence threshold and cooldown
        settings = await repo.get_settings()

        service = AttendanceService(
            repo,
            face_detector=face_detector,
            face_recognizer=face_recognizer,
            ws_manager=ws_manager,
        )

        return await service.process_event(event_data, member, settings)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing attendance event: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
