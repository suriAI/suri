"""
PyInstaller hook for onnxruntime
Ensures all necessary ONNX Runtime components are included
"""

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules

# Collect all onnxruntime data files
datas = collect_data_files('onnxruntime')

# Collect dynamic libraries
binaries = collect_dynamic_libs('onnxruntime')

# Collect all submodules
hiddenimports = collect_submodules('onnxruntime')

# Add specific providers that might be missed
hiddenimports.extend([
    'onnxruntime.capi',
    'onnxruntime.capi.onnxruntime_pybind11_state',
    'onnxruntime.providers',
    'onnxruntime.providers.cpu',
    'onnxruntime.providers.shared',
])

# Exclude GPU providers if not needed (reduces size)
excludedimports = [
    'onnxruntime.providers.cuda',
    'onnxruntime.providers.tensorrt',
    'onnxruntime.providers.dml',  # DirectML for Windows
    'onnxruntime.providers.openvino',
]