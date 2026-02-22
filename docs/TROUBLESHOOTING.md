# Troubleshooting & Diagnostics

While Suri is engineered for resilience, local environments can vary. This guide covers common issues and their resolutions.

## Common Error Codes

### 1. `ImportError: DLL load failed` (Windows)
**Symptom**: The backend fails to start with a generic DLL error.
**Cause**: Missing Visual C++ Redistributable or incompatible ONNX Runtime version.
**Solution**:
- Install the [Visual C++ Redistributable 2015-2022](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170).
- Reinstall dependencies:
  ```bash
  pip uninstall onnxruntime onnxruntime-gpu
  pip install -r requirements.txt
  ```

### 2. `Address already in use` (Port 8700)
**Symptom**: `OSError: [Errno 98] Address already in use`.
**Cause**: Another instance of Suri or a zombie Python process is occupying port **8700**.
**Solution**:
- **Windows**: `netstat -ano | findstr :8700` then `taskkill /PID <PID> /F`
- **Linux/Mac**: `lsof -i :8700` then `kill -9 <PID>`

### 3. `ONNX Runtime Error: No provider`
**Symptom**: Slow inference speed using CPU only.
**Cause**: GPU drivers are missing or incompatible with `onnxruntime-gpu`.
**Solution**:
- Ensure you have the latest **NVIDIA CUDA Toolkit** installed.
- Verify installation:
  ```python
  import onnxruntime
  print(onnxruntime.get_available_providers())
  # Should list 'CUDAExecutionProvider'
  ```

## Environment Configuration

You can override default behaviors using System Environment Variables.

| Variable | Default | Description |
| :--- | :--- | :--- |
| `ENVIRONMENT` | `development` | Set to `production` to minimize logging and optimize concurrency. |
| `SERVER_PORT` | `8700` | Change the backend API listening port. |
| `SERVER_HOST` | `127.0.0.1` | Bind to `0.0.0.0` to expose the API to the local network (Warning: Security Risk). |

## Developer Mode

To enable verbose debug logs for the AI pipeline:
1. Set `ENVIRONMENT=development`
2. Check `data/server.log` (Project Root in dev, AppData in prod) for frame-by-frame inference timings.

