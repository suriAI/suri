"""
SORT: Simple Online and Realtime Tracking
Adapted from Alex Bewley's SORT tracker for face tracking in attendance system
https://github.com/abewley/sort

This module provides consistent face tracking across video frames using:
- Kalman filtering for motion prediction
- Hungarian algorithm for data association
- IOU-based matching between detections and tracks
"""

import logging
from typing import List, Dict, Optional, Tuple
import numpy as np
from filterpy.kalman import KalmanFilter

logger = logging.getLogger(__name__)

try:
    import lap
    USE_LAP = True
except ImportError:
    from scipy.optimize import linear_sum_assignment
    USE_LAP = False


def linear_assignment(cost_matrix: np.ndarray) -> np.ndarray:
    """
    Solve the linear assignment problem using LAP or scipy
    
    Args:
        cost_matrix: Cost matrix for assignment
        
    Returns:
        Array of matched indices [[det_idx, track_idx], ...]
    """
    if USE_LAP:
        _, x, y = lap.lapjv(cost_matrix, extend_cost=True)
        return np.array([[y[i], i] for i in x if i >= 0])
    else:
        x, y = linear_sum_assignment(cost_matrix)
        return np.array(list(zip(x, y)))


def iou_batch(bb_test: np.ndarray, bb_gt: np.ndarray) -> np.ndarray:
    """
    Compute IOU between two sets of bounding boxes
    Boxes should be in format [x1, y1, x2, y2]
    
    Args:
        bb_test: Test bounding boxes (N, 4)
        bb_gt: Ground truth bounding boxes (M, 4)
        
    Returns:
        IOU matrix (N, M)
    """
    bb_gt = np.expand_dims(bb_gt, 0)
    bb_test = np.expand_dims(bb_test, 1)
    
    xx1 = np.maximum(bb_test[..., 0], bb_gt[..., 0])
    yy1 = np.maximum(bb_test[..., 1], bb_gt[..., 1])
    xx2 = np.minimum(bb_test[..., 2], bb_gt[..., 2])
    yy2 = np.minimum(bb_test[..., 3], bb_gt[..., 3])
    
    w = np.maximum(0., xx2 - xx1)
    h = np.maximum(0., yy2 - yy1)
    wh = w * h
    
    area_test = (bb_test[..., 2] - bb_test[..., 0]) * (bb_test[..., 3] - bb_test[..., 1])
    area_gt = (bb_gt[..., 2] - bb_gt[..., 0]) * (bb_gt[..., 3] - bb_gt[..., 1])
    
    o = wh / (area_test + area_gt - wh)
    return o


def convert_bbox_to_z(bbox: np.ndarray) -> np.ndarray:
    """
    Convert bounding box from [x1, y1, x2, y2] to [x, y, s, r] format
    where x, y is center, s is scale/area, r is aspect ratio
    
    Args:
        bbox: Bounding box [x1, y1, x2, y2]
        
    Returns:
        Converted bbox [x, y, s, r]
    """
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = bbox[0] + w / 2.
    y = bbox[1] + h / 2.
    s = w * h  # scale is area
    r = w / float(h + 1e-6)  # aspect ratio with small epsilon
    return np.array([x, y, s, r]).reshape((4, 1))


def convert_x_to_bbox(x: np.ndarray, score: Optional[float] = None) -> np.ndarray:
    """
    Convert bounding box from [x, y, s, r] to [x1, y1, x2, y2] format
    
    Args:
        x: State vector [x, y, s, r, ...]
        score: Optional confidence score to append
        
    Returns:
        Bounding box [x1, y1, x2, y2] or [x1, y1, x2, y2, score]
    """
    w = np.sqrt(x[2] * x[3])
    h = x[2] / (w + 1e-6)
    
    if score is None:
        return np.array([
            x[0] - w/2.,
            x[1] - h/2.,
            x[0] + w/2.,
            x[1] + h/2.
        ]).reshape((1, 4))
    else:
        return np.array([
            x[0] - w/2.,
            x[1] - h/2.,
            x[0] + w/2.,
            x[1] + h/2.,
            score
        ]).reshape((1, 5))


