import os
import logging
import onnxruntime as ort
from typing import Tuple, Optional, List, Dict, Any

logger = logging.getLogger(__name__)


def init_face_recognizer_session(
    model_path: str,
    providers: Optional[List[str]] = None,
    session_options: Optional[Dict[str, Any]] = None,
) -> Tuple[Optional[ort.InferenceSession], Optional[str]]:
    """
    Initialize ONNX Runtime session for face recognition model.

    Args:
        model_path: Path to ONNX model file
        providers: List of execution providers (default: CPU)
        session_options: Optional session configuration options

    Returns:
        Tuple of (session, input_name)
        - session: ONNX Runtime InferenceSession or None if failed
        - input_name: Name of input tensor or None if failed
    """
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model file not found: {model_path}")

    providers = providers or ["CPUExecutionProvider"]

    try:
        ort_opts = ort.SessionOptions()

        if session_options:
            for key, value in session_options.items():
                if hasattr(ort_opts, key):
                    setattr(ort_opts, key, value)

        session = ort.InferenceSession(
            model_path, sess_options=ort_opts, providers=providers
        )

        input_name = session.get_inputs()[0].name

        logger.info(f"Face recognizer model loaded successfully from {model_path}")
        return session, input_name

    except Exception as e:
        logger.error(f"Failed to initialize face recognizer model: {e}")
        raise

