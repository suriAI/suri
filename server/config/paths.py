import sys
from pathlib import Path


def get_weights_dir() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS) / "weights"
    else:
        base_dir = Path(__file__).parent.parent
        return base_dir / "weights"


def get_data_dir() -> Path:
    import os

    env_data_dir = os.getenv("SURI_DATA_DIR")
    if env_data_dir:
        data_dir = Path(env_data_dir)
        data_dir.mkdir(parents=True, exist_ok=True)
        return data_dir

    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        exe_dir = Path(sys.executable).parent
        data_dir = exe_dir / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        return data_dir
    else:
        base_dir = Path(__file__).parent.parent
        data_dir = base_dir / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        return data_dir


def get_alembic_config_path() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS) / "alembic.ini"
    else:
        return Path(__file__).parent.parent / "alembic.ini"


def get_migrations_dir() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS) / "migrations"
    else:
        return Path(__file__).parent.parent / "migrations"


BASE_DIR = Path(__file__).parent
PROJECT_ROOT = (
    BASE_DIR.parent if not getattr(sys, "frozen", False) else Path(sys._MEIPASS)
)
WEIGHTS_DIR = get_weights_dir()
DATA_DIR = get_data_dir()
ALEMBIC_CONFIG_PATH = get_alembic_config_path()
MIGRATIONS_DIR = get_migrations_dir()
