import logging
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import select

from api.schemas import (
    SuccessResponse,
    CleanupRequest,
    ExportDataResponse,
    ImportDataRequest,
    AttendanceGroupResponse,
    AttendanceMemberResponse,
    AttendanceRecordResponse,
    AttendanceSessionResponse,
    AttendanceSettingsResponse,
)
from api.deps import get_repository
from database.repository import AttendanceRepository
from database.models import (
    AttendanceMember as MemberModel,
    AttendanceRecord as RecordModel,
    AttendanceSession as SessionModel,
)

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

@router.post("/export", response_model=ExportDataResponse)
async def export_data(
    repo: AttendanceRepository = Depends(get_repository),
):
    """Export all attendance data as a structured snapshot for backup or cloud sync."""
    try:
        groups_orm = await repo.get_groups(active_only=False)
        settings_orm = await repo.get_settings()

        members_result = await repo.session.execute(
            select(MemberModel).where(MemberModel.is_deleted.is_(False))
        )
        members_orm = members_result.scalars().all()

        records_result = await repo.session.execute(
            select(RecordModel).order_by(RecordModel.timestamp.desc())
        )
        records_orm = records_result.scalars().all()

        sessions_result = await repo.session.execute(
            select(SessionModel).order_by(SessionModel.date.desc())
        )
        sessions_orm = sessions_result.scalars().all()

        return ExportDataResponse(
            groups=[AttendanceGroupResponse.model_validate(g, from_attributes=True) for g in groups_orm],
            members=[AttendanceMemberResponse.model_validate(m, from_attributes=True) for m in members_orm],
            records=[AttendanceRecordResponse.model_validate(r, from_attributes=True) for r in records_orm],
            sessions=[AttendanceSessionResponse.model_validate(s, from_attributes=True) for s in sessions_orm],
            settings=AttendanceSettingsResponse.model_validate(settings_orm, from_attributes=True),
            exported_at=datetime.now(),
        )

    except Exception as e:
        logger.error(f"Error exporting data: {e}")
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")

@router.post("/import", response_model=SuccessResponse)
async def import_data(
    import_request: ImportDataRequest,
    repo: AttendanceRepository = Depends(get_repository),
):
    """Import attendance data from a previous export. Idempotent — existing records are skipped."""
    try:
        data = import_request.data
        overwrite = import_request.overwrite_existing

        imported_groups = 0
        imported_members = 0
        imported_records = 0
        imported_sessions = 0
        skipped = 0

        # 1. Import groups
        for group in data.groups:
            existing = await repo.get_group(group.id)
            if existing and not overwrite:
                skipped += 1
                continue
            if not existing:
                await repo.create_group({
                    "id": group.id,
                    "name": group.name,
                    "description": group.description,
                    "settings": group.settings.model_dump() if group.settings else {},
                })
                imported_groups += 1
            else:
                await repo.update_group(group.id, {"name": group.name, "description": group.description})
                imported_groups += 1

        # 2. Import members
        for member in data.members:
            existing = await repo.get_member(member.person_id)
            if existing and not overwrite:
                skipped += 1
                continue
            if not existing:
                await repo.session.merge(MemberModel(
                    person_id=member.person_id,
                    group_id=member.group_id,
                    name=member.name,
                    role=member.role,
                    email=member.email,
                    is_active=member.is_active,
                    is_deleted=False,
                ))
                await repo.session.commit()
                imported_members += 1
            else:
                await repo.update_member(member.person_id, {
                    "name": member.name, "role": member.role, "email": member.email
                })
                imported_members += 1

        # 3. Import records
        for record in data.records:
            existing_result = await repo.session.execute(select(RecordModel).where(RecordModel.id == record.id))
            if existing_result.scalars().first() and not overwrite:
                skipped += 1
                continue
            await repo.add_record({
                "id": record.id,
                "person_id": record.person_id,
                "group_id": record.group_id,
                "timestamp": record.timestamp,
                "confidence": record.confidence,
                "location": record.location,
                "notes": record.notes,
                "is_manual": record.is_manual,
                "created_by": record.created_by,
            })
            imported_records += 1

        # 4. Import sessions
        for session in data.sessions:
            await repo.upsert_session({
                "id": session.id,
                "person_id": session.person_id,
                "group_id": session.group_id,
                "date": session.date,
                "check_in_time": session.check_in_time,
                "status": session.status,
                "is_late": session.is_late,
                "late_minutes": session.late_minutes,
                "notes": session.notes,
            })
            imported_sessions += 1

        return SuccessResponse(message=(
            f"Import complete: {imported_groups} groups, {imported_members} members, "
            f"{imported_records} records, {imported_sessions} sessions imported. "
            f"{skipped} items skipped (already exist)."
        ))

    except Exception as e:
        logger.error(f"Error importing data: {e}")
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")
