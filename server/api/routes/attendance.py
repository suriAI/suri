import logging
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Depends

from api.schemas import (
    # Group models
    AttendanceGroupCreate,
    AttendanceGroupUpdate,
    AttendanceGroupResponse,
    # Member models
    AttendanceMemberCreate,
    AttendanceMemberUpdate,
    AttendanceMemberResponse,
    BulkMemberCreate,
    BulkMemberResponse,
    # Record models
    AttendanceRecordCreate,
    AttendanceRecordResponse,
    # Session models
    AttendanceSessionResponse,
    # Event models
    AttendanceEventCreate,
    AttendanceEventResponse,
    # Settings models
    AttendanceSettingsUpdate,
    AttendanceSettingsResponse,
    # Statistics models
    AttendanceStatsResponse,
    SuccessResponse,
    DatabaseStatsResponse,
    CleanupRequest,
)
from api.deps import get_repository
from database.repository import AttendanceRepository
from utils.websocket_manager import manager as ws_manager
from services.attendance_service import AttendanceService

logger = logging.getLogger(__name__)

# Initialize router
router = APIRouter(prefix="/attendance", tags=["attendance"])

# Face detection/recognition models (will be initialized in main.py)
face_detector = None
face_recognizer = None


# Group Management Endpoints
@router.post("/groups", response_model=AttendanceGroupResponse)
async def create_group(
    group_data: AttendanceGroupCreate,
    repo: AttendanceRepository = Depends(get_repository),
):
    """Create a new attendance group"""
    try:
        service = AttendanceService(repo)
        group_id = service.generate_id()

        db_group_data = {
            "id": group_id,
            "name": group_data.name,
            "description": group_data.description,
            "settings": group_data.settings.model_dump() if group_data.settings else {},
        }

        created_group = await repo.create_group(db_group_data)
        return created_group

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating group: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/groups", response_model=List[AttendanceGroupResponse])
async def get_groups(
    active_only: bool = Query(True, description="Return only active groups"),
    repo: AttendanceRepository = Depends(get_repository),
):
    """Get all attendance groups"""
    try:
        groups = await repo.get_groups(active_only=active_only)
        return groups

    except Exception as e:
        logger.error(f"Error getting groups: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/groups/{group_id}", response_model=AttendanceGroupResponse)