class KalmanBoxTracker:
    """
    Represents the internal state of individual tracked objects observed as bbox
    Uses Kalman filter with constant velocity model
    """
    
    count = 0
    
    def __init__(self, bbox: np.ndarray):
        """
        Initialize tracker using initial bounding box
        
        Args:
            bbox: Initial bounding box [x1, y1, x2, y2]
        """
        # Define constant velocity model (7D state, 4D measurement)
        self.kf = KalmanFilter(dim_x=7, dim_z=4)
        
        # State transition matrix (constant velocity)
        self.kf.F = np.array([
            [1, 0, 0, 0, 1, 0, 0],  # x
            [0, 1, 0, 0, 0, 1, 0],  # y
            [0, 0, 1, 0, 0, 0, 1],  # s
            [0, 0, 0, 1, 0, 0, 0],  # r
            [0, 0, 0, 0, 1, 0, 0],  # vx
            [0, 0, 0, 0, 0, 1, 0],  # vy
            [0, 0, 0, 0, 0, 0, 1]   # vs
        ])
        
        # Measurement function (only observe position, not velocity)
        self.kf.H = np.array([
            [1, 0, 0, 0, 0, 0, 0],
            [0, 1, 0, 0, 0, 0, 0],
            [0, 0, 1, 0, 0, 0, 0],
            [0, 0, 0, 1, 0, 0, 0]
        ])
        
        # Measurement uncertainty (higher = trust measurements less)
        self.kf.R[2:, 2:] *= 10.
        
        # Covariance matrix (initial uncertainty)
        self.kf.P[4:, 4:] *= 1000.  # High uncertainty for unobservable velocities
        self.kf.P *= 10.
        
        # Process noise (model uncertainty)
        self.kf.Q[-1, -1] *= 0.01
        self.kf.Q[4:, 4:] *= 0.01
        
        # Initialize state with first bbox
        self.kf.x[:4] = convert_bbox_to_z(bbox)
        
        # Tracking state
        self.time_since_update = 0
        self.id = KalmanBoxTracker.count
        KalmanBoxTracker.count += 1
        self.history = []
        self.hits = 0
        self.hit_streak = 0
        self.age = 0
    
    def update(self, bbox: np.ndarray):
        """
        Update state with observed bbox
        
        Args:
            bbox: Observed bounding box [x1, y1, x2, y2]
        """
        self.time_since_update = 0
        self.history = []
        self.hits += 1
        self.hit_streak += 1
        self.kf.update(convert_bbox_to_z(bbox))
    
    def predict(self) -> np.ndarray:
        """
        Advance state and return predicted bbox
        
        Returns:
            Predicted bounding box [x1, y1, x2, y2]
        """
        # Prevent negative scale
        if (self.kf.x[6] + self.kf.x[2]) <= 0:
            self.kf.x[6] *= 0.0
        
        self.kf.predict()
        self.age += 1
        
        if self.time_since_update > 0:
            self.hit_streak = 0
        
        self.time_since_update += 1
        self.history.append(convert_x_to_bbox(self.kf.x))
        
        return self.history[-1]
    
    def get_state(self) -> np.ndarray:
        """
        Return current bounding box estimate
        
        Returns:
            Current bounding box [x1, y1, x2, y2]
        """
        return convert_x_to_bbox(self.kf.x)


