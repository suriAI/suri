import logging
from typing import List, Dict, Optional
import numpy as np
from .byte_tracker import BYTETracker
from .utils import iou_batch

logger = logging.getLogger(__name__)


class ByteTrackArgs:
    """Simple args object for tracker initialization"""

    def __init__(
        self, track_thresh=0.5, match_thresh=0.8, track_buffer=30, mot20=False
    ):
        self.track_thresh = track_thresh
        self.match_thresh = match_thresh
        self.track_buffer = track_buffer
        self.mot20 = mot20


class FaceTracker:
    """Wrapper around tracker for face tracking"""

    def __init__(
        self,
        model_path: str,
        track_thresh: float = 0.5,
        match_thresh: float = 0.8,
        track_buffer: int = 30,
        frame_rate: int = 30,
        max_iou_distance: float = 0.7,
    ):
        """
        Initialize face tracker.

        Args:
            model_path: Path to tracker model file (for consistency with other models)
            track_thresh: Detection confidence threshold
            match_thresh: Matching threshold for association
            track_buffer: Buffer size for lost tracks
            frame_rate: Frame rate for tracking (can be updated dynamically)
            max_iou_distance: Maximum IoU distance for matching tracks to detections
        """
        self.model_path = model_path
        self.args = ByteTrackArgs(
            track_thresh=track_thresh,
            match_thresh=match_thresh,
            track_buffer=track_buffer,
            mot20=False,
        )
        self.tracker = BYTETracker(self.args, frame_rate=frame_rate)
        self.frame_rate = frame_rate
        self.max_iou_distance = max_iou_distance

    def update_frame_rate(self, frame_rate: int):
        """
        Update frame rate dynamically and recreate tracker if needed.

        Args:
            frame_rate: New frame rate (clamped between 1 and 120)
        """
        frame_rate = max(1, min(120, int(frame_rate)))
        if frame_rate != self.frame_rate:
            self.frame_rate = frame_rate
            self.tracker = BYTETracker(self.args, frame_rate=frame_rate)

    def update(
        self,
        face_detections: List[Dict],
        frame_rate: Optional[int] = None,
    ) -> List[Dict]:
        """
        Update tracker with face detections.

        Args:
            face_detections: List of face detection dictionaries
            frame_rate: Optional frame rate to update dynamically
        """
        if frame_rate is not None:
            self.update_frame_rate(frame_rate)

        if not face_detections:
            output_results = np.empty((0, 5), dtype=np.float32)
            img_info = (640, 640)
            img_size = (640, 640)
            self.tracker.update(output_results, img_info, img_size)
            return []

        dets = []
        for face in face_detections:
            bbox = face.get("bbox", {})

            if not isinstance(bbox, dict):
                logger.warning(f"Invalid bbox format: {bbox}")
                continue

            x = bbox.get("x", 0)
            y = bbox.get("y", 0)
            width = bbox.get("width", 0)
            height = bbox.get("height", 0)

            x1, y1 = x, y
            x2, y2 = x + width, y + height
            score = face.get("confidence", 1.0)

            dets.append([x1, y1, x2, y2, score])

        if not dets:
            output_results = np.empty((0, 5), dtype=np.float32)
            img_info = (640, 640)
            img_size = (640, 640)
            self.tracker.update(output_results, img_info, img_size)
            return []

        dets_array = np.array(dets, dtype=np.float32)
        output_results = dets_array

        img_info = (640, 640)
        img_size = (640, 640)

        output_stracks = self.tracker.update(output_results, img_info, img_size)

        # Convert STrack objects to face detection format
        result = []
        matched_detection_indices = set()

        if len(output_stracks) > 0:
            # Create mapping from track bboxes to detections
            track_bboxes = []
            for track in output_stracks:
                tlbr = track.tlbr  # [x1, y1, x2, y2]
                track_bboxes.append(tlbr)

            track_bboxes = np.array(track_bboxes)
            det_bboxes = dets_array[:, :4]

            if len(track_bboxes) > 0 and len(det_bboxes) > 0:
                iou_matrix = iou_batch(track_bboxes, det_bboxes)

                for track_idx, track in enumerate(output_stracks):
                    if track_idx >= iou_matrix.shape[0]:
                        continue
                    best_det_idx = np.argmax(iou_matrix[track_idx])
                    best_iou = iou_matrix[track_idx, best_det_idx]

                    if best_iou > (1.0 - self.max_iou_distance) and best_det_idx < len(
                        face_detections
                    ):
                        face_result = face_detections[best_det_idx].copy()
                        face_result["track_id"] = int(track.track_id)

                        result.append(face_result)
                        matched_detection_indices.add(best_det_idx)

                        # Mark this detection as used
                        iou_matrix[:, best_det_idx] = 0

        # Add unmatched detections with negative track IDs
        for det_idx, face in enumerate(face_detections):
            if det_idx not in matched_detection_indices:
                face_result = face.copy()
                face_result["track_id"] = -(det_idx + 1)

                result.append(face_result)

        return result

    def reset(self):
        """Reset tracker"""
        self.tracker = BYTETracker(self.args, frame_rate=self.frame_rate)

    def get_active_track_count(self) -> int:
        """Get number of active tracks"""
        return len(self.tracker.tracked_stracks)
