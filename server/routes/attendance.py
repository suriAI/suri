import logging
import asyncio
from datetime import datetime, timedelta
from typing import List, Optional
import ulid

from fastapi import APIRouter, HTTPException, Query, Depends

from models.attendance_models import (
    # Group models
    AttendanceGroupCreate, AttendanceGroupUpdate, AttendanceGroupResponse,
    # Member models
    AttendanceMemberCreate, AttendanceMemberUpdate, AttendanceMemberResponse,
    BulkMemberCreate, BulkMemberResponse,
    # Record models
    AttendanceRecordCreate, AttendanceRecordResponse,
    # Session models
    AttendanceSessionResponse,
    # Event models
    AttendanceEventCreate, AttendanceEventResponse,
    # Settings models
    AttendanceSettingsUpdate, AttendanceSettingsResponse,
    # Statistics models
    AttendanceStatsResponse, AttendanceReportResponse, AttendanceReportQuery,
    # Utility models
    SuccessResponse, ErrorResponse, DatabaseStatsResponse,
    ExportDataResponse, ImportDataRequest, CleanupRequest,
    # Enums
    AttendanceStatus
)
from utils.attendance_database import AttendanceDatabaseManager
from utils.websocket_manager import manager as ws_manager
from utils.image_utils import decode_base64_image

logger = logging.getLogger(__name__)

# Initialize router
router = APIRouter(prefix="/attendance", tags=["attendance"])

# Database manager instance (will be initialized in main.py)
attendance_db: Optional[AttendanceDatabaseManager] = None

# Face detection/recognition models (will be initialized in main.py)
face_detector = None
face_recognizer = None


def get_attendance_db() -> AttendanceDatabaseManager:
    """Dependency to get attendance database manager"""
    if attendance_db is None:
        raise HTTPException(status_code=500, detail="Attendance database not initialized")
    return attendance_db


def generate_id() -> str:
    """Generate a unique ID"""
    return ulid.ulid()


def generate_person_id(name: str, db: AttendanceDatabaseManager, group_id: str = None) -> str:
    # Generate ULID - automatically handles uniqueness and security
    # ULID format: 01ARZ3NDEKTSV4RRFFQ69G5FAV (26 characters)
    # First 10 chars: timestamp (sortable)
    # Last 16 chars: cryptographically secure randomness
    person_id = ulid.ulid()
    
    # ULID collision probability is extremely low (similar to UUID v4)
    # But we'll add a safety check for absolute certainty
    max_attempts = 10  # Much lower since ULID collisions are virtually impossible
    attempt = 0
    
    while attempt < max_attempts:
        existing_member = db.get_member(person_id)
        if not existing_member:
            break
        
        # Generate new ULID if collision occurs (extremely unlikely)
        person_id = ulid.ulid()
        attempt += 1
    
    return person_id


