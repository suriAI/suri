import logging
from datetime import datetime, date
from typing import List, Optional
import uuid
import re

from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import JSONResponse

from models.attendance_models import (
    # Group models
    AttendanceGroupCreate, AttendanceGroupUpdate, AttendanceGroupResponse,
    # Member models
    AttendanceMemberCreate, AttendanceMemberUpdate, AttendanceMemberResponse,
    BulkMemberCreate, BulkMemberResponse,
    # Record models
    AttendanceRecordCreate, AttendanceRecordResponse, AttendanceRecordsQuery,
    # Session models
    AttendanceSessionResponse, AttendanceSessionsQuery,
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
    AttendanceType, GroupType, AttendanceStatus
)
from utils.attendance_database import AttendanceDatabaseManager

logger = logging.getLogger(__name__)

# Initialize router
router = APIRouter(prefix="/attendance", tags=["attendance"])

# Database manager instance (will be initialized in main.py)
attendance_db: Optional[AttendanceDatabaseManager] = None


def get_attendance_db() -> AttendanceDatabaseManager:
    """Dependency to get attendance database manager"""
    if attendance_db is None:
        raise HTTPException(status_code=500, detail="Attendance database not initialized")
    return attendance_db


def generate_id() -> str:
    """Generate a unique ID"""
    return str(uuid.uuid4())


