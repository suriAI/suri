import onnxruntime as ort
import os


def init_onnx_session(model_path: str):
    """Initialize ONNX Runtime session safely."""
    ort_session = None
    input_name = None

    if os.path.isfile(model_path):
        try:
            ort_session = ort.InferenceSession(
                model_path,
                providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
            )
        except Exception:
            try:
                ort_session = ort.InferenceSession(
                    model_path, providers=["CPUExecutionProvider"]
                )
            except Exception:
                return None, None

        if ort_session:
            input_name = ort_session.get_inputs()[0].name

    return ort_session, input_name