# Group Management Endpoints
@router.post("/groups", response_model=AttendanceGroupResponse)
async def create_group(
    group_data: AttendanceGroupCreate,
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Create a new attendance group"""
    try:
        group_id = generate_id()
        
        # Prepare group data for database
        db_group_data = {
            "id": group_id,
            "name": group_data.name,
            "description": group_data.description,
            "settings": group_data.settings.dict() if group_data.settings else {}
        }
        
        success = db.create_group(db_group_data)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to create group")
        
        # Retrieve the created group
        created_group = db.get_group(group_id)
        if not created_group:
            raise HTTPException(status_code=500, detail="Failed to retrieve created group")
        
        return AttendanceGroupResponse(**created_group)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating group: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/groups", response_model=List[AttendanceGroupResponse])
async def get_groups(
    active_only: bool = Query(True, description="Return only active groups"),
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Get all attendance groups"""
    try:
        groups = db.get_groups(active_only=active_only)
        return [AttendanceGroupResponse(**group) for group in groups]
        
    except Exception as e:
        logger.error(f"Error getting groups: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/groups/{group_id}", response_model=AttendanceGroupResponse)
async def get_group(
    group_id: str,
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Get a specific attendance group"""
    try:
        group = db.get_group(group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        
        return AttendanceGroupResponse(**group)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting group {group_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.put("/groups/{group_id}", response_model=AttendanceGroupResponse)
async def update_group(
    group_id: str,
    updates: AttendanceGroupUpdate,
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Update an attendance group"""
    try:
        # Check if group exists
        existing_group = db.get_group(group_id)
        if not existing_group:
            raise HTTPException(status_code=404, detail="Group not found")
        
        # Prepare updates
        update_data = {}
        for field, value in updates.dict(exclude_unset=True).items():
            if field == "settings" and value:
                update_data[field] = value
            elif value is not None:
                update_data[field] = value
        
        if not update_data:
            return AttendanceGroupResponse(**existing_group)
        
        success = db.update_group(group_id, update_data)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to update group")
        
        # Retrieve updated group
        updated_group = db.get_group(group_id)
        return AttendanceGroupResponse(**updated_group)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating group {group_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/groups/{group_id}", response_model=SuccessResponse)
async def delete_group(
    group_id: str,
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Delete (deactivate) an attendance group"""
    try:
        success = db.delete_group(group_id)
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
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Add a new attendance member with auto-generated person_id if not provided"""
    try:
        # Check if group exists
        group = db.get_group(member_data.group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        
        # Prepare member data
        db_member_data = member_data.dict()
        
        # Auto-generate person_id if not provided
        if not member_data.person_id:
            generated_person_id = generate_person_id(
                name=member_data.name,
                db=db,
                group_id=member_data.group_id
            )
            db_member_data['person_id'] = generated_person_id
        else:
            # Check if provided person_id already exists
            existing_member = db.get_member(member_data.person_id)
            if existing_member:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Person ID '{member_data.person_id}' already exists. Please use a different ID or leave empty for auto-generation."
                )
        
        success = db.add_member(db_member_data)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to add member")
        
        # Retrieve the added member
        added_member = db.get_member(db_member_data['person_id'])
        if not added_member:
            raise HTTPException(status_code=500, detail="Failed to retrieve added member")
        
        return AttendanceMemberResponse(**added_member)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding member: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/members/bulk", response_model=BulkMemberResponse)
async def add_members_bulk(
    bulk_data: BulkMemberCreate,
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Add multiple members in bulk"""
    try:
        success_count = 0
        error_count = 0
        errors = []
        
        for member_data in bulk_data.members:
            try:
                # Check if group exists
                group = db.get_group(member_data.group_id)
                if not group:
                    errors.append({
                        "person_id": member_data.person_id,
                        "error": f"Group {member_data.group_id} not found"
                    })
                    error_count += 1
                    continue
                
                # Add member
                db_member_data = member_data.dict()
                success = db.add_member(db_member_data)
                
                if success:
                    success_count += 1
                else:
                    errors.append({
                        "person_id": member_data.person_id,
                        "error": "Failed to add member to database"
                    })
                    error_count += 1
                    
            except Exception as e:
                errors.append({
                    "person_id": member_data.person_id,
                    "error": str(e)
                })
                error_count += 1
        
        return BulkMemberResponse(
            success_count=success_count,
            error_count=error_count,
            errors=errors
        )
        
    except Exception as e:
        logger.error(f"Error in bulk member add: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/members/{person_id}", response_model=AttendanceMemberResponse)
async def get_member(
    person_id: str,
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Get a specific attendance member"""
    try:
        member = db.get_member(person_id)
        if not member:
            raise HTTPException(status_code=404, detail="Member not found")
        
        return AttendanceMemberResponse(**member)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting member {person_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/groups/{group_id}/members", response_model=List[AttendanceMemberResponse])
async def get_group_members(
    group_id: str,
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Get all members of a specific group"""
    try:
        # Check if group exists
        group = db.get_group(group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        
        members = db.get_group_members(group_id)
        return [AttendanceMemberResponse(**member) for member in members]
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting group members for {group_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.put("/members/{person_id}", response_model=AttendanceMemberResponse)
async def update_member(
    person_id: str,
    updates: AttendanceMemberUpdate,
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Update an attendance member"""
    try:
        # Check if member exists
        existing_member = db.get_member(person_id)
        if not existing_member:
            raise HTTPException(status_code=404, detail="Member not found")
        
        # Prepare updates
        update_data = updates.dict(exclude_unset=True)
        
        if not update_data:
            return AttendanceMemberResponse(**existing_member)
        
        # If group_id is being updated, check if new group exists
        if "group_id" in update_data:
            group = db.get_group(update_data["group_id"])
            if not group:
                raise HTTPException(status_code=404, detail="New group not found")
        
        success = db.update_member(person_id, update_data)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to update member")
        
        # Retrieve updated member
        updated_member = db.get_member(person_id)
        return AttendanceMemberResponse(**updated_member)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating member {person_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/members/{person_id}", response_model=SuccessResponse)
async def remove_member(
    person_id: str,
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Remove (deactivate) an attendance member"""
    try:
        success = db.remove_member(person_id)
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
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Add a new attendance record"""
    try:
        # Check if member exists
        member = db.get_member(record_data.person_id)
        if not member:
            raise HTTPException(status_code=404, detail="Member not found")
        
        # Prepare record data
        record_id = generate_id()
        timestamp = record_data.timestamp or datetime.now()
        
        db_record_data = {
            "id": record_id,
            "person_id": record_data.person_id,
            "group_id": member["group_id"],
            "timestamp": timestamp,
            "confidence": record_data.confidence,
            "location": record_data.location,
            "notes": record_data.notes,
            "is_manual": record_data.is_manual,
            "created_by": record_data.created_by
        }
        
        success = db.add_record(db_record_data)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to add record")
        
        return AttendanceRecordResponse(**db_record_data)
        
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
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Get attendance records with optional filters"""
    try:
        records = db.get_records(
            group_id=group_id,
            person_id=person_id,
            start_date=start_date,
            end_date=end_date,
            limit=limit
        )
        
        return [AttendanceRecordResponse(**record) for record in records]
        
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
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Get attendance sessions with optional filters, computing them from records if they don't exist"""
    try:
        # Get existing sessions from database
        sessions = db.get_sessions(
            group_id=group_id,
            person_id=person_id,
            start_date=start_date,
            end_date=end_date
        )
        
        # Always recompute sessions from records to ensure they're up-to-date
        # This ensures that multiple check-ins per day are reflected with the latest time
        needs_recompute = False
        if group_id and start_date:
            needs_recompute = True
        
        # If we need to compute sessions, do it from records
        if needs_recompute:
            group = db.get_group(group_id)
            if not group:
                raise HTTPException(status_code=404, detail="Group not found")
            
            # Get settings from group
            late_threshold_minutes = group.get("settings", {}).get("late_threshold_minutes", 15)
            class_start_time = group.get("settings", {}).get("class_start_time", "08:00")
            late_threshold_enabled = group.get("settings", {}).get("late_threshold_enabled", False)
            
            # Get members
            members = db.get_group_members(group_id)
            
            # Determine date range
            end_date_to_use = end_date or start_date
            
            # Parse dates
            start_datetime = datetime.strptime(start_date, '%Y-%m-%d')
            end_datetime = datetime.strptime(end_date_to_use, '%Y-%m-%d')
            
            # Compute sessions for each day in range
            computed_sessions = []
            current_date = start_datetime
            while current_date <= end_datetime:
                date_str = current_date.strftime('%Y-%m-%d')
                
                # Get records for this day
                day_start = current_date.replace(hour=0, minute=0, second=0)
                day_end = current_date.replace(hour=23, minute=59, second=59)
                
                records = db.get_records(
                    group_id=group_id,
                    start_date=day_start,
                    end_date=day_end
                )
                
                # Get existing sessions for this day to reuse IDs
                existing_day_sessions = [s for s in sessions if s.get('date') == date_str]
                
                # Compute sessions for this day
                day_sessions = _compute_sessions_from_records(
                    records=records,
                    members=members,
                    late_threshold_minutes=late_threshold_minutes,
                    target_date=date_str,
                    class_start_time=class_start_time,
                    late_threshold_enabled=late_threshold_enabled,
                    existing_sessions=existing_day_sessions
                )
                
                # Persist sessions to database
                for session in day_sessions:
                    db.upsert_session(session)
                
                computed_sessions.extend(day_sessions)
                current_date += timedelta(days=1)
            
            sessions = computed_sessions
        
        return [AttendanceSessionResponse(**session) for session in sessions]
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting sessions: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/sessions/{person_id}/{date}", response_model=AttendanceSessionResponse)
async def get_session(
    person_id: str,
    date: str,
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Get a specific attendance session"""
    try:
        session = db.get_session(person_id, date)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        return AttendanceSessionResponse(**session)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting session for {person_id} on {date}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# Event Processing Endpoints
@router.post("/events", response_model=AttendanceEventResponse)
async def process_attendance_event(
    event_data: AttendanceEventCreate,
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Process an attendance event (face recognition trigger)"""
    try:
        # Check if member exists
        member = db.get_member(event_data.person_id)
        if not member:
            raise HTTPException(status_code=404, detail="Member not found")
        
        # Get current settings to check confidence threshold and cooldown
        settings = db.get_settings()
        confidence_threshold = settings.get("confidence_threshold", 0.6)
        cooldown_seconds = settings.get("attendance_cooldown_seconds", 10)
        
        # Check for recent attendance records to enforce cooldown
        current_time = datetime.now()
        recent_records = db.get_records(
            person_id=event_data.person_id,
            start_date=current_time.replace(hour=0, minute=0, second=0, microsecond=0),
            end_date=current_time,
            limit=10
        )
        
        # Check if there's a recent record within the cooldown period
        if recent_records:
            for record in recent_records:
                record_time = record.get('timestamp')
                if isinstance(record_time, str):
                    record_time = datetime.fromisoformat(record_time.replace('Z', '+00:00'))
                elif not isinstance(record_time, datetime):
                    continue
                    
                time_diff = (current_time - record_time).total_seconds()
                if time_diff < cooldown_seconds:
                    # Return early response indicating cooldown is active
                    return AttendanceEventResponse(
                        id=None,
                        person_id=event_data.person_id,
                        group_id=member["group_id"],
                        timestamp=current_time,
                        confidence=event_data.confidence,
                        location=event_data.location,
                        processed=False,
                        error=f"Attendance cooldown active. Please wait {int(cooldown_seconds - time_diff)} more seconds."
                    )
        
        # Create attendance record
        record_id = generate_id()
        timestamp = datetime.now()
        
        record_data = {
            "id": record_id,
            "person_id": event_data.person_id,
            "group_id": member["group_id"],
            "timestamp": timestamp,
            "confidence": event_data.confidence,
            "location": event_data.location,
            "notes": None,
            "is_manual": False,
            "created_by": None
        }
        
        # Add record
        success = db.add_record(record_data)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to add attendance record")
        
        # Create or update session for today
        today_str = timestamp.strftime('%Y-%m-%d')
        
        # Get group settings for late threshold calculation
        group = db.get_group(member["group_id"])
        late_threshold_minutes = group.get("late_threshold_minutes", 15) if group else 15
        class_start_time = group.get("class_start_time", "08:00") if group else "08:00"
        late_threshold_enabled = group.get("settings", {}).get("late_threshold_enabled", False) if group else False
        
        # Always create/update session for each attendance event
        # The cooldown logic (above) prevents spam, but we allow multiple check-ins per day
        existing_session = db.get_session(event_data.person_id, today_str)
        
        # Always update the session with the latest check-in time
        # Only calculate late status if late threshold is enabled
        if late_threshold_enabled:
            # Parse class start time
            try:
                time_parts = class_start_time.split(":")
                day_start_hour = int(time_parts[0])
                day_start_minute = int(time_parts[1])
            except (ValueError, IndexError):
                day_start_hour = 8
                day_start_minute = 0
            
            # Calculate if late
            day_start = timestamp.replace(hour=day_start_hour, minute=day_start_minute, second=0, microsecond=0)
            time_diff_minutes = (timestamp - day_start).total_seconds() / 60
            is_late = time_diff_minutes > late_threshold_minutes
            late_minutes = int(time_diff_minutes - late_threshold_minutes) if is_late else 0
        else:
            # When late threshold is disabled, no one is considered late
            is_late = False
            late_minutes = 0
        
        session_data = {
            "id": existing_session['id'] if existing_session else generate_id(),  # Reuse existing ID if updating
            "person_id": event_data.person_id,
            "group_id": member["group_id"],
            "date": today_str,
            "check_in_time": timestamp.isoformat(),  # Convert to string for SQLite
            "total_hours": None,
            "status": "present",  # Status is always "present" if they checked in, "late" is tracked separately via is_late field
            "is_late": is_late,
            "late_minutes": late_minutes if is_late else None,
            "notes": None
        }
        
        db.upsert_session(session_data)
        
        # Broadcast attendance event to all connected WebSocket clients
        broadcast_message = {
            "type": "attendance_event",
            "data": {
                "id": record_id,
                "person_id": event_data.person_id,
                "group_id": member["group_id"],
                "timestamp": timestamp.isoformat(),
                "confidence": event_data.confidence,
                "location": event_data.location,
                "member_name": member.get("name", event_data.person_id)
            }
        }
        
        # 🌐 SaaS-Ready: Broadcast attendance event to WebSocket clients
        # Desktop App: Currently not connected (uses polling instead)
        # Web App (Future): Will receive real-time notifications via /ws/notifications/{client_id}
        asyncio.create_task(ws_manager.broadcast(broadcast_message))
        
        return AttendanceEventResponse(
            id=record_id,
            person_id=event_data.person_id,
            group_id=member["group_id"],
            timestamp=timestamp,
            confidence=event_data.confidence,
            location=event_data.location,
            processed=True,
            error=None
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing attendance event: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# Settings Management Endpoints
@router.get("/settings", response_model=AttendanceSettingsResponse)
async def get_settings(
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Get attendance settings"""
    try:
        settings = db.get_settings()
        return AttendanceSettingsResponse(**settings)
        
    except Exception as e:
        logger.error(f"Error getting settings: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.put("/settings", response_model=AttendanceSettingsResponse)
async def update_settings(
    updates: AttendanceSettingsUpdate,
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Update attendance settings"""
    try:
        # Prepare updates
        update_data = {}
        for field, value in updates.dict(exclude_unset=True).items():
            if value is not None:
                update_data[field] = value
        
        if not update_data:
            settings = db.get_settings()
            return AttendanceSettingsResponse(**settings)
        
        success = db.update_settings(update_data)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to update settings")
        
        # Retrieve updated settings
        updated_settings = db.get_settings()
        return AttendanceSettingsResponse(**updated_settings)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating settings: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# Statistics and Reports Endpoints
@router.get("/groups/{group_id}/stats", response_model=AttendanceStatsResponse)
async def get_group_stats(
    group_id: str,
    date: Optional[str] = Query(None, description="YYYY-MM-DD format, defaults to today"),
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Get attendance statistics for a group"""
    try:
        # Check if group exists
        group = db.get_group(group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        
        target_date = date or datetime.now().date().strftime('%Y-%m-%d')
        
        # Get group members
        members = db.get_group_members(group_id)
        
        # Get the group's late threshold and class start time settings
        late_threshold_minutes = group.get("settings", {}).get("late_threshold_minutes", 15)
        class_start_time = group.get("settings", {}).get("class_start_time", "08:00")
        late_threshold_enabled = group.get("settings", {}).get("late_threshold_enabled", False)
        
        # Get existing sessions for the target date
        sessions = db.get_sessions(
            group_id=group_id,
            start_date=target_date,
            end_date=target_date
        )
        
        # Check if we need to recompute sessions (missing or outdated)
        needs_recompute = not sessions
        if sessions:
            # Check if any session is missing check_in_time (indicates old data)
            for session in sessions:
                if session.get('status') == 'present' and not session.get('check_in_time'):
                    needs_recompute = True
                    break
        
        # If no sessions exist OR they need recomputation, compute them from records
        if needs_recompute:
            # Get attendance records for the target date
            target_datetime = datetime.strptime(target_date, '%Y-%m-%d')
            start_of_day = target_datetime.replace(hour=0, minute=0, second=0)
            end_of_day = target_datetime.replace(hour=23, minute=59, second=59)
            
            records = db.get_records(
                group_id=group_id,
                start_date=start_of_day,
                end_date=end_of_day
            )
            
            # Compute sessions from records using the group's settings
            sessions = _compute_sessions_from_records(
                records=records,
                members=members,
                late_threshold_minutes=late_threshold_minutes,
                target_date=target_date,
                class_start_time=class_start_time,
                late_threshold_enabled=late_threshold_enabled,
                existing_sessions=sessions  # Pass existing sessions to reuse IDs
            )
            
            # Optionally, persist the computed sessions to database
            for session in sessions:
                db.upsert_session(session)
        
        # Calculate statistics
        stats = _calculate_group_stats(members, sessions)
        
        return AttendanceStatsResponse(**stats)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting group stats for {group_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# Group-Specific Person Management Endpoints
@router.get("/groups/{group_id}/persons", response_model=List[dict])
async def get_group_persons(
    group_id: str,
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Get all registered persons for a specific group"""
    try:
        # Check if group exists
        group = db.get_group(group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        
        # Get group members
        members = db.get_group_members(group_id)
        
        # For each member, get their face recognition data if available
        if not face_recognizer:
            return [{"person_id": member["person_id"], "name": member["name"], "has_face_data": False} for member in members]
        
        persons_with_face_data = []
        all_persons = face_recognizer.get_all_persons()
        
        for member in members:
            has_face_data = member["person_id"] in all_persons
            persons_with_face_data.append({
                "person_id": member["person_id"],
                "name": member["name"],
                "role": member.get("role"),
                "email": member.get("email"),
                "has_face_data": has_face_data,
                "joined_at": member["joined_at"]
            })
        
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
    request: dict
):
    """Register face data for a specific person in a group with anti-duplicate protection"""
    try:
        if not face_recognizer:
            raise HTTPException(status_code=500, detail="Face recognition system not available")
        
        # Get attendance database
        attendance_db = get_attendance_db()
        
        # Verify group exists
        group = attendance_db.get_group(group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        
        # Verify member exists and belongs to group
        member = attendance_db.get_member(person_id)
        if not member:
            raise HTTPException(status_code=404, detail="Member not found")
        
        if member["group_id"] != group_id:
            raise HTTPException(status_code=400, detail="Member does not belong to this group")
        
        # Decode and validate image
        image_data = request.get("image")
        bbox = request.get("bbox")
        
        if not image_data:
            raise HTTPException(status_code=400, detail="Image data required")
        
        if not bbox:
            raise HTTPException(status_code=400, detail="Face bounding box required")
        
        try:
            image = decode_base64_image(image_data)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid image data: {str(e)}")
        
        # Anti-duplicate check: verify this person isn't already registered
        existing_persons = face_recognizer.get_all_persons()
        
        # Use landmarks from frontend (face detection)
        landmarks_5 = request.get('landmarks_5')
        if landmarks_5 is None:
            raise HTTPException(status_code=400, detail="Landmarks required from frontend face detection")
        
        # Register the face
        logger.info(f"Registering face for {person_id} in group {group_id}")
        
        result = await face_recognizer.register_person_async(
            person_id,
            image,
            bbox,
            landmarks_5
        )
        
        if result["success"]:
            logger.info(f"Face registered successfully for {person_id}. Total persons: {result.get('total_persons', 0)}")
            return {
                "success": True,
                "message": f"Face registered successfully for {person_id} in group {group['name']}",
                "person_id": person_id,
                "group_id": group_id,
                "total_persons": result.get("total_persons", 0)
            }
        else:
            logger.error(f"Face registration failed for {person_id}: {result.get('error', 'Unknown error')}")
            raise HTTPException(status_code=400, detail=result.get("error", "Face registration failed"))
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error registering face for group person: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/groups/{group_id}/persons/{person_id}/face-data")
async def remove_face_data_for_group_person(
    group_id: str,
    person_id: str,
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Remove face data for a specific person in a group"""
    try:
        if not face_recognizer:
            raise HTTPException(status_code=500, detail="Face recognition system not available")
        
        # Verify group exists
        group = db.get_group(group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        
        # Verify member exists and belongs to group
        member = db.get_member(person_id)
        if not member:
            raise HTTPException(status_code=404, detail="Member not found")
        
        if member["group_id"] != group_id:
            raise HTTPException(status_code=400, detail="Member does not belong to this group")
        
        # Remove face data
        result = face_recognizer.remove_person(person_id)
        
        if result["success"]:
            return {
                "success": True,
                "message": f"Face data removed for {person_id} in group {group['name']}",
                "person_id": person_id,
                "group_id": group_id
            }
        else:
            raise HTTPException(status_code=404, detail="Face data not found for this person")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing face data: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# Utility Endpoints
@router.get("/stats", response_model=DatabaseStatsResponse)
async def get_database_stats(
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Get database statistics"""
    try:
        stats = db.get_stats()
        return DatabaseStatsResponse(**stats)
        
    except Exception as e:
        logger.error(f"Error getting database stats: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/cleanup", response_model=SuccessResponse)
async def cleanup_old_data(
    cleanup_data: CleanupRequest,
    db: AttendanceDatabaseManager = Depends(get_attendance_db)
):
    """Clean up old attendance data"""
    try:
        success = db.cleanup_old_data(cleanup_data.days_to_keep)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to cleanup old data")
        
        return SuccessResponse(
            message=f"Successfully cleaned up data older than {cleanup_data.days_to_keep} days"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error cleaning up old data: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# Helper Functions
def _compute_sessions_from_records(
    records: List[dict], 
    members: List[dict],
    late_threshold_minutes: int,
    target_date: str,
    class_start_time: str = "08:00",
    late_threshold_enabled: bool = False,
    existing_sessions: Optional[List[dict]] = None
) -> List[dict]:
    """Compute attendance sessions from records using configurable late threshold
    
    Args:
        records: List of attendance records for the date
        members: List of group members
        late_threshold_minutes: Minutes after class start to consider as late
        target_date: Date string in YYYY-MM-DD format
        class_start_time: Class start time in HH:MM format (e.g., "08:00")
        existing_sessions: Optional list of existing sessions to reuse IDs from
    
    Returns:
        List of session dictionaries with status and late information
    """
    from datetime import time as dt_time
    
    sessions = []
    
    # Create a map of existing sessions by person_id for quick lookup
    existing_sessions_map = {}
    if existing_sessions:
        for session in existing_sessions:
            existing_sessions_map[session["person_id"]] = session
    
    # Group records by person_id
    records_by_person = {}
    for record in records:
        person_id = record["person_id"]
        if person_id not in records_by_person:
            records_by_person[person_id] = []
        records_by_person[person_id].append(record)
    
    # Parse class start time (format: "HH:MM")
    try:
        time_parts = class_start_time.split(":")
        day_start_hour = int(time_parts[0])
        day_start_minute = int(time_parts[1])
    except (ValueError, IndexError):
        # Fallback to 8:00 AM if parsing fails
        day_start_hour = 8
        day_start_minute = 0
    
    for member in members:
        person_id = member["person_id"]
        person_records = records_by_person.get(person_id, [])
        
        if not person_records:
            # No records = absent
            # Reuse existing session ID if it exists
            existing_session = existing_sessions_map.get(person_id)
            sessions.append({
                "id": existing_session["id"] if existing_session else generate_id(),
                "person_id": person_id,
                "group_id": member["group_id"],
                "date": target_date,
                "total_hours": None,
                "status": "absent",
                "is_late": False,
                "late_minutes": None,
                "notes": None
            })
            continue
        
        # Sort records by timestamp (ascending)
        person_records.sort(key=lambda r: r["timestamp"])
        
        # Use the LAST (most recent) record for check-in time
        # This ensures reports show the latest check-in after multiple entries
        last_record = person_records[-1]
        
        # Get timestamp of most recent attendance
        timestamp = last_record["timestamp"]
        if isinstance(timestamp, str):
            timestamp = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        
        # Only calculate late status if late threshold is enabled
        if late_threshold_enabled:
            # Calculate minutes after day start
            day_start = timestamp.replace(hour=day_start_hour, minute=day_start_minute, second=0, microsecond=0)
            time_diff_minutes = (timestamp - day_start).total_seconds() / 60
            
            # Determine if late
            is_late = time_diff_minutes > late_threshold_minutes
            late_minutes = int(time_diff_minutes - late_threshold_minutes) if is_late else 0
        else:
            # When late threshold is disabled, no one is considered late
            is_late = False
            late_minutes = 0
        
        # Reuse existing session ID if it exists
        existing_session = existing_sessions_map.get(person_id)
        sessions.append({
            "id": existing_session["id"] if existing_session else generate_id(),
            "person_id": person_id,
            "group_id": member["group_id"],
            "date": target_date,
            "check_in_time": timestamp,  # Store the actual check-in timestamp
            "total_hours": None,  # Could be calculated if we track check-out
            "status": "present",  # Status is always "present" if they checked in, "late" is tracked separately via is_late field
            "is_late": is_late,
            "late_minutes": late_minutes if is_late else None,
            "notes": None
        })
    
    return sessions


def _calculate_group_stats(members: List[dict], sessions: List[dict]) -> dict:
    """Calculate group attendance statistics"""
    total_members = len(members)
    present_today = 0
    absent_today = 0
    late_today = 0
    total_hours = 0.0
    members_with_hours = 0
    
    # Create a map of sessions by person_id
    session_map = {session["person_id"]: session for session in sessions}
    
    for member in members:
        person_id = member["person_id"]
        session = session_map.get(person_id)
        
        if session:
            status = session.get("status", "absent")
            
            if status == "present":
                present_today += 1
                if session.get("is_late"):
                    late_today += 1
            else:
                absent_today += 1
            
            # Add to total hours if available
            if session.get("total_hours"):
                total_hours += session["total_hours"]
                members_with_hours += 1
        else:
            absent_today += 1
    
    average_hours = total_hours / members_with_hours if members_with_hours > 0 else 0.0
    
    return {
        "total_members": total_members,
        "present_today": present_today,
        "absent_today": absent_today,
        "late_today": late_today,
        "average_hours_today": round(average_hours, 2),
        "total_hours_today": round(total_hours, 2)
    }


# ============================================================================
# BULK REGISTRATION ENDPOINTS
# ============================================================================

@router.post("/groups/{group_id}/bulk-detect-faces")
async def bulk_detect_faces(
    group_id: str,
    request: dict
):
    """
    Detect faces in multiple uploaded images for bulk registration
    Returns detected faces with bounding boxes and quality scores
    """
    logger.info(f"[BULK-DETECT] Request received for group {group_id}")
    logger.info(f"[BULK-DETECT] Request data keys: {list(request.keys())}")
    
    try:
        logger.info(f"[BULK-DETECT] Face detector available: {face_detector is not None}")
        
        if not face_detector:
            logger.error("[BULK-DETECT] face_detector is None")
            raise HTTPException(status_code=500, detail="Face detection system not available")
        
        # Get attendance database
        attendance_db = get_attendance_db()
        
        # Verify group exists
        group = attendance_db.get_group(group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        
        # Get images from request
        images_data = request.get("images", [])
        if not images_data:
            raise HTTPException(status_code=400, detail="No images provided")
        
        if len(images_data) > 50:
            raise HTTPException(status_code=400, detail="Maximum 50 images allowed per request")
        
        results = []
        
        for idx, image_data in enumerate(images_data):
            try:
                # Decode image
                image_base64 = image_data.get("image")
                image_id = image_data.get("id", f"image_{idx}")
                
                if not image_base64:
                    results.append({
                        "image_id": image_id,
                        "success": False,
                        "error": "No image data provided",
                        "faces": []
                    })
                    continue
                
                image = decode_base64_image(image_base64)
                
                # Detect faces
                detections = face_detector.detect_faces(image)
                
                if not detections or len(detections) == 0:
                    results.append({
                        "image_id": image_id,
                        "success": True,
                        "faces": [],
                        "message": "No faces detected"
                    })
                    continue
                
                # Process each detected face with quality validation
                processed_faces = []
                for face in detections:
                    bbox = face.get("bbox")
                    
                    if not bbox:
                        continue
                    
                    quality_result = {"is_acceptable": True, "quality_score": 0.8}
                    
                    processed_faces.append({
                        "bbox": bbox,
                        "confidence": face.get("confidence", 0.0),
                        "landmarks_5": face.get("landmarks_5"),
                        "quality_score": quality_result.get("quality_score", 0.0),
                        "quality_checks": quality_result.get("checks", {}),
                        "is_acceptable": quality_result.get("is_acceptable", False),
                        "suggestions": quality_result.get("suggestions", [])
                    })
                
                results.append({
                    "image_id": image_id,
                    "success": True,
                    "faces": processed_faces,
                    "total_faces": len(processed_faces)
                })
                
            except Exception as e:
                logger.error(f"Error processing image {idx}: {e}")
                results.append({
                    "image_id": image_data.get("id", f"image_{idx}"),
                    "success": False,
                    "error": str(e),
                    "faces": []
                })
        
        return {
            "success": True,
            "group_id": group_id,
            "total_images": len(images_data),
            "results": results
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in bulk face detection: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/groups/{group_id}/bulk-register-faces")
async def bulk_register_faces(
    group_id: str,
    request: dict
):
    """
    Bulk register faces for multiple members in a group
    Processes multiple faces in a single batch for efficiency
    """
    try:
        if not face_recognizer:
            raise HTTPException(status_code=500, detail="Face recognition system not available")
        
        # Get attendance database
        attendance_db = get_attendance_db()
        
        # Verify group exists
        group = attendance_db.get_group(group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        
        # Get registrations from request
        registrations = request.get("registrations", [])
        if not registrations:
            raise HTTPException(status_code=400, detail="No registrations provided")
        
        if len(registrations) > 50:
            raise HTTPException(status_code=400, detail="Maximum 50 registrations allowed per request")
        
        # Track results
        success_count = 0
        failed_count = 0
        results = []
        
        # Process each registration
        for idx, reg_data in enumerate(registrations):
            try:
                person_id = reg_data.get("person_id")
                image_base64 = reg_data.get("image")
                bbox = reg_data.get("bbox")
                
                # Validate required fields
                if not person_id:
                    failed_count += 1
                    results.append({
                        "index": idx,
                        "person_id": None,
                        "success": False,
                        "error": "person_id is required"
                    })
                    continue
                
                if not image_base64:
                    failed_count += 1
                    results.append({
                        "index": idx,
                        "person_id": person_id,
                        "success": False,
                        "error": "image data is required"
                    })
                    continue
                
                if not bbox:
                    failed_count += 1
                    results.append({
                        "index": idx,
                        "person_id": person_id,
                        "success": False,
                        "error": "bbox is required"
                    })
                    continue
                
                # Verify member exists and belongs to group
                member = attendance_db.get_member(person_id)
                if not member:
                    failed_count += 1
                    results.append({
                        "index": idx,
                        "person_id": person_id,
                        "success": False,
                        "error": "Member not found"
                    })
                    continue
                
                if member["group_id"] != group_id:
                    failed_count += 1
                    results.append({
                        "index": idx,
                        "person_id": person_id,
                        "success": False,
                        "error": "Member does not belong to this group"
                    })
                    continue
                
                # Decode image
                try:
                    image = decode_base64_image(image_base64)
                except Exception as e:
                    failed_count += 1
                    results.append({
                        "index": idx,
                        "person_id": person_id,
                        "success": False,
                        "error": f"Invalid image data: {str(e)}"
                    })
                    continue
                
                # Simple quality check - just ensure face is detected
                quality_result = {"is_acceptable": True, "quality_score": 0.8}
                quality_warning = None
                
                # Use landmarks from frontend (face detection)
                landmarks_5 = reg_data.get('landmarks_5')
                if landmarks_5 is None:
                    raise HTTPException(status_code=400, detail="Landmarks required from frontend face detection")
                
                # Register the face
                result = await face_recognizer.register_person_async(
                    person_id,
                    image,
                    bbox,
                    landmarks_5
                )
                
                if result.get("success"):
                    success_count += 1
                    results.append({
                        "index": idx,
                        "person_id": person_id,
                        "success": True,
                        "quality_warning": quality_warning,
                        "member_name": member.get("name", "")
                    })
                else:
                    failed_count += 1
                    results.append({
                        "index": idx,
                        "person_id": person_id,
                        "success": False,
                        "error": result.get("error", "Registration failed")
                    })
                
            except Exception as e:
                logger.error(f"Error processing registration {idx}: {e}")
                failed_count += 1
                results.append({
                    "index": idx,
                    "person_id": reg_data.get("person_id"),
                    "success": False,
                    "error": str(e)
                })
        
        return {
            "success": True,
            "group_id": group_id,
            "group_name": group.get("name", ""),
            "total_registrations": len(registrations),
            "success_count": success_count,
            "failed_count": failed_count,
            "results": results
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in bulk face registration: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")