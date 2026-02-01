"""add organization_id

Revision ID: 4f83b1692d41
Revises: 016583969152
Create Date: 2026-02-01 09:40:00.000000

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision = "4f83b1692d41"
down_revision = "016583969152"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Tables that use OrganizationMixin:
    tables = [
        "attendance_groups",
        "attendance_sessions",
        "attendance_records",
        "attendance_members",
        "attendance_settings",
    ]

    bind = op.get_bind()
    inspector = inspect(bind)

    for table in tables:
        # Check if column exists to avoid "duplicate column" error
        columns = [c["name"] for c in inspector.get_columns(table)]
        if "organization_id" not in columns:
            with op.batch_alter_table(table, schema=None) as batch_op:
                batch_op.add_column(
                    sa.Column("organization_id", sa.String(), nullable=True)
                )
                batch_op.create_index(
                    batch_op.f(f"ix_{table}_organization_id"),
                    ["organization_id"],
                    unique=False,
                )


def downgrade() -> None:
    tables = [
        "attendance_groups",
        "attendance_sessions",
        "attendance_records",
        "attendance_members",
        "attendance_settings",
    ]

    bind = op.get_bind()
    inspector = inspect(bind)

    for table in tables:
        columns = [c["name"] for c in inspector.get_columns(table)]
        if "organization_id" in columns:
            with op.batch_alter_table(table, schema=None) as batch_op:
                batch_op.drop_index(batch_op.f(f"ix_{table}_organization_id"))
                batch_op.drop_column("organization_id")