async def get_group(
    group_id: str, repo: AttendanceRepository = Depends(get_repository)
):
    """Get a specific attendance group"""
    try:
        group = await repo.get_group(group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")

        return group

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting group {group_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.put("/groups/{group_id}", response_model=AttendanceGroupResponse)
async def update_group(
    group_id: str,
    updates: AttendanceGroupUpdate,
    repo: AttendanceRepository = Depends(get_repository),
):
    """Update an attendance group"""
    try:
        # Check if group exists
        existing_group = await repo.get_group(group_id)
        if not existing_group:
            raise HTTPException(status_code=404, detail="Group not found")

        # Prepare updates
        update_data = {}
        for field, value in updates.model_dump(exclude_unset=True).items():
            if field == "settings" and value:
                update_data[field] = value.model_dump()
            elif value is not None:
                update_data[field] = value

        if not update_data:
            return existing_group

        updated_group = await repo.update_group(group_id, update_data)
        if not updated_group:
            raise HTTPException(status_code=500, detail="Failed to update group")

        return updated_group

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating group {group_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/groups/{group_id}", response_model=SuccessResponse)
async def delete_group(
    group_id: str, repo: AttendanceRepository = Depends(get_repository)
):
    """Delete (deactivate) an attendance group"""
    try:
        success = await repo.delete_group(group_id)
        if not success:
            raise HTTPException(status_code=404, detail="Group not found")

        return SuccessResponse(message=f"Group {group_id} deleted successfully")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting group {group_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# Member Management Endpoints
@router.post("/members", response_model=AttendanceMemberResponse)
async def add_member(
    member_data: AttendanceMemberCreate,
    repo: AttendanceRepository = Depends(get_repository),
):
    """Add a new attendance member with auto-generated person_id if not provided"""
    try:
        # Check if group exists
        group = await repo.get_group(member_data.group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")

        # Prepare member data
        db_member_data = member_data.model_dump()

        if not member_data.person_id:
            service = AttendanceService(repo)
            generated_person_id = await service.generate_person_id(
                name=member_data.name, group_id=member_data.group_id
            )
            db_member_data["person_id"] = generated_person_id
        else:
            existing_member = await repo.get_member(member_data.person_id)
            if existing_member:
                raise HTTPException(
                    status_code=400,
                    detail=f"Person ID '{member_data.person_id}' already exists.",
                )

        added_member = await repo.add_member(db_member_data)
        return added_member

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding member: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/members/bulk", response_model=BulkMemberResponse)
async def add_members_bulk(
    bulk_data: BulkMemberCreate,
    repo: AttendanceRepository = Depends(get_repository),
):
    """Add multiple members in bulk"""
    try:
        success_count = 0
        error_count = 0
        errors = []

        for member_data in bulk_data.members:
            try:
                # Check if group exists
                group = await repo.get_group(member_data.group_id)
                if not group:
                    errors.append(
                        {
                            "person_id": member_data.person_id,
                            "error": f"Group {member_data.group_id} not found",
                        }
                    )
                    error_count += 1
                    continue

                # Add member
                db_member_data = member_data.model_dump()
                member = await repo.add_member(db_member_data)

                if member:
                    success_count += 1
                else:
                    errors.append(
                        {
                            "person_id": member_data.person_id,
                            "error": "Failed to add member to database",
                        }
                    )
                    error_count += 1

            except Exception as e:
                errors.append({"person_id": member_data.person_id, "error": str(e)})
                error_count += 1

        return BulkMemberResponse(
            success_count=success_count, error_count=error_count, errors=errors
        )

    except Exception as e:
        logger.error(f"Error in bulk member add: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/members/{person_id}", response_model=AttendanceMemberResponse)
async def get_member(
    person_id: str, repo: AttendanceRepository = Depends(get_repository)
):
    """Get a specific attendance member"""
    try:
        member = await repo.get_member(person_id)
        if not member:
            raise HTTPException(status_code=404, detail="Member not found")

        return member

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting member {person_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/groups/{group_id}/members", response_model=List[AttendanceMemberResponse])
async def get_group_members(
    group_id: str, repo: AttendanceRepository = Depends(get_repository)
):
    """Get all members of a specific group"""
    try:
        # Check if group exists
        group = await repo.get_group(group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")

        members = await repo.get_group_members(group_id)
        return members

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting group members for {group_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.put("/members/{person_id}", response_model=AttendanceMemberResponse)
async def update_member(
    person_id: str,
    updates: AttendanceMemberUpdate,
    repo: AttendanceRepository = Depends(get_repository),
):
    """Update an attendance member"""
    try:
        # Check if member exists
        existing_member = await repo.get_member(person_id)
        if not existing_member:
            raise HTTPException(status_code=404, detail="Member not found")

        # Prepare updates
        update_data = updates.model_dump(exclude_unset=True)

        if not update_data:
            return existing_member

        # If group_id is being updated, check if new group exists
        if "group_id" in update_data:
            group = await repo.get_group(update_data["group_id"])
            if not group:
                raise HTTPException(status_code=404, detail="New group not found")

        updated_member = await repo.update_member(person_id, update_data)
        if not updated_member:
            raise HTTPException(status_code=500, detail="Failed to update member")

        return updated_member

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating member {person_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/members/{person_id}", response_model=SuccessResponse)
async def remove_member(
    person_id: str, repo: AttendanceRepository = Depends(get_repository)
):
    """Remove (deactivate) an attendance member"""
    try:
        success = await repo.remove_member(person_id)
        if not success:
            raise HTTPException(status_code=404, detail="Member not found")

        return SuccessResponse(message=f"Member {person_id} removed successfully")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing member {person_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# Record Management Endpoints
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


# Session Management Endpoints
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
        # Only if we have enough info to recompute for a specific group/date range
        if group_id and start_date:
            group = await repo.get_group(group_id)
            if not group:
                raise HTTPException(status_code=404, detail="Group not found")

            late_threshold_minutes = (
                group.late_threshold_minutes
                if group.late_threshold_minutes is not None
                else 15
            )
            class_start_time = group.class_start_time or "08:00"
            late_threshold_enabled = group.late_threshold_enabled or False

            # Get members
            members = await repo.get_group_members(group_id)

            # Determine date range
            end_date_to_use = end_date or start_date

            # Parse dates
            start_datetime = datetime.strptime(start_date, "%Y-%m-%d")
            end_datetime = datetime.strptime(end_date_to_use, "%Y-%m-%d")

            # Compute sessions for each day in range
            computed_sessions = []
            current_date = start_datetime
            while current_date <= end_datetime:
                date_str = current_date.strftime("%Y-%m-%d")

                # Get records for this day
                day_start = current_date.replace(hour=0, minute=0, second=0)
                day_end = current_date.replace(hour=23, minute=59, second=59)

                records = await repo.get_records(
                    group_id=group_id, start_date=day_start, end_date=day_end
                )

                # Get existing sessions for this day to reuse IDs
                existing_day_sessions = [
                    s for s in sessions if s.date == date_str  # ORM access
                ]

                # Compute sessions for this day
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

                # Persist sessions to database
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


# Event Processing Endpoints
@router.post("/events", response_model=AttendanceEventResponse)
async def process_attendance_event(
    event_data: AttendanceEventCreate,
    repo: AttendanceRepository = Depends(get_repository),
):
    """Process an attendance event"""
    try:
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
            ws_manager=ws_manager
        )
        
        return await service.process_event(event_data, member, settings)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing attendance event: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# Settings Management Endpoints
@router.get("/settings", response_model=AttendanceSettingsResponse)
async def get_settings(repo: AttendanceRepository = Depends(get_repository)):
    """Get attendance settings"""
    try:
        settings = await repo.get_settings()
        return settings

    except Exception as e:
        logger.error(f"Error getting settings: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.put("/settings", response_model=AttendanceSettingsResponse)
async def update_settings(
    updates: AttendanceSettingsUpdate,
    repo: AttendanceRepository = Depends(get_repository),
):
    """Update attendance settings"""
    try:
        # Prepare updates
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

        # Retrieve updated settings
        updated_settings = await repo.get_settings()
        return updated_settings

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating settings: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# Statistics and Reports Endpoints
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
        class_start_time = group.class_start_time or "08:00"
        late_threshold_enabled = group.late_threshold_enabled or False

        # Get existing sessions for the target date
        sessions = await repo.get_sessions(
            group_id=group_id, start_date=target_date, end_date=target_date
        )

        # Check if we need to recompute sessions (missing or outdated)
        needs_recompute = not sessions
        if sessions:
            # Check if any session is missing check_in_time (indicates old data)
            for session in sessions:
                # session is an object not dict
                if session.status == "present" and session.check_in_time is None:
                    needs_recompute = True
                    break

        # If no sessions exist OR they need recomputation, compute them from records
        if needs_recompute:
            # Get attendance records for the target date
            target_datetime = datetime.strptime(target_date, "%Y-%m-%d")
            start_of_day = target_datetime.replace(hour=0, minute=0, second=0)
            end_of_day = target_datetime.replace(hour=23, minute=59, second=59)

            records = await repo.get_records(
                group_id=group_id, start_date=start_of_day, end_date=end_of_day
            )

            # Compute sessions from records using the group's settings
            service = AttendanceService(repo)
            session_dicts = service.compute_sessions_from_records(
                records=records,  # objects
                members=members,  # objects
                late_threshold_minutes=late_threshold_minutes,
                target_date=target_date,
                class_start_time=class_start_time,
                late_threshold_enabled=late_threshold_enabled,
                existing_sessions=sessions,  # objects
            )

            # Optionally, persist the computed sessions to database
            for session_data in session_dicts:
                await repo.upsert_session(session_data)

        # Re-fetch sessions to guarantee we have uniform objects?
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


# Group-Specific Person Management Endpoints
@router.get("/groups/{group_id}/persons", response_model=List[dict])
async def get_group_persons(
    group_id: str, repo: AttendanceRepository = Depends(get_repository)
):
    """Get all registered persons for a specific group"""
    try:
        # Check if group exists
        group = await repo.get_group(group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")

        # Get group members
        members = await repo.get_group_members(group_id)

        # For each member, get their face recognition data if available
        if not face_recognizer:
            return [
                {
                    "person_id": member.person_id,
                    "name": member.name,
                    "has_face_data": False,
                }
                for member in members
            ]

        persons_with_face_data = []
        all_persons = face_recognizer.get_all_persons()

        for member in members:
            has_face_data = member.person_id in all_persons
            persons_with_face_data.append(
                {
                    "person_id": member.person_id,
                    "name": member.name,
                    "role": member.role,
                    "email": member.email,
                    "has_face_data": has_face_data,
                    "joined_at": member.joined_at,
                }
            )

        return persons_with_face_data

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting group persons: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/groups/{group_id}/persons/{person_id}/register-face")
async def register_face_for_group_person(
    group_id: str,
    person_id: str,
    request: dict,
    repo: AttendanceRepository = Depends(get_repository),
):
    """Register face data for a specific person in a group with anti-duplicate protection"""
    try:
        service = AttendanceService(repo, face_recognizer=face_recognizer)
        try:
            return await service.register_face(group_id, person_id, request)
        except ValueError as e:
            if "not found" in str(e).lower():
                raise HTTPException(status_code=404, detail=str(e))
            else:
                raise HTTPException(status_code=400, detail=str(e))

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error registering face for group person: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/groups/{group_id}/persons/{person_id}/face-data")
async def remove_face_data_for_group_person(
    group_id: str,
    person_id: str,
    repo: AttendanceRepository = Depends(get_repository),
):
    """Remove face data for a specific person in a group"""
    try:
        service = AttendanceService(repo, face_recognizer=face_recognizer)
        try:
            return await service.remove_face_data(group_id, person_id)
        except ValueError as e:
            if "not found" in str(e).lower():
                raise HTTPException(status_code=404, detail=str(e))
            else:
                raise HTTPException(status_code=400, detail=str(e))

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing face data: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# Utility Endpoints
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


# Helper Functions



# Bulk Operations and rest of endpoints...
# Note: I omitted bulk_detect_faces and bulk_register_faces implementation for brevity in this scratchpad,
# KEY: I must include them or they will be lost.
# I will copy their logic using repo pattern.


@router.post("/groups/{group_id}/bulk-detect-faces")
async def bulk_detect_faces(
    group_id: str, request: dict, repo: AttendanceRepository = Depends(get_repository)
):
    """
    Detect faces in multiple uploaded images for bulk registration
    """
    try:
        images_data = request.get("images", [])
        if not images_data:
            raise HTTPException(status_code=400, detail="No images provided")

        service = AttendanceService(
            repo, face_detector=face_detector
        )
        return await service.bulk_detect_faces_in_images(group_id, images_data)

    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        else:
            raise HTTPException(status_code=400, detail=str(e))


@router.post("/groups/{group_id}/bulk-register-faces")
async def bulk_register_faces(
    group_id: str, request: dict, repo: AttendanceRepository = Depends(get_repository)
):
    registrations = request.get("registrations", [])
    if not registrations:
        raise HTTPException(status_code=400, detail="No registrations provided")

    service = AttendanceService(repo, face_recognizer=face_recognizer)
    try:
        return await service.bulk_register(group_id, registrations)
    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        else:
            raise HTTPException(status_code=400, detail=str(e))
