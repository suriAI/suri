import logging
from typing import List, Dict, Optional
import numpy as np
from .deepsort import DeepSort
from .utils import iou_batch

logger = logging.getLogger(__name__)


class FaceTracker:
    """Wrapper around Deep SORT for face tracking with appearance features"""

    def __init__(
        self,
        max_age: int,
        n_init: int,
        max_iou_distance: float,
        max_cosine_distance: float,
        nn_budget: int,
        matching_weights: Dict[str, float] = None,
    ):
        self.tracker = DeepSort(
            max_age=max_age,
            n_init=n_init,
            max_iou_distance=max_iou_distance,
            max_cosine_distance=max_cosine_distance,
            nn_budget=nn_budget,
            matching_weights=matching_weights,
        )
        self.max_iou_distance = max_iou_distance

    def update(
        self, face_detections: List[Dict], embeddings: Optional[List[np.ndarray]] = None
    ) -> List[Dict]:
        """Update tracker with face detections and embeddings"""
        if not face_detections:
            self.tracker.update(np.empty((0, 5)), None)
            return []

        dets = []
        for face in face_detections:
            bbox = face.get("bbox", face.get("box", {}))

            if isinstance(bbox, dict):
                x = bbox.get("x", 0)
                y = bbox.get("y", 0)
                width = bbox.get("width", 0)
                height = bbox.get("height", 0)
            elif isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
                x, y, width, height = bbox[:4]
            else:
                logger.warning(f"Invalid bbox format: {bbox}")
                continue

            x1, y1 = x, y
            x2, y2 = x + width, y + height
            score = face.get("confidence", face.get("score", 1.0))

            dets.append([x1, y1, x2, y2, score])

        if not dets:
            self.tracker.update(np.empty((0, 5)), None)
            return []

        dets_array = np.array(dets, dtype=np.float32)

        features_array = None
        if embeddings is not None and len(embeddings) == len(dets):
            features_array = np.array(embeddings, dtype=np.float32)

        tracks = self.tracker.update(dets_array, features_array)

        result = []
        matched_detection_indices = set()

        if len(tracks) > 0:
            track_bboxes = tracks[:, :4]
            det_bboxes = dets_array[:, :4]

            iou_matrix = iou_batch(track_bboxes, det_bboxes)

            for track_idx, track in enumerate(tracks):
                best_det_idx = np.argmax(iou_matrix[track_idx])
                best_iou = iou_matrix[track_idx, best_det_idx]

                if best_iou > (1.0 - self.max_iou_distance):
                    face_result = face_detections[best_det_idx].copy()
                    face_result["track_id"] = int(track[4])

                    if embeddings is not None and best_det_idx < len(embeddings):
                        face_result["embedding"] = embeddings[best_det_idx]

                    result.append(face_result)
                    matched_detection_indices.add(best_det_idx)

                    iou_matrix[:, best_det_idx] = 0

        for det_idx, face in enumerate(face_detections):
            if det_idx not in matched_detection_indices:
                face_result = face.copy()
                face_result["track_id"] = -(det_idx + 1)

                if embeddings is not None and det_idx < len(embeddings):
                    face_result["embedding"] = embeddings[det_idx]

                result.append(face_result)

        return result

    def reset(self):
        """Reset tracker"""
        self.tracker.reset()

    def get_active_track_count(self) -> int:
        """Get number of active tracks"""
        return self.tracker.get_track_count()

