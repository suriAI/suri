"""add relog cooldown seconds

Revision ID: 2f3c4b8a9d10
Revises: 4f83b1692d41
Create Date: 2026-02-06 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "2f3c4b8a9d10"
down_revision: Union[str, Sequence[str], None] = "4f83b1692d41"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("attendance_settings", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "relog_cooldown_seconds",
                sa.Integer(),
                nullable=False,
                server_default="1800",
            )
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("attendance_settings", schema=None) as batch_op:
        batch_op.drop_column("relog_cooldown_seconds")
