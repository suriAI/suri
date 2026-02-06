"""baseline schema

Revision ID: 9d9c0b4c6a01
Revises: 
Create Date: 2026-02-06 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "9d9c0b4c6a01"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    now = sa.text("CURRENT_TIMESTAMP")

    op.create_table(
        "attendance_groups",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=now, nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("1"), nullable=False),
        sa.Column("late_threshold_minutes", sa.Integer(), nullable=True),
        sa.Column(
            "late_threshold_enabled",
            sa.Boolean(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "class_start_time",
            sa.String(),
            server_default=sa.text("'08:00'"),
            nullable=False,
        ),
        sa.Column("organization_id", sa.String(), nullable=True),
        sa.Column("cloud_id", sa.String(), nullable=True),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("last_modified_at", sa.DateTime(), server_default=now, nullable=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("0"), nullable=False),
    )

    op.create_table(
        "attendance_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "late_threshold_minutes",
            sa.Integer(),
            server_default=sa.text("15"),
            nullable=False,
        ),
        sa.Column(
            "enable_location_tracking",
            sa.Boolean(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "confidence_threshold",
            sa.Float(),
            server_default=sa.text("0.7"),
            nullable=False,
        ),
        sa.Column(
            "attendance_cooldown_seconds",
            sa.Integer(),
            server_default=sa.text("10"),
            nullable=False,
        ),
        sa.Column(
            "relog_cooldown_seconds",
            sa.Integer(),
            server_default=sa.text("1800"),
            nullable=False,
        ),
        sa.Column("organization_id", sa.String(), nullable=True),
        sa.Column("cloud_id", sa.String(), nullable=True),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("last_modified_at", sa.DateTime(), server_default=now, nullable=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("0"), nullable=False),
    )

    op.create_table(
        "attendance_members",
        sa.Column("person_id", sa.String(), primary_key=True),
        sa.Column(
            "group_id",
            sa.String(),
            sa.ForeignKey("attendance_groups.id"),
            nullable=False,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=True),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("joined_at", sa.DateTime(), server_default=now, nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("1"), nullable=False),
        sa.Column("organization_id", sa.String(), nullable=True),
        sa.Column("cloud_id", sa.String(), nullable=True),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("last_modified_at", sa.DateTime(), server_default=now, nullable=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("0"), nullable=False),
    )

    op.create_table(
        "attendance_records",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "person_id",
            sa.String(),
            sa.ForeignKey("attendance_members.person_id"),
            nullable=False,
        ),
        sa.Column(
            "group_id",
            sa.String(),
            sa.ForeignKey("attendance_groups.id"),
            nullable=False,
        ),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("location", sa.String(), nullable=True),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("is_manual", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("organization_id", sa.String(), nullable=True),
        sa.Column("cloud_id", sa.String(), nullable=True),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("last_modified_at", sa.DateTime(), server_default=now, nullable=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("0"), nullable=False),
    )

    op.create_table(
        "attendance_sessions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "person_id",
            sa.String(),
            sa.ForeignKey("attendance_members.person_id"),
            nullable=False,
        ),
        sa.Column(
            "group_id",
            sa.String(),
            sa.ForeignKey("attendance_groups.id"),
            nullable=False,
        ),
        sa.Column("date", sa.String(), nullable=False),
        sa.Column("check_in_time", sa.DateTime(), nullable=True),
        sa.Column("total_hours", sa.Float(), nullable=True),
        sa.Column("status", sa.String(), server_default=sa.text("'absent'"), nullable=False),
        sa.Column("is_late", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column("late_minutes", sa.Integer(), nullable=True),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("organization_id", sa.String(), nullable=True),
        sa.Column("cloud_id", sa.String(), nullable=True),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("last_modified_at", sa.DateTime(), server_default=now, nullable=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("0"), nullable=False),
    )

    op.create_table(
        "faces",
        sa.Column("person_id", sa.String(), primary_key=True),
        sa.Column("embedding", sa.LargeBinary(), nullable=False),
        sa.Column("embedding_dimension", sa.Integer(), nullable=False),
        sa.Column("hash", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=now, nullable=True),
        sa.Column("organization_id", sa.String(), nullable=True),
        sa.Column("cloud_id", sa.String(), nullable=True),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("last_modified_at", sa.DateTime(), server_default=now, nullable=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("0"), nullable=False),
    )

    # Indexes (including SyncMixin indexes)
    op.create_index(
        "ix_attendance_groups_organization_id",
        "attendance_groups",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_attendance_groups_cloud_id",
        "attendance_groups",
        ["cloud_id"],
        unique=False,
    )

    op.create_index(
        "ix_attendance_settings_organization_id",
        "attendance_settings",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_attendance_settings_cloud_id",
        "attendance_settings",
        ["cloud_id"],
        unique=False,
    )

    op.create_index("ix_member_group_id", "attendance_members", ["group_id"], unique=False)
    op.create_index(
        "ix_member_person_org",
        "attendance_members",
        ["person_id", "organization_id"],
        unique=True,
    )
    op.create_index(
        "ix_attendance_members_organization_id",
        "attendance_members",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_attendance_members_cloud_id",
        "attendance_members",
        ["cloud_id"],
        unique=False,
    )

    op.create_index("ix_record_group_id", "attendance_records", ["group_id"], unique=False)
    op.create_index("ix_record_person_id", "attendance_records", ["person_id"], unique=False)
    op.create_index("ix_record_timestamp", "attendance_records", ["timestamp"], unique=False)
    op.create_index(
        "ix_record_group_timestamp",
        "attendance_records",
        ["group_id", "timestamp"],
        unique=False,
    )
    op.create_index(
        "ix_attendance_records_organization_id",
        "attendance_records",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_attendance_records_cloud_id",
        "attendance_records",
        ["cloud_id"],
        unique=False,
    )

    op.create_index("ix_session_group_id", "attendance_sessions", ["group_id"], unique=False)
    op.create_index("ix_session_person_id", "attendance_sessions", ["person_id"], unique=False)
    op.create_index("ix_session_date", "attendance_sessions", ["date"], unique=False)
    op.create_index(
        "ix_session_group_date",
        "attendance_sessions",
        ["group_id", "date"],
        unique=False,
    )
    op.create_index(
        "ix_session_person_date_org",
        "attendance_sessions",
        ["person_id", "date", "organization_id"],
        unique=True,
    )
    op.create_index(
        "ix_attendance_sessions_organization_id",
        "attendance_sessions",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_attendance_sessions_cloud_id",
        "attendance_sessions",
        ["cloud_id"],
        unique=False,
    )

    op.create_index("ix_face_person_id", "faces", ["person_id"], unique=False)
    op.create_index("ix_faces_hash", "faces", ["hash"], unique=False)
    op.create_index("ix_faces_organization_id", "faces", ["organization_id"], unique=False)
    op.create_index("ix_faces_cloud_id", "faces", ["cloud_id"], unique=False)


def downgrade() -> None:
    op.drop_table("attendance_records")
    op.drop_table("attendance_sessions")
    op.drop_table("attendance_members")
    op.drop_table("attendance_settings")
    op.drop_table("attendance_groups")
    op.drop_table("faces")