def associate_detections_to_trackers(
    detections: np.ndarray,
    trackers: np.ndarray,
    iou_threshold: float = 0.3
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Assign detections to tracked objects using IOU
    
    Args:
        detections: Detected bounding boxes (N, 4 or 5)
        trackers: Tracked bounding boxes (M, 4 or 5)
        iou_threshold: Minimum IOU for match
        
    Returns:
        Tuple of (matches, unmatched_detections, unmatched_trackers)
        - matches: [[det_idx, track_idx], ...]
        - unmatched_detections: [det_idx, ...]
        - unmatched_trackers: [track_idx, ...]
    """
    if len(trackers) == 0:
        return (
            np.empty((0, 2), dtype=int),
            np.arange(len(detections)),
            np.empty((0, 5), dtype=int)
        )
    
    # Compute IOU matrix
    iou_matrix = iou_batch(detections, trackers)
    
    if min(iou_matrix.shape) > 0:
        a = (iou_matrix > iou_threshold).astype(np.int32)
        if a.sum(1).max() == 1 and a.sum(0).max() == 1:
            # Simple case: one-to-one matching
            matched_indices = np.stack(np.where(a), axis=1)
        else:
            # Complex case: use Hungarian algorithm
            matched_indices = linear_assignment(-iou_matrix)
    else:
        matched_indices = np.empty(shape=(0, 2))
    
    # Find unmatched detections
    unmatched_detections = []
    for d, det in enumerate(detections):
        if d not in matched_indices[:, 0]:
            unmatched_detections.append(d)
    
    # Find unmatched trackers
    unmatched_trackers = []
    for t, trk in enumerate(trackers):
        if t not in matched_indices[:, 1]:
            unmatched_trackers.append(t)
    
    # Filter out matched with low IOU
    matches = []
    for m in matched_indices:
        if iou_matrix[m[0], m[1]] < iou_threshold:
            unmatched_detections.append(m[0])
            unmatched_trackers.append(m[1])
        else:
            matches.append(m.reshape(1, 2))
    
    if len(matches) == 0:
        matches = np.empty((0, 2), dtype=int)
    else:
        matches = np.concatenate(matches, axis=0)
    
    return matches, np.array(unmatched_detections), np.array(unmatched_trackers)


class Sort:
    """
    SORT tracker: Simple Online and Realtime Tracking
    """
    
    def __init__(
        self,
        max_age: int = 30,
        min_hits: int = 3,
        iou_threshold: float = 0.3
    ):
        """
        Initialize SORT tracker
        
        Args:
            max_age: Maximum frames to keep alive a track without detections
            min_hits: Minimum hits before track is returned
            iou_threshold: Minimum IOU for matching detections to tracks
        """
        self.max_age = max_age
        self.min_hits = min_hits
        self.iou_threshold = iou_threshold
        self.trackers: List[KalmanBoxTracker] = []
        self.frame_count = 0
    
    def update(self, dets: np.ndarray = np.empty((0, 5))) -> np.ndarray:
        """
        Update tracker with detections for current frame
        
        Args:
            dets: Detections array [[x1, y1, x2, y2, score], ...]
                  Must be called once per frame even with empty detections
        
        Returns:
            Array of active tracks [[x1, y1, x2, y2, track_id], ...]
        """
        self.frame_count += 1
        
        # Get predicted locations from existing trackers
        trks = np.zeros((len(self.trackers), 5))
        to_del = []
        ret = []
        
        for t, trk in enumerate(trks):
            pos = self.trackers[t].predict()[0]
            trk[:] = [pos[0], pos[1], pos[2], pos[3], 0]
            if np.any(np.isnan(pos)):
                to_del.append(t)
        
        trks = np.ma.compress_rows(np.ma.masked_invalid(trks))
        
        # Remove invalid trackers
        for t in reversed(to_del):
            self.trackers.pop(t)
        
        # Associate detections to trackers
        matched, unmatched_dets, unmatched_trks = associate_detections_to_trackers(
            dets, trks, self.iou_threshold
        )
        
        # Update matched trackers with assigned detections
        for m in matched:
            self.trackers[m[1]].update(dets[m[0], :])
        
        # Create new trackers for unmatched detections
        for i in unmatched_dets:
            trk = KalmanBoxTracker(dets[i, :])
            self.trackers.append(trk)
        
        # Return active tracks
        i = len(self.trackers)
        for trk in reversed(self.trackers):
            d = trk.get_state()[0]
            
            # Return track if it meets minimum hits requirement
            if (trk.time_since_update < 1) and (
                trk.hit_streak >= self.min_hits or
                self.frame_count <= self.min_hits
            ):
                # Use 1-indexed track ID for MOT benchmark compatibility
                ret.append(np.concatenate((d, [trk.id + 1])).reshape(1, -1))
            
            i -= 1
            
            # Remove dead tracks
            if trk.time_since_update > self.max_age:
                self.trackers.pop(i)
        
        if len(ret) > 0:
            return np.concatenate(ret)
        
        return np.empty((0, 5))
    
    def reset(self):
        """Reset tracker to initial state"""
        self.trackers = []
        self.frame_count = 0
        KalmanBoxTracker.count = 0
    
    def get_track_count(self) -> int:
        """Get number of active tracks"""
        return len(self.trackers)


class FaceTracker:
    """
    Wrapper around SORT tracker for face tracking in attendance system
    Provides a simpler interface for face detection integration
    """
    
    def __init__(
        self,
        max_age: int = 30,
        min_hits: int = 3,
        iou_threshold: float = 0.3
    ):
        """
        Initialize face tracker
        
        Args:
            max_age: Maximum frames to keep track alive without detection
            min_hits: Minimum detections before track is considered valid
            iou_threshold: Minimum IOU for matching faces to tracks
        """
        self.tracker = Sort(
            max_age=max_age,
            min_hits=min_hits,
            iou_threshold=iou_threshold
        )
    
    def update(self, face_detections: List[Dict]) -> List[Dict]:
        """
        Update tracker with face detections
        
        Args:
            face_detections: List of face detection dicts with 'bbox' key
                            bbox format: [x, y, width, height] or dict with x,y,width,height
        
        Returns:
            List of face detections with added 'track_id' field
        """
        if not face_detections:
            # Update with empty detections to advance tracker state
            self.tracker.update(np.empty((0, 5)))
            return []
        
        # Convert face detections to SORT format [x1, y1, x2, y2, score]
        dets = []
        for face in face_detections:
            bbox = face.get('bbox', face.get('box', {}))
            
            # Handle both dict and list bbox formats
            if isinstance(bbox, dict):
                x = bbox.get('x', 0)
                y = bbox.get('y', 0)
                width = bbox.get('width', 0)
                height = bbox.get('height', 0)
            elif isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
                x, y, width, height = bbox[:4]
            else:
                logger.warning(f"Invalid bbox format: {bbox}")
                continue
            
            # Convert to [x1, y1, x2, y2, score] format
            x1, y1 = x, y
            x2, y2 = x + width, y + height
            score = face.get('confidence', face.get('score', 1.0))
            
            dets.append([x1, y1, x2, y2, score])
        
        if not dets:
            self.tracker.update(np.empty((0, 5)))
            return []
        
        # Convert to numpy array and update tracker
        dets_array = np.array(dets, dtype=np.float32)
        tracks = self.tracker.update(dets_array)
        
        # Map track IDs back to face detections
        # IMPORTANT: Return ALL face detections, not just tracked ones
        # This prevents faces from disappearing during initial tracking phase
        result = []
        matched_detection_indices = set()
        
        if len(tracks) > 0:
            track_bboxes = tracks[:, :4]
            det_bboxes = dets_array[:, :4]
            
            # Compute IOU between tracks and detections
            iou_matrix = iou_batch(track_bboxes, det_bboxes)
            
            # Assign tracks to detections using best IOU match
            for track_idx, track in enumerate(tracks):
                # Find best matching detection
                best_det_idx = np.argmax(iou_matrix[track_idx])
                best_iou = iou_matrix[track_idx, best_det_idx]
                
                # Only assign if IOU is above threshold
                if best_iou > 0.3:
                    # Create result with track ID
                    face_result = face_detections[best_det_idx].copy()
                    face_result['track_id'] = int(track[4])  # Last column is track ID
                    result.append(face_result)
                    matched_detection_indices.add(best_det_idx)
                    
                    # Mark this detection as used
                    iou_matrix[:, best_det_idx] = 0
        
        # Add unmatched detections WITH temporary negative track_id
        # This ensures ALL faces have track_id for consistent frontend handling
        # Use negative IDs to distinguish temporary tracks from confirmed SORT tracks
        for det_idx, face in enumerate(face_detections):
            if det_idx not in matched_detection_indices:
                # Assign temporary negative track_id until SORT confirms the track
                # This allows frontend to track faces consistently even in first frame
                face_result = face.copy()
                face_result['track_id'] = -(det_idx + 1)  # -1, -2, -3, etc.
                result.append(face_result)
        
        return result
    
    def reset(self):
        """Reset tracker to initial state"""
        self.tracker.reset()
    
    def get_active_track_count(self) -> int:
        """Get number of currently active tracks"""
        return self.tracker.get_track_count()
