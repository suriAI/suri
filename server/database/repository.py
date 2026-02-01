from typing import Optional, List, Any, Dict
from datetime import datetime, timedelta
from sqlalchemy import select, desc, func
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import (
    AttendanceGroup,
    AttendanceMember,
    AttendanceRecord,
    AttendanceSession,
    AttendanceSettings,
    Face,
)


class AttendanceRepository:
    """Repository pattern for Attendance database operations"""

    def __init__(self, session: AsyncSession):
        self.session = session

    # Group Methods
    async def create_group(self, group_data: Dict[str, Any]) -> AttendanceGroup:
        settings = group_data.get("settings", {})
        group = AttendanceGroup(
            id=group_data["id"],
            name=group_data["name"],
            description=group_data.get("description"),
            late_threshold_minutes=settings.get("late_threshold_minutes"),
            late_threshold_enabled=settings.get("late_threshold_enabled", False),
            class_start_time=settings.get("class_start_time", "08:00"),
            is_active=True,
            is_deleted=False,
        )
        self.session.add(group)
        await self.session.commit()
        await self.session.refresh(group)
        return group

    async def get_groups(self, active_only: bool = True) -> List[AttendanceGroup]:
        query = (
            select(AttendanceGroup)
            .where(not AttendanceGroup.is_deleted)
            .order_by(AttendanceGroup.name)
        )
        if active_only:
            query = query.where(AttendanceGroup.is_active)
        result = await self.session.execute(query)
        return result.scalars().all()

    async def get_group(self, group_id: str) -> Optional[AttendanceGroup]:
        return await self.session.get(AttendanceGroup, group_id)

    async def update_group(
        self, group_id: str, updates: Dict[str, Any]
    ) -> Optional[AttendanceGroup]:
        group = await self.get_group(group_id)
        if not group:
            return None

        for key, value in updates.items():
            if key == "settings":
                if "late_threshold_minutes" in value:
                    group.late_threshold_minutes = value["late_threshold_minutes"]
                if "late_threshold_enabled" in value:
                    group.late_threshold_enabled = value["late_threshold_enabled"]
                if "class_start_time" in value:
                    group.class_start_time = value["class_start_time"]
            elif hasattr(group, key):
                setattr(group, key, value)

        await self.session.commit()
        await self.session.refresh(group)
        return group

    async def delete_group(self, group_id: str) -> bool:
        group = await self.get_group(group_id)
        if not group:
            return False
        group.is_active = False
        group.is_deleted = True
        await self.session.commit()
        return True

    # Member Methods
    async def add_member(self, member_data: Dict[str, Any]) -> AttendanceMember:
        member = await self.session.merge(
            AttendanceMember(
                person_id=member_data["person_id"],
                group_id=member_data["group_id"],
                name=member_data["name"],
                role=member_data.get("role"),
                email=member_data.get("email"),
                is_active=True,
                is_deleted=False,
            )
        )
        await self.session.commit()
        await self.session.refresh(member)
        return member

    async def get_member(self, person_id: str) -> Optional[AttendanceMember]:
        query = select(AttendanceMember).where(
            AttendanceMember.person_id == person_id,
            AttendanceMember.is_active,
            not AttendanceMember.is_deleted,
        )
        result = await self.session.execute(query)
        return result.scalar_one_or_none()

    async def get_group_members(self, group_id: str) -> List[AttendanceMember]:
        query = (
            select(AttendanceMember)
            .where(
                AttendanceMember.group_id == group_id,
                AttendanceMember.is_active,
                not AttendanceMember.is_deleted,
            )
            .order_by(AttendanceMember.name)
        )
        result = await self.session.execute(query)
        return result.scalars().all()

    async def get_group_person_ids(self, group_id: str) -> List[str]:
        query = select(AttendanceMember.person_id).where(
            AttendanceMember.group_id == group_id,
            AttendanceMember.is_active,
            not AttendanceMember.is_deleted,
        )
        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def update_member(
        self, person_id: str, updates: Dict[str, Any]
    ) -> Optional[AttendanceMember]:
        member = await self.get_member(person_id)
        if not member:
            return None

        for key, value in updates.items():
            if hasattr(member, key):
                setattr(member, key, value)

        await self.session.commit()
        await self.session.refresh(member)
        return member

    async def remove_member(self, person_id: str) -> bool:
        member = await self.get_member(person_id)
        if not member:
            return False
        member.is_active = False
        member.is_deleted = True
        await self.session.commit()
        return True

    # Record Methods
    async def add_record(self, record_data: Dict[str, Any]) -> AttendanceRecord:
        record = AttendanceRecord(
            id=record_data["id"],
            person_id=record_data["person_id"],
            group_id=record_data["group_id"],
            timestamp=record_data["timestamp"],
            confidence=record_data["confidence"],
            location=record_data.get("location"),
            notes=record_data.get("notes"),
            is_manual=record_data.get("is_manual", False),
            created_by=record_data.get("created_by"),
        )
        self.session.add(record)
        await self.session.commit()
        await self.session.refresh(record)
        return record

    async def get_records(
        self,
        group_id: Optional[str] = None,
        person_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: Optional[int] = None,
    ) -> List[AttendanceRecord]:
        query = select(AttendanceRecord)

        if group_id:
            query = query.where(AttendanceRecord.group_id == group_id)
        if person_id:
            query = query.where(AttendanceRecord.person_id == person_id)
        if start_date:
            query = query.where(AttendanceRecord.timestamp >= start_date)
        if end_date:
            query = query.where(AttendanceRecord.timestamp <= end_date)

        query = query.order_by(desc(AttendanceRecord.timestamp))

        if limit:
            query = query.limit(limit)

        result = await self.session.execute(query)
        return result.scalars().all()

    # Session Methods
    async def upsert_session(self, session_data: Dict[str, Any]) -> AttendanceSession:
        session_obj = await self.session.merge(
            AttendanceSession(
                id=session_data["id"],
                person_id=session_data["person_id"],
                group_id=session_data["group_id"],
                date=session_data["date"],
                check_in_time=session_data.get("check_in_time"),
                total_hours=session_data.get("total_hours"),
                status=session_data["status"],
                is_late=session_data.get("is_late", False),
                late_minutes=session_data.get("late_minutes"),
                notes=session_data.get("notes"),
            )
        )
        await self.session.commit()
        await self.session.refresh(session_obj)
        return session_obj

    async def get_session(
        self, person_id: str, date: str
    ) -> Optional[AttendanceSession]:
        query = select(AttendanceSession).where(
            AttendanceSession.person_id == person_id, AttendanceSession.date == date
        )
        result = await self.session.execute(query)
        return result.scalar_one_or_none()

    async def get_sessions(
        self,
        group_id: Optional[str] = None,
        person_id: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> List[AttendanceSession]:
        query = select(AttendanceSession)

        if group_id:
            query = query.where(AttendanceSession.group_id == group_id)
        if person_id:
            query = query.where(AttendanceSession.person_id == person_id)
        if start_date:
            query = query.where(AttendanceSession.date >= start_date)
        if end_date:
            query = query.where(AttendanceSession.date <= end_date)

        query = query.order_by(
            desc(AttendanceSession.date), AttendanceSession.person_id
        )
        result = await self.session.execute(query)
        return result.scalars().all()

    # Settings Methods
    async def get_settings(self) -> AttendanceSettings:
        settings = await self.session.get(AttendanceSettings, 1)
        if not settings:
            # Create default settings
            settings = AttendanceSettings(id=1)
            self.session.add(settings)
            await self.session.commit()
            await self.session.refresh(settings)
        return settings

    async def update_settings(self, settings_data: Dict[str, Any]) -> bool:
        settings = await self.get_settings()

        for key, value in settings_data.items():
            if hasattr(settings, key) and key != "id":
                setattr(settings, key, value)

        await self.session.commit()
        return True

    # Stats
    async def get_stats(self) -> Dict[str, Any]:
        from config.paths import DATA_DIR

        db_path = DATA_DIR / "attendance.db"

        groups_count = await self.session.scalar(
            select(func.count())
            .select_from(AttendanceGroup)
            .where(AttendanceGroup.is_active)
        )
        members_count = await self.session.scalar(
            select(func.count())
            .select_from(AttendanceMember)
            .where(AttendanceMember.is_active)
        )
        records_count = await self.session.scalar(
            select(func.count()).select_from(AttendanceRecord)
        )
        sessions_count = await self.session.scalar(
            select(func.count()).select_from(AttendanceSession)
        )

        db_size = db_path.stat().st_size if db_path.exists() else 0

        return {
            "total_groups": groups_count,
            "total_members": members_count,
            "total_records": records_count,
            "total_sessions": sessions_count,
            "database_path": str(db_path),
            "database_size_bytes": db_size,
            "database_size_mb": round(db_size / (1024 * 1024), 2),
        }

    async def cleanup_old_data(self, days: int) -> Dict[str, int]:
        """Delete records and sessions older than X days"""
        cutoff_date = datetime.now() - timedelta(days=days)
        cutoff_date_str = cutoff_date.strftime("%Y-%m-%d")

        # Delete records
        record_query = select(AttendanceRecord).where(
            AttendanceRecord.timestamp < cutoff_date
        )
        records_result = await self.session.execute(record_query)
        records_to_delete = records_result.scalars().all()
        for r in records_to_delete:
            await self.session.delete(r)

        # Delete sessions
        session_query = select(AttendanceSession).where(
            AttendanceSession.date < cutoff_date_str
        )
        sessions_result = await self.session.execute(session_query)
        sessions_to_delete = sessions_result.scalars().all()
        for s in sessions_to_delete:
            await self.session.delete(s)

        await self.session.commit()

        return {
            "records_deleted": len(records_to_delete),
            "sessions_deleted": len(sessions_to_delete),
        }


class FaceRepository:
    """Repository pattern for Face database operations"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def upsert_face(
        self,
        person_id: str,
        embedding: bytes,
        dimension: int,
        image_hash: Optional[str] = None,
    ) -> Face:
        face = await self.session.merge(
            Face(
                person_id=person_id,
                embedding=embedding,
                embedding_dimension=dimension,
                hash=image_hash,
                is_deleted=False,  # Ensure it's active if re-added
            )
        )
        await self.session.commit()
        await self.session.refresh(face)
        return face

    async def get_face(self, person_id: str) -> Optional[Face]:
        query = select(Face).where(Face.person_id == person_id, not Face.is_deleted)
        result = await self.session.execute(query)
        return result.scalar_one_or_none()

    async def get_all_faces(self) -> List[Face]:
        query = select(Face).where(not Face.is_deleted)
        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def remove_face(self, person_id: str) -> bool:
        face = await self.get_face(person_id)
        if not face:
            return False
        face.is_deleted = True
        await self.session.commit()
        return True

    async def update_person_id(self, old_id: str, new_id: str) -> bool:
        face = await self.get_face(old_id)
        if not face:
            return False

        # Check if new_id already exists
        exists = await self.get_face(new_id)
        if exists:
            return False

        face.person_id = new_id
        await self.session.commit()
        return True

    async def clear_faces(self) -> bool:
        query = select(Face)
        result = await self.session.execute(query)
        faces = result.scalars().all()
        for f in faces:
            await self.session.delete(f)
        await self.session.commit()
        return True

    async def get_stats(self) -> Dict[str, Any]:
        count = await self.session.scalar(
            select(func.count()).select_from(Face).where(not Face.is_deleted)
        )
        return {"total_faces": count}
