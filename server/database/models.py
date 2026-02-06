from datetime import datetime
from typing import Optional, List
from sqlalchemy import (
    String,
    Boolean,
    Integer,
    Float,
    ForeignKey,
    DateTime,
    func,
    Index,
    LargeBinary,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.ext.asyncio import AsyncAttrs


class Base(AsyncAttrs, DeclarativeBase):
    pass


class SyncMixin(AsyncAttrs):
    """
    Mixin to add synchronization metadata and multi-tenancy.
    """

    organization_id: Mapped[Optional[str]] = mapped_column(
        String, nullable=True, index=True
    )
    cloud_id: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    last_modified_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
    )
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class AttendanceGroup(Base, SyncMixin):
    __tablename__ = "attendance_groups"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.current_timestamp()
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    late_threshold_minutes: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )
    late_threshold_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    class_start_time: Mapped[str] = mapped_column(String, default="08:00")

    members: Mapped[List["AttendanceMember"]] = relationship(back_populates="group")
    records: Mapped[List["AttendanceRecord"]] = relationship(back_populates="group")
    sessions: Mapped[List["AttendanceSession"]] = relationship(back_populates="group")

    @property
    def settings(self):
        return {
            "late_threshold_minutes": self.late_threshold_minutes,
            "late_threshold_enabled": self.late_threshold_enabled,
            "class_start_time": self.class_start_time,
        }


class AttendanceMember(Base, SyncMixin):
    __tablename__ = "attendance_members"

    person_id: Mapped[str] = mapped_column(String, primary_key=True)
    group_id: Mapped[str] = mapped_column(
        String, ForeignKey("attendance_groups.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.current_timestamp()
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    group: Mapped["AttendanceGroup"] = relationship(back_populates="members")
    records: Mapped[List["AttendanceRecord"]] = relationship(back_populates="member")
    sessions: Mapped[List["AttendanceSession"]] = relationship(back_populates="member")

    __table_args__ = (
        Index("ix_member_group_id", "group_id"),
        Index("ix_member_person_org", "person_id", "organization_id", unique=True),
    )


class AttendanceRecord(Base, SyncMixin):
    __tablename__ = "attendance_records"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    person_id: Mapped[str] = mapped_column(
        String, ForeignKey("attendance_members.person_id"), nullable=False
    )
    group_id: Mapped[str] = mapped_column(
        String, ForeignKey("attendance_groups.id"), nullable=False
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    location: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_manual: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    member: Mapped["AttendanceMember"] = relationship(back_populates="records")
    group: Mapped["AttendanceGroup"] = relationship(back_populates="records")

    __table_args__ = (
        Index("ix_record_group_id", "group_id"),
        Index("ix_record_person_id", "person_id"),
        Index("ix_record_timestamp", "timestamp"),
        Index("ix_record_group_timestamp", "group_id", "timestamp"),
    )


class AttendanceSession(Base, SyncMixin):
    __tablename__ = "attendance_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    person_id: Mapped[str] = mapped_column(
        String, ForeignKey("attendance_members.person_id"), nullable=False
    )
    group_id: Mapped[str] = mapped_column(
        String, ForeignKey("attendance_groups.id"), nullable=False
    )
    date: Mapped[str] = mapped_column(String, nullable=False)  # YYYY-MM-DD
    check_in_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    total_hours: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="absent")
    is_late: Mapped[bool] = mapped_column(Boolean, default=False)
    late_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    member: Mapped["AttendanceMember"] = relationship(back_populates="sessions")
    group: Mapped["AttendanceGroup"] = relationship(back_populates="sessions")

    __table_args__ = (
        Index("ix_session_group_id", "group_id"),
        Index("ix_session_person_id", "person_id"),
        Index("ix_session_date", "date"),
        Index("ix_session_group_date", "group_id", "date"),
        Index(
            "ix_session_person_date_org",
            "person_id",
            "date",
            "organization_id",
            unique=True,
        ),
    )


class AttendanceSettings(Base, SyncMixin):
    __tablename__ = "attendance_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)  # Singleton
    late_threshold_minutes: Mapped[int] = mapped_column(Integer, default=15)
    enable_location_tracking: Mapped[bool] = mapped_column(Boolean, default=False)
    confidence_threshold: Mapped[float] = mapped_column(Float, default=0.7)
    attendance_cooldown_seconds: Mapped[int] = mapped_column(Integer, default=10)
    # Longer anti-duplicate window (e.g., 30 minutes) to prevent re-logging.
    relog_cooldown_seconds: Mapped[int] = mapped_column(Integer, default=1800)


class Face(Base, SyncMixin):
    __tablename__ = "faces"

    person_id: Mapped[str] = mapped_column(String, primary_key=True)
    embedding: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    embedding_dimension: Mapped[int] = mapped_column(Integer, nullable=False)
    hash: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.current_timestamp()
    )

    __table_args__ = (Index("ix_face_person_id", "person_id"),)
