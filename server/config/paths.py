import sys
import os
from pathlib import Path

# Determine if running in a PyInstaller bundle
IS_FROZEN = getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS")


APP_NAME = "Suri"


def get_base_dir() -> Path:
    """Get the base directory for read-only resources based on execution mode."""
    if IS_FROZEN:
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent.parent


def get_project_root() -> Path:
    """Get the absolute project root (e.g. repo/suri/ folder in dev)."""
    return get_base_dir().parent if not IS_FROZEN else get_base_dir()


def get_data_dir() -> Path:
    """
    Get the data directory for persistent read-write storage (databases, logs).
    Priority:
    1. SURI_DATA_DIR env variable (Preferred for Electron integration)
    2. IS_FROZEN: OS-native AppData directory
    3. Dev: project_root/data
    """
    env_data_dir = os.getenv("SURI_DATA_DIR")
    if env_data_dir:
        data_dir = Path(env_data_dir)
    elif IS_FROZEN:
        if sys.platform == "win32":
            app_data = Path(os.environ.get("LOCALAPPDATA", os.path.expanduser("~\\AppData\\Local")))
        elif sys.platform == "darwin":
            app_data = Path(os.path.expanduser("~/Library/Application Support"))
        else:
            app_data = Path(os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share")))
        
        data_dir = app_data / APP_NAME / "data"
    else:
        data_dir = get_project_root() / "data"

    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


# Initialize core paths
BASE_DIR = get_base_dir()
DATA_DIR = get_data_dir()
MODELS_DIR = BASE_DIR / "assets" / "models"
ALEMBIC_CONFIG_PATH = BASE_DIR / "alembic.ini"
MIGRATIONS_DIR = BASE_DIR / "migrations"
PROJECT_ROOT = get_project_root()


# Helpers for specific path retrieval if needed dynamically
def get_models_dir() -> Path:
    return MODELS_DIR


def get_alembic_config_path() -> Path:
    return ALEMBIC_CONFIG_PATH


def get_migrations_dir() -> Path:
    return MIGRATIONS_DIR