def generate_person_id(name: str, group_type: str, db: AttendanceDatabaseManager, group_id: str = None) -> str:
    """
    Generate a secure, unique Person ID using ULID (Universally Unique Lexicographically Sortable Identifier)
    
    ULID provides:
    - 26 characters (vs UUID's 36)
    - Lexicographically sortable by timestamp
    - Cryptographically secure randomness (80 bits)
    - URL-safe and case-insensitive
    - No prefixes needed - clean, professional appearance
    - Database performance optimized - no index fragmentation
    
    Args:
        name: Full name of the person (not used in ID generation for security)
        group_type: Type of group (employee, student, visitor, general)
        db: Database manager instance
        group_id: Optional group ID for additional context
    
    Returns:
        str: Generated ULID that's unique, secure, and sortable
    """
    from ulid import ULID
    
    # Generate ULID - automatically handles uniqueness and security
    # ULID format: 01ARZ3NDEKTSV4RRFFQ69G5FAV (26 characters)
    # First 10 chars: timestamp (sortable)
    # Last 16 chars: cryptographically secure randomness
    ulid = ULID()
    person_id = str(ulid)
    
    # ULID collision probability is extremely low (similar to UUID v4)
    # But we'll add a safety check for absolute certainty
    max_attempts = 10  # Much lower since ULID collisions are virtually impossible
    attempt = 0
    
    while attempt < max_attempts:
        existing_member = db.get_member(person_id)
        if not existing_member:
            break
        
        # Generate new ULID if collision occurs (extremely unlikely)
        ulid = ULID()
        person_id = str(ulid)
        attempt += 1
    
    # If collision still exists (practically impossible), fallback to UUID
    if attempt >= max_attempts:
        person_id = str(uuid.uuid4()).replace('-', '').upper()[:26]
    
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
            "type": group_data.type.value,
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
            if field == "type" and value:
                update_data[field] = value.value
            elif field == "settings" and value:
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
                group_type=group['type'],
                db=db,
                group_id=member_data.group_id
            )
            db_member_data['person_id'] = generated_person_id
            logger.info(f"Auto-generated person_id: {generated_person_id} for member: {member_data.name}")
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
            "type": record_data.type.value,
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
    """Get attendance sessions with optional filters"""
    try:
        sessions = db.get_sessions(
            group_id=group_id,
            person_id=person_id,
            start_date=start_date,
            end_date=end_date
        )
        
        return [AttendanceSessionResponse(**session) for session in sessions]
        
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
        
        # Get current settings to check confidence threshold
        settings = db.get_settings()
        confidence_threshold = settings.get("confidence_threshold", 0.6)
        
        # Determine attendance type based on current session state
        today = datetime.now().date().strftime('%Y-%m-%d')
        session_id = f"{event_data.person_id}_{today}"
        current_session = db.get_session(event_data.person_id, today)
        
        # Determine attendance type
        attendance_type = _determine_attendance_type(current_session, settings)
        
        # Create attendance record
        record_id = generate_id()
        timestamp = datetime.now()
        
        record_data = {
            "id": record_id,
            "person_id": event_data.person_id,
            "group_id": member["group_id"],
            "timestamp": timestamp,
            "type": attendance_type.value,
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
        
        # Update session
        updated_session = _update_session_from_event(
            current_session, attendance_type, timestamp, member, settings
        )
        
        success = db.upsert_session(updated_session)
        if not success:
            logger.warning(f"Failed to update session for {event_data.person_id}")
        
        return AttendanceEventResponse(
            id=record_id,
            person_id=event_data.person_id,
            group_id=member["group_id"],
            type=attendance_type,
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
            if field == "default_group_type" and value:
                update_data[field] = value.value
            elif value is not None:
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
        
        # Get sessions for the target date
        sessions = db.get_sessions(
            group_id=group_id,
            start_date=target_date,
            end_date=target_date
        )
        
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
        from main import edgeface_detector
        if not edgeface_detector:
            return [{"person_id": member["person_id"], "name": member["name"], "has_face_data": False} for member in members]
        
        persons_with_face_data = []
        all_persons = edgeface_detector.get_all_persons()
        
        for member in members:
            has_face_data = member["person_id"] in all_persons
            persons_with_face_data.append({
                "person_id": member["person_id"],
                "name": member["name"],
                "role": member.get("role"),
                "employee_id": member.get("employee_id"),
                "student_id": member.get("student_id"),
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
        # Import required modules
        from main import edgeface_detector
        from utils.image_utils import decode_base64_image
        
        if not edgeface_detector:
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
        landmarks = request.get("landmarks")
        
        if not image_data:
            raise HTTPException(status_code=400, detail="Image data required")
        
        if not landmarks:
            raise HTTPException(status_code=400, detail="Facial landmarks required")
        
        try:
            image = decode_base64_image(image_data)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid image data: {str(e)}")
        
        # Anti-duplicate check: verify this person isn't already registered
        existing_persons = edgeface_detector.get_all_persons()
        if person_id in existing_persons:
            # Update existing registration
            logger.info(f"Updating existing face registration for {person_id}")
        else:
            logger.info(f"Creating new face registration for {person_id}")
        
        # Register the face with enhanced validation
        result = await edgeface_detector.register_person_async(
            person_id,
            image,
            landmarks
        )
        
        if result["success"]:
            return {
                "success": True,
                "message": f"Face registered successfully for {person_id} in group {group['name']}",
                "person_id": person_id,
                "group_id": group_id,
                "total_persons": result.get("total_persons", 0)
            }
        else:
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
        from main import edgeface_detector
        
        if not edgeface_detector:
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
        result = edgeface_detector.remove_person(person_id)
        
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
def _determine_attendance_type(current_session: Optional[dict], settings: dict) -> AttendanceType:
    """Determine the attendance type based on current session state"""
    if not current_session or not current_session.get("check_in"):
        return AttendanceType.CHECK_IN
    
    if current_session.get("status") == "on_break":
        return AttendanceType.BREAK_END
    
    if (current_session.get("status") == "present" and 
        settings.get("enable_break_tracking", True) and
        not current_session.get("break_start")):
        # Check if enough time has passed for a break
        check_in_time = current_session.get("check_in")
        if check_in_time:
            if isinstance(check_in_time, str):
                check_in_time = datetime.fromisoformat(check_in_time.replace('Z', '+00:00'))
            
            hours_worked = (datetime.now() - check_in_time).total_seconds() / 3600
            if hours_worked >= 4:  # Allow break after 4 hours
                return AttendanceType.BREAK_START
    
    return AttendanceType.CHECK_OUT


def _update_session_from_event(
    current_session: Optional[dict], 
    attendance_type: AttendanceType, 
    timestamp: datetime,
    member: dict,
    settings: dict
) -> dict:
    """Update session data based on attendance event"""
    today = timestamp.date().strftime('%Y-%m-%d')
    session_id = f"{member['person_id']}_{today}"
    
    if not current_session:
        current_session = {
            "id": session_id,
            "person_id": member["person_id"],
            "group_id": member["group_id"],
            "date": today,
            "status": "absent",
            "is_late": False
        }
    
    late_threshold = settings.get("late_threshold_minutes", 15)
    
    if attendance_type == AttendanceType.CHECK_IN:
        current_session["check_in"] = timestamp
        current_session["status"] = "present"
        
        # Check if late (assuming 9 AM start time)
        work_start = timestamp.replace(hour=9, minute=0, second=0, microsecond=0)
        if timestamp > work_start:
            late_minutes = (timestamp - work_start).total_seconds() / 60
            if late_minutes > late_threshold:
                current_session["is_late"] = True
                current_session["late_minutes"] = int(late_minutes)
                current_session["status"] = "late"
    
    elif attendance_type == AttendanceType.CHECK_OUT:
        current_session["check_out"] = timestamp
        current_session["status"] = "checked_out"
        
        # Calculate total hours
        if current_session.get("check_in"):
            check_in = current_session["check_in"]
            if isinstance(check_in, str):
                check_in = datetime.fromisoformat(check_in.replace('Z', '+00:00'))
            
            total_seconds = (timestamp - check_in).total_seconds()
            
            # Subtract break time if applicable
            if current_session.get("break_duration"):
                total_seconds -= current_session["break_duration"] * 60
            
            current_session["total_hours"] = round(total_seconds / 3600, 2)
    
    elif attendance_type == AttendanceType.BREAK_START:
        current_session["break_start"] = timestamp
        current_session["status"] = "on_break"
    
    elif attendance_type == AttendanceType.BREAK_END:
        current_session["break_end"] = timestamp
        current_session["status"] = "present"
        
        # Calculate break duration
        if current_session.get("break_start"):
            break_start = current_session["break_start"]
            if isinstance(break_start, str):
                break_start = datetime.fromisoformat(break_start.replace('Z', '+00:00'))
            
            break_duration = (timestamp - break_start).total_seconds() / 60
            current_session["break_duration"] = round(break_duration, 2)
    
    return current_session


def _calculate_group_stats(members: List[dict], sessions: List[dict]) -> dict:
    """Calculate group attendance statistics"""
    total_members = len(members)
    present_today = 0
    absent_today = 0
    late_today = 0
    on_break = 0
    total_hours = 0.0
    members_with_hours = 0
    
    # Create a map of sessions by person_id
    session_map = {session["person_id"]: session for session in sessions}
    
    for member in members:
        person_id = member["person_id"]
        session = session_map.get(person_id)
        
        if session:
            status = session.get("status", "absent")
            
            if status in ["present", "late", "checked_out"]:
                present_today += 1
                if session.get("is_late"):
                    late_today += 1
            elif status == "on_break":
                on_break += 1
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
        "on_break": on_break,
        "average_hours_today": round(average_hours, 2),
        "total_hours_today": round(total_hours, 2)
    }