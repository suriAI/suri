import sys
import os
from pathlib import Path

# Determine if running in a PyInstaller bundle
IS_FROZEN = getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS")


def get_base_dir() -> Path:
    """Get the base directory for resources based on execution mode."""
    if IS_FROZEN:
        return Path(sys._MEIPASS)
    return Path(__file__).parent.parent


def get_data_dir() -> Path:
    """
    Get the data directory.
    Priority:
    1. SURI_DATA_DIR environment variable
    2. Frozen: executable_dir/data
    3. Dev: project_root/data
    """
    env_data_dir = os.getenv("SURI_DATA_DIR")
    if env_data_dir:
        data_dir = Path(env_data_dir)
    elif IS_FROZEN:
        data_dir = Path(sys.executable).parent / "data"
    else:
        # In dev, base_dir is server/ (from get_base_dir implementation for dev)
        # But wait, get_base_dir returns server/.. (parent of config endpoint) -> server/
        # Let's check get_base_dir logic vs implementation
        # Old implementation: Path(__file__).parent.parent -> server/
        # So base_dir / "data" -> server/data.
        data_dir = get_base_dir() / "data"

    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


# Initialize core paths
BASE_DIR = get_base_dir()
DATA_DIR = get_data_dir()
WEIGHTS_DIR = BASE_DIR / "weights"
ALEMBIC_CONFIG_PATH = BASE_DIR / "alembic.ini"
MIGRATIONS_DIR = BASE_DIR / "migrations"
PROJECT_ROOT = BASE_DIR.parent if not IS_FROZEN else BASE_DIR


# Helpers for specific path retrieval if needed dynamically,
# though constants above are usually sufficient.
def get_weights_dir() -> Path:
    return WEIGHTS_DIR


def get_alembic_config_path() -> Path:
    return ALEMBIC_CONFIG_PATH


def get_migrations_dir() -> Path:
    return MIGRATIONS_DIR
