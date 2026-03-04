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
    AttendanceMember as MemberModel,
    AttendanceRecord as RecordModel,
    AttendanceSession as SessionModel,
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


# ── Schemas ──────────────────────────────────────────────────────────────────


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


# ── Routes ────────────────────────────────────────────────────────────────────


@router.post("/export", response_model=VaultExportResponse)
async def export_vault(
    repo: AttendanceRepository = Depends(get_repository),
):
    """
    Export complete system state: attendance data + face embeddings.
    Returns plain JSON — encryption is handled by the Electron layer.
    """
    try:
        # ── 1. Gather attendance data ─────────────────────────────────────────
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

        # ── 2. Gather face embeddings ─────────────────────────────────────────
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

        # ── 1. Import groups ──────────────────────────────────────────────────
        for group in data.groups:
            existing = await repo.get_group(group.id)
            if existing and not overwrite:
                skipped += 1
                continue
            if not existing:
                await repo.create_group(
                    {
                        "id": group.id,
                        "name": group.name,
                        "description": group.description,
                        "settings": (
                            group.settings.model_dump() if group.settings else {}
                        ),
                    }
                )
            else:
                await repo.update_group(
                    group.id,
                    {"name": group.name, "description": group.description},
                )
            imported_groups += 1

        # ── 2. Import members ─────────────────────────────────────────────────
        for member in data.members:
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
                await repo.session.commit()
            else:
                await repo.update_member(
                    member.person_id,
                    {"name": member.name, "role": member.role, "email": member.email},
                )
            imported_members += 1

        # ── 3. Import records ─────────────────────────────────────────────────
        for record in data.records:
            existing_result = await repo.session.execute(
                select(RecordModel).where(RecordModel.id == record.id)
            )
            if existing_result.scalars().first() and not overwrite:
                skipped += 1
                continue
            await repo.add_record(
                {
                    "id": record.id,
                    "person_id": record.person_id,
                    "group_id": record.group_id,
                    "timestamp": record.timestamp,
                    "confidence": record.confidence,
                    "location": record.location,
                    "notes": record.notes,
                    "is_manual": record.is_manual,
                    "created_by": record.created_by,
                }
            )
            imported_records += 1

        # ── 4. Import sessions ────────────────────────────────────────────────
        for session in data.sessions:
            await repo.upsert_session(
                {
                    "id": session.id,
                    "person_id": session.person_id,
                    "group_id": session.group_id,
                    "date": session.date,
                    "check_in_time": session.check_in_time,
                    "status": session.status,
                    "is_late": session.is_late,
                    "late_minutes": session.late_minutes,
                    "notes": session.notes,
                }
            )
            imported_sessions += 1

        # ── 5. Import face embeddings ─────────────────────────────────────────
        imported_biometrics = 0
        skipped_biometrics = 0
        try:
            from core.lifespan import face_recognizer

            if face_recognizer and face_recognizer.db_manager:
                for entry in payload.biometrics:
                    try:
                        raw_bytes = base64.b64decode(entry.embedding_b64)
                        embedding = np.frombuffer(raw_bytes, dtype=np.float32).copy()
                        await face_recognizer.db_manager.add_person(
                            entry.person_id, embedding
                        )
                        imported_biometrics += 1
                    except Exception as e:
                        logger.warning(
                            f"[Vault] Skipped biometric for {entry.person_id}: {e}"
                        )
                        skipped_biometrics += 1

                # Refresh the in-memory recognition cache
                await face_recognizer._refresh_cache()
        except Exception as bio_err:
            logger.warning(f"[Vault] Biometric import failed (non-fatal): {bio_err}")

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
