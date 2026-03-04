"""Backup export / import routes — attendance data + face embeddings. Encryption is handled by the Electron layer."""

import base64
import logging
from datetime import datetime
from typing import List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy import select

from api.deps import get_repository
from database.repository import AttendanceRepository
from database.models import (
    AttendanceGroup as GroupModel,
    AttendanceMember as MemberModel,
    AttendanceRecord as RecordModel,
    AttendanceSession as SessionModel,
    Face as FaceModel,
)
from api.schemas import (
    AttendanceGroupResponse,
    AttendanceMemberResponse,
    AttendanceRecordResponse,
    AttendanceSessionResponse,
    AttendanceSettingsResponse,
    ExportDataResponse,
    ImportDataRequest,
    SuccessResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/vault", tags=["vault"])



# Schemas


class BiometricEntry(BaseModel):
    person_id: str
    embedding_b64: str  # base64-encoded raw float32 bytes
    embedding_dim: int


class VaultExportResponse(BaseModel):
    version: int = 1
    exported_at: str
    attendance: ExportDataResponse
    biometrics: List[BiometricEntry]


class VaultImportRequest(BaseModel):
    version: int = 1
    exported_at: Optional[str] = None
    attendance: ImportDataRequest
    biometrics: List[BiometricEntry]



# Routes


@router.post("/export", response_model=VaultExportResponse)
async def export_vault(
    repo: AttendanceRepository = Depends(get_repository),
):
    """
    Export complete system state: attendance data + face embeddings.
    Returns plain JSON — encryption is handled by the Electron layer.
    """
    try:
        # Gather attendance data
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

        attendance_data = ExportDataResponse(
            groups=[
                AttendanceGroupResponse.model_validate(g, from_attributes=True)
                for g in groups_orm
            ],
            members=[
                AttendanceMemberResponse.model_validate(m, from_attributes=True)
                for m in members_orm
            ],
            records=[
                AttendanceRecordResponse.model_validate(r, from_attributes=True)
                for r in records_orm
            ],
            sessions=[
                AttendanceSessionResponse.model_validate(s, from_attributes=True)
                for s in sessions_orm
            ],
            settings=AttendanceSettingsResponse.model_validate(
                settings_orm, from_attributes=True
            ),
            exported_at=datetime.now(),
        )

        # Gather face embeddings
        biometrics: List[BiometricEntry] = []
        try:
            from core.lifespan import face_recognizer

            if face_recognizer and face_recognizer.db_manager:
                persons: dict[str, np.ndarray] = (
                    await face_recognizer.db_manager.get_all_persons()
                )
                for person_id, embedding in persons.items():
                    arr = embedding.astype(np.float32)
                    biometrics.append(
                        BiometricEntry(
                            person_id=person_id,
                            embedding_b64=base64.b64encode(arr.tobytes()).decode(
                                "ascii"
                            ),
                            embedding_dim=len(arr),
                        )
                    )
        except Exception as bio_err:
            logger.warning(
                f"[Vault] Could not export biometrics (non-fatal): {bio_err}"
            )

        return VaultExportResponse(
            version=1,
            exported_at=datetime.now().isoformat(),
            attendance=attendance_data,
            biometrics=biometrics,
        )

    except Exception as e:
        logger.error(f"[Vault] Export failed: {e}")
        raise HTTPException(status_code=500, detail=f"Vault export failed: {e}")


@router.post("/import", response_model=SuccessResponse)
async def import_vault(
    payload: VaultImportRequest,
    repo: AttendanceRepository = Depends(get_repository),
):
    """
    Import complete system state from a decrypted vault payload.
    Restores attendance data AND face embeddings so re-registration is not needed.
    """
    try:
        data = payload.attendance.data
        overwrite = payload.attendance.overwrite_existing

        imported_groups = imported_members = imported_records = imported_sessions = (
            skipped
        ) = 0

        for group in data.groups:
            existing = await repo.get_group(group.id)

            # If the group exists, isn't soft-deleted, and we're not overwriting, skip.
            if existing and not existing.is_deleted and not overwrite:
                skipped += 1
                continue

            if not existing:
                settings_dict = group.settings.model_dump() if group.settings else {}
                repo.session.add(
                    GroupModel(
                        id=group.id,
                        name=group.name,
                        description=group.description,
                        late_threshold_minutes=settings_dict.get(
                            "late_threshold_minutes"
                        ),
                        late_threshold_enabled=settings_dict.get(
                            "late_threshold_enabled", False
                        ),
                        class_start_time=settings_dict.get("class_start_time", "08:00"),
                        organization_id=repo.organization_id,
                        is_active=group.is_active,
                        is_deleted=False,
                    )
                )
            else:
                existing.name = group.name
                existing.description = group.description
                existing.is_active = group.is_active
                existing.is_deleted = False
            imported_groups += 1

        for member in data.members:
            # Note: get_member excludes soft-deleted members by default, so if they
            # were soft-deleted, existing will be None, and session.merge will
            # cleanly restore them in the DB below.
            existing = await repo.get_member(member.person_id)
            if existing and not overwrite:
                skipped += 1
                continue

            if not existing:
                await repo.session.merge(
                    MemberModel(
                        person_id=member.person_id,
                        group_id=member.group_id,
                        name=member.name,
                        role=member.role,
                        email=member.email,
                        is_active=member.is_active,
                        is_deleted=False,
                    )
                )
            else:
                existing.name = member.name
                existing.role = member.role
                existing.email = member.email
                existing.is_active = member.is_active
                existing.is_deleted = False
            imported_members += 1

        for record in data.records:
            existing_result = await repo.session.execute(
                select(RecordModel).where(RecordModel.id == record.id)
            )
            if existing_result.scalars().first() and not overwrite:
                skipped += 1
                continue

            await repo.session.merge(
                RecordModel(
                    id=record.id,
                    person_id=record.person_id,
                    group_id=record.group_id,
                    timestamp=record.timestamp,
                    confidence=record.confidence,
                    location=record.location,
                    notes=record.notes,
                    is_manual=record.is_manual,
                    created_by=record.created_by,
                )
            )
            imported_records += 1

        for session in data.sessions:
            await repo.session.merge(
                SessionModel(
                    id=session.id,
                    person_id=session.person_id,
                    group_id=session.group_id,
                    date=session.date,
                    check_in_time=session.check_in_time,
                    status=session.status,
                    is_late=session.is_late,
                    late_minutes=session.late_minutes,
                    notes=session.notes,
                )
            )
            imported_sessions += 1

        imported_biometrics = 0
        for entry in payload.biometrics:
            raw_bytes = base64.b64decode(entry.embedding_b64)
            await repo.session.merge(
                FaceModel(
                    person_id=entry.person_id,
                    embedding=raw_bytes,
                    embedding_dimension=entry.embedding_dim,
                    organization_id=repo.organization_id,
                    is_deleted=False,
                )
            )
            imported_biometrics += 1

        await repo.session.commit()

        from core.lifespan import face_recognizer
        if face_recognizer:
            await face_recognizer._refresh_cache()

        return SuccessResponse(
            message=(
                f"Vault import complete: {imported_groups} groups, "
                f"{imported_members} members, {imported_records} records, "
                f"{imported_sessions} sessions, {imported_biometrics} biometric "
                f"profiles restored. {skipped} items skipped."
            )
        )

    except Exception as e:
        logger.error(f"[Vault] Import failed: {e}")
        raise HTTPException(status_code=500, detail=f"Vault import failed: {e}")
