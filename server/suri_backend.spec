# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file for Suri Backend
Optimized for production builds with ONNX Runtime support
"""

import sys
import os
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# Collect ONNX Runtime data files
onnx_datas = collect_data_files('onnxruntime')

# Collect all submodules to ensure nothing is missed
import platform

# Common imports for all platforms
hidden_imports = [
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'onnxruntime',
    'onnxruntime.capi',
    'onnxruntime.capi.onnxruntime_pybind11_state',
    'cv2',
    'numpy',
]

# Windows-specific imports (only include on Windows)
if platform.system() == 'Windows':
    hidden_imports.extend([
        'win32ctypes',
        'win32ctypes.pywin32',
        'win32ctypes.pywin32.pywintypes',
        'win32ctypes.pywin32.win32api',
        'win32ctypes.core',
        'win32ctypes.core.ctypes',
    ])

# Disable custom runtime hook to avoid bundling PyInstaller dependencies
runtime_hooks = []

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=onnx_datas + [
        ('core/models', 'core/models'),  # Models moved to core/models
        ('config', 'config'),  # Config package (includes settings.py)
        ('database', 'database'),  # Database managers (attendance.py, face.py)
        ('utils', 'utils'),
        ('weights', 'weights'),  # Bundle model weights from server/weights
        ('api', 'api'),  # API package (includes routes, schemas, endpoints)
    ],
    hiddenimports=hidden_imports,
    hookspath=['.'],
    hooksconfig={},
    runtime_hooks=runtime_hooks,
    excludes=[
        'matplotlib',
        'tkinter',
        'PyQt5',
        'PySide2',
        'IPython',
        'notebook',
        'jupyter',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # Hide console window in production
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)

