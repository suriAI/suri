import logging
from typing import List, Dict, Optional, Tuple
import numpy as np
from filterpy.kalman import KalmanFilter
from scipy.spatial.distance import cdist

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


def cosine_distance(features: np.ndarray, gallery: np.ndarray) -> np.ndarray:
    """
    Compute cosine distance between features and gallery
    Distance = 1 - cosine_similarity
    
    Args:
        features: Query features (N, dim)
        gallery: Gallery features (M, dim)
        
    Returns:
        Distance matrix (N, M) with values in [0, 2]
    """
    # Normalize features
    features = features / (np.linalg.norm(features, axis=1, keepdims=True) + 1e-6)
    gallery = gallery / (np.linalg.norm(gallery, axis=1, keepdims=True) + 1e-6)
    
    # Compute cosine similarity
    similarity = np.dot(features, gallery.T)
    
    # Convert to distance (0 = identical, 2 = opposite)
    distance = 1.0 - similarity
    
    return distance


class Track:
    """
    A single track with Kalman filter and appearance features
    """
    
    def __init__(self, bbox: np.ndarray, track_id: int, feature: Optional[np.ndarray] = None):
        """
        Initialize track
        
        Args:
            bbox: Initial bounding box [x1, y1, x2, y2]
            track_id: Unique track ID
            feature: Initial appearance feature vector (512-dim for face recognizer)
        """
        # Kalman filter setup (same as SORT)
        self.kf = KalmanFilter(dim_x=7, dim_z=4)
        
        # State transition matrix (constant velocity)
        self.kf.F = np.array([
            [1, 0, 0, 0, 1, 0, 0],
            [0, 1, 0, 0, 0, 1, 0],
            [0, 0, 1, 0, 0, 0, 1],
            [0, 0, 0, 1, 0, 0, 0],
            [0, 0, 0, 0, 1, 0, 0],
            [0, 0, 0, 0, 0, 1, 0],
            [0, 0, 0, 0, 0, 0, 1]
        ])
        
        # Measurement function
        self.kf.H = np.array([
            [1, 0, 0, 0, 0, 0, 0],
            [0, 1, 0, 0, 0, 0, 0],
            [0, 0, 1, 0, 0, 0, 0],
            [0, 0, 0, 1, 0, 0, 0]
        ])
        
        # Measurement uncertainty
        self.kf.R[2:, 2:] *= 10.
        
        # Covariance matrix
        self.kf.P[4:, 4:] *= 1000.
        self.kf.P *= 10.
        
        # Process noise
        self.kf.Q[-1, -1] *= 0.01
        self.kf.Q[4:, 4:] *= 0.01
        
        # Initialize state
        self.kf.x[:4] = convert_bbox_to_z(bbox)
        
        # Track state
        self.track_id = track_id
        self.time_since_update = 0
        self.hits = 1
        self.hit_streak = 1
        self.age = 0
        self.state = 'tentative'  # 'tentative' or 'confirmed'
        
        # Appearance features (Deep SORT addition)
        self.features = []
        if feature is not None:
            self.features.append(feature)
        
        # 🚀 OPTIMIZED: Reduced from 100 to 30 for faster matching
        self.feature_budget = 30  # Maximum features to store
    
    def predict(self) -> np.ndarray:
        """
        Predict next state using Kalman filter
        
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
        
        return convert_x_to_bbox(self.kf.x)[0]
    
    def update(self, bbox: np.ndarray, feature: Optional[np.ndarray] = None):
        """
        Update track with new detection
        
        Args:
            bbox: Detected bounding box [x1, y1, x2, y2]
            feature: Appearance feature vector
        """
        self.time_since_update = 0
        self.hits += 1
        self.hit_streak += 1
        
        # Update Kalman filter
        self.kf.update(convert_bbox_to_z(bbox))
        
        # Update appearance features
        if feature is not None:
            self.features.append(feature)
            # Keep only recent features (budget limit)
            if len(self.features) > self.feature_budget:
                self.features.pop(0)
    
    def mark_confirmed(self):
        """Mark track as confirmed"""
        self.state = 'confirmed'
    
    def mark_missed(self):
        """Mark track as missed"""
        self.time_since_update += 1
        if self.time_since_update > 0:
            self.hit_streak = 0
    
    def is_confirmed(self) -> bool:
        """Check if track is confirmed"""
        return self.state == 'confirmed'
    
    def is_tentative(self) -> bool:
        """Check if track is tentative"""
        return self.state == 'tentative'
    
    def get_state(self) -> np.ndarray:
        """
        Get current bounding box
        
        Returns:
            Current bounding box [x1, y1, x2, y2]
        """
        return convert_x_to_bbox(self.kf.x)[0]
    
    def get_feature(self) -> Optional[np.ndarray]:
        """
        Get average appearance feature
        
        Returns:
            Average feature vector or None
        """
        if not self.features:
            return None
        
        # Return average of stored features
        avg_feature = np.mean(self.features, axis=0)
        # Normalize
        norm = np.linalg.norm(avg_feature)
        if norm > 0:
            avg_feature = avg_feature / norm
        
        return avg_feature


class DeepSort:
    """
    Deep SORT tracker with appearance features
    """
    
    def __init__(
        self,
        max_age: int = 30,
        n_init: int = 3,
        max_iou_distance: float = 0.7,
        max_cosine_distance: float = 0.3,
        nn_budget: int = 100,
        matching_weights: Dict[str, float] = None
    ):
        """
        Initialize Deep SORT tracker
        
        Args:
            max_age: Maximum frames to keep alive a track without detections
            n_init: Number of consecutive detections before track is confirmed
            max_iou_distance: Maximum IOU distance for matching (1 - IOU)
            max_cosine_distance: Maximum cosine distance for appearance matching
            nn_budget: Maximum size of appearance feature gallery per track
            matching_weights: Weights for appearance vs motion matching
        """
        self.max_age = max_age
        self.n_init = n_init
        self.max_iou_distance = max_iou_distance
        self.max_cosine_distance = max_cosine_distance
        
        # Set matching weights with defaults
        if matching_weights is None:
            matching_weights = {"appearance": 0.7, "motion": 0.3}
        self.appearance_weight = matching_weights.get("appearance", 0.7)
        self.motion_weight = matching_weights.get("motion", 0.3)
        self.nn_budget = nn_budget
        
        self.tracks: List[Track] = []
        self.next_id = 1
        self.frame_count = 0
    
    def _match(
        self,
        detections: np.ndarray,
        features: Optional[np.ndarray]
    ) -> Tuple[List[Tuple[int, int]], List[int], List[int]]:
        """
        Match detections to tracks using cascade matching
        
        Args:
            detections: Detection bounding boxes [[x1, y1, x2, y2, score], ...]
            features: Appearance features (N, dim) or None
            
        Returns:
            Tuple of (matches, unmatched_detections, unmatched_tracks)
        """
        if len(self.tracks) == 0:
            return [], list(range(len(detections))), []
        
        # Get confirmed and unconfirmed tracks
        confirmed_tracks = [i for i, t in enumerate(self.tracks) if t.is_confirmed()]
        unconfirmed_tracks = [i for i, t in enumerate(self.tracks) if t.is_tentative()]
        
        # Step 1: Matching cascade for confirmed tracks (prioritize recent)
        matches_a, unmatched_dets_a, unmatched_tracks_a = self._matching_cascade(
            detections, features, confirmed_tracks
        )
        
        # Step 2: IOU matching for unconfirmed tracks
        iou_track_indices = unconfirmed_tracks + [
            k for k in unmatched_tracks_a
        ]
        
        matches_b, unmatched_dets_b, unmatched_tracks_b = self._iou_matching(
            detections, iou_track_indices, unmatched_dets_a
        )
        
        # Combine results
        matches = matches_a + matches_b
        unmatched_detections = unmatched_dets_b
        unmatched_tracks = [k for k in unmatched_tracks_a if k not in [m[1] for m in matches_b]]
        
        return matches, unmatched_detections, unmatched_tracks
    
    def _matching_cascade(
        self,
        detections: np.ndarray,
        features: Optional[np.ndarray],
        track_indices: List[int]
    ) -> Tuple[List[Tuple[int, int]], List[int], List[int]]:
        """
        Cascade matching prioritizing recently seen tracks
        
        Args:
            detections: Detection bounding boxes
            features: Appearance features
            track_indices: Indices of tracks to match
            
        Returns:
            Tuple of (matches, unmatched_detections, unmatched_tracks)
        """
        if not track_indices:
            return [], list(range(len(detections))), []
        
        matches = []
        unmatched_detections = list(range(len(detections)))
        
        # Cascade matching based on time_since_update
        for level in range(self.max_age):
            if not unmatched_detections:
                break
            
            # Get tracks at this cascade level
            track_indices_l = [
                k for k in track_indices
                if self.tracks[k].time_since_update == 1 + level
            ]
            
            if not track_indices_l:
                continue
            
            # Match using appearance + motion
            matches_l, _, unmatched_tracks_l = self._appearance_matching(
                detections[unmatched_detections],
                features[unmatched_detections] if features is not None else None,
                track_indices_l
            )
            
            # Convert local indices to global
            matches += [
                (unmatched_detections[m[0]], m[1]) for m in matches_l
            ]
            unmatched_detections = [
                unmatched_detections[k] for k in range(len(unmatched_detections))
                if k not in [m[0] for m in matches_l]
            ]
        
        unmatched_tracks = [k for k in track_indices if k not in [m[1] for m in matches]]
        
        return matches, unmatched_detections, unmatched_tracks
    
    def _appearance_matching(
        self,
        detections: np.ndarray,
        features: Optional[np.ndarray],
        track_indices: List[int]
    ) -> Tuple[List[Tuple[int, int]], List[int], List[int]]:
        """
        Match using appearance features + IOU
        
        Args:
            detections: Detection bounding boxes
            features: Appearance features
            track_indices: Indices of tracks to match
            
        Returns:
            Tuple of (matches, unmatched_detections, unmatched_tracks)
        """
        if not track_indices or len(detections) == 0:
            return [], list(range(len(detections))), track_indices
        
        # Build cost matrix
        cost_matrix = np.zeros((len(detections), len(track_indices)))
        
        # Appearance cost
        if features is not None:
            track_features = []
            for idx in track_indices:
                feat = self.tracks[idx].get_feature()
                if feat is not None:
                    track_features.append(feat)
                else:
                    # No feature available, use zeros (will be gated out)
                    track_features.append(np.zeros(features.shape[1]))
            
            track_features = np.array(track_features)
            appearance_cost = cosine_distance(features, track_features)
        else:
            appearance_cost = np.zeros((len(detections), len(track_indices)))
        
        # Motion cost (IOU)
        track_bboxes = np.array([self.tracks[idx].get_state() for idx in track_indices])
        det_bboxes = detections[:, :4]
        iou_matrix = iou_batch(det_bboxes, track_bboxes)
        iou_cost = 1.0 - iou_matrix
        
        # Combined cost: configurable appearance + motion weights
        if features is not None:
            cost_matrix = self.appearance_weight * appearance_cost + self.motion_weight * iou_cost
        else:
            # Fallback to IOU only if no features
            cost_matrix = iou_cost
        
        # Gate with thresholds
        cost_matrix[appearance_cost > self.max_cosine_distance] = np.inf
        cost_matrix[iou_cost > self.max_iou_distance] = np.inf
        
        # Linear assignment
        if np.all(np.isinf(cost_matrix)):
            matches = []
            unmatched_detections = list(range(len(detections)))
            unmatched_tracks = track_indices
        else:
            matches_local = linear_assignment(cost_matrix)
            
            matches = []
            for m in matches_local:
                if cost_matrix[m[0], m[1]] < np.inf:
                    matches.append((m[0], track_indices[m[1]]))
            
            unmatched_detections = [
                d for d in range(len(detections))
                if d not in [m[0] for m in matches_local]
            ]
            unmatched_tracks = [
                track_indices[t] for t in range(len(track_indices))
                if t not in [m[1] for m in matches_local]
            ]
        
        return matches, unmatched_detections, unmatched_tracks
    
    def _iou_matching(
        self,
        detections: np.ndarray,
        track_indices: List[int],
        detection_indices: List[int]
    ) -> Tuple[List[Tuple[int, int]], List[int], List[int]]:
        """
        Match using IOU only (for unconfirmed tracks)
        
        Args:
            detections: All detections
            track_indices: Track indices to match
            detection_indices: Detection indices to match
            
        Returns:
            Tuple of (matches, unmatched_detections, unmatched_tracks)
        """
        if not track_indices or not detection_indices:
            return [], detection_indices, track_indices
        
        # Build IOU cost matrix
        track_bboxes = np.array([self.tracks[idx].get_state() for idx in track_indices])
        det_bboxes = detections[detection_indices, :4]
        
        iou_matrix = iou_batch(det_bboxes, track_bboxes)
        cost_matrix = 1.0 - iou_matrix
        
        # Gate with threshold
        cost_matrix[cost_matrix > self.max_iou_distance] = np.inf
        
        # Linear assignment
        if np.all(np.isinf(cost_matrix)):
            return [], detection_indices, track_indices
        
        matches_local = linear_assignment(cost_matrix)
        
        matches = []
        for m in matches_local:
            if cost_matrix[m[0], m[1]] < np.inf:
                matches.append((detection_indices[m[0]], track_indices[m[1]]))
        
        unmatched_detections = [
            detection_indices[d] for d in range(len(detection_indices))
            if d not in [m[0] for m in matches_local]
        ]
        unmatched_tracks = [
            track_indices[t] for t in range(len(track_indices))
            if t not in [m[1] for m in matches_local]
        ]
        
        return matches, unmatched_detections, unmatched_tracks
    
    def update(
        self,
        detections: np.ndarray = np.empty((0, 5)),
        features: Optional[np.ndarray] = None
    ) -> np.ndarray:
        """
        Update tracker with new detections
        
        Args:
            detections: Detections [[x1, y1, x2, y2, score], ...]
            features: Appearance features (N, 512) for face recognizer
            
        Returns:
            Array of active tracks [[x1, y1, x2, y2, track_id], ...]
        """
        self.frame_count += 1
        
        # Predict all tracks
        for track in self.tracks:
            track.predict()
        
        # Match detections to tracks
        matches, unmatched_dets, unmatched_tracks = self._match(detections, features)
        
        # Update matched tracks
        for det_idx, track_idx in matches:
            bbox = detections[det_idx, :4]
            feature = features[det_idx] if features is not None else None
            self.tracks[track_idx].update(bbox, feature)
        
        # Mark unmatched tracks as missed
        for track_idx in unmatched_tracks:
            self.tracks[track_idx].mark_missed()
        
        # Create new tracks for unmatched detections
        for det_idx in unmatched_dets:
            bbox = detections[det_idx, :4]
            feature = features[det_idx] if features is not None else None
            track = Track(bbox, self.next_id, feature)
            self.tracks.append(track)
            self.next_id += 1
        
        # Confirm tracks that have enough hits
        for track in self.tracks:
            if track.is_tentative() and track.hits >= self.n_init:
                track.mark_confirmed()
        
        # Delete old tracks
        self.tracks = [
            t for t in self.tracks
            if t.time_since_update <= self.max_age
        ]
        
        # Return active confirmed tracks
        ret = []
        for track in self.tracks:
            if not track.is_confirmed():
                continue
            
            if track.time_since_update > 1:
                continue
            
            bbox = track.get_state()
            ret.append(np.concatenate((bbox, [track.track_id])).reshape(1, -1))
        
        if len(ret) > 0:
            return np.concatenate(ret)
        
        return np.empty((0, 5))
    
    def reset(self):
        """Reset tracker to initial state"""
        self.tracks = []
        self.next_id = 1
        self.frame_count = 0
    
    def get_track_count(self) -> int:
        """Get number of active tracks"""
        return len(self.tracks)


class FaceTracker:
    """
    Wrapper around Deep SORT for face tracking with appearance features
    Provides integration with face recognizer
    """
    
    def __init__(
        self,
        max_age: int = 30,
        n_init: int = 3,
        max_iou_distance: float = 0.7,
        max_cosine_distance: float = 0.3,
        nn_budget: int = 100,
        matching_weights: Dict[str, float] = None
    ):
        """
        Initialize Deep SORT face tracker
        
        Args:
            max_age: Maximum frames to keep track alive without detection
            n_init: Number of consecutive detections before track is confirmed
            max_iou_distance: Maximum IOU distance (1 - IOU threshold)
            max_cosine_distance: Maximum cosine distance for appearance
            nn_budget: Maximum size of feature gallery per track
            matching_weights: Weights for appearance vs motion matching
        """
        self.tracker = DeepSort(
            max_age=max_age,
            n_init=n_init,
            max_iou_distance=max_iou_distance,
            max_cosine_distance=max_cosine_distance,
            nn_budget=nn_budget,
            matching_weights=matching_weights
        )
        self.max_iou_distance = max_iou_distance
        
        # Set matching weights with defaults
        if matching_weights is None:
            matching_weights = {"appearance": 0.7, "motion": 0.3}
        self.appearance_weight = matching_weights.get("appearance", 0.7)
        self.motion_weight = matching_weights.get("motion", 0.3)
    
    def update(
        self,
        face_detections: List[Dict],
        embeddings: Optional[List[np.ndarray]] = None
    ) -> List[Dict]:
        """
        Update tracker with face detections and embeddings
        
        Args:
            face_detections: List of face detection dicts with 'bbox' key
            embeddings: List of appearance embeddings (512-dim for face recognizer)
            
        Returns:
            List of face detections with added 'track_id' field
        """
        if not face_detections:
            # Update with empty detections
            self.tracker.update(np.empty((0, 5)), None)
            return []
        
        # Convert to SORT format
        dets = []
        for face in face_detections:
            bbox = face.get('bbox', face.get('box', {}))
            
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
            
            x1, y1 = x, y
            x2, y2 = x + width, y + height
            score = face.get('confidence', face.get('score', 1.0))
            
            dets.append([x1, y1, x2, y2, score])
        
        if not dets:
            self.tracker.update(np.empty((0, 5)), None)
            return []
        
        # Convert to numpy arrays
        dets_array = np.array(dets, dtype=np.float32)
        
        # Convert embeddings to numpy array
        features_array = None
        if embeddings is not None and len(embeddings) == len(dets):
            features_array = np.array(embeddings, dtype=np.float32)
        
        # Update tracker
        tracks = self.tracker.update(dets_array, features_array)
        
        # Map tracks back to detections
        result = []
        matched_detection_indices = set()
        
        if len(tracks) > 0:
            track_bboxes = tracks[:, :4]
            det_bboxes = dets_array[:, :4]
            
            # Compute IOU for assignment
            iou_matrix = iou_batch(track_bboxes, det_bboxes)
            
            # Assign tracks to detections
            for track_idx, track in enumerate(tracks):
                best_det_idx = np.argmax(iou_matrix[track_idx])
                best_iou = iou_matrix[track_idx, best_det_idx]
                
                # Threshold check
                if best_iou > (1.0 - self.max_iou_distance):
                    face_result = face_detections[best_det_idx].copy()
                    face_result['track_id'] = int(track[4])
                    
                    # Add embedding if available
                    if embeddings is not None and best_det_idx < len(embeddings):
                        face_result['embedding'] = embeddings[best_det_idx]
                    
                    result.append(face_result)
                    matched_detection_indices.add(best_det_idx)
                    
                    # Clear this detection
                    iou_matrix[:, best_det_idx] = 0
        
        # Add unmatched detections with temporary IDs
        for det_idx, face in enumerate(face_detections):
            if det_idx not in matched_detection_indices:
                face_result = face.copy()
                face_result['track_id'] = -(det_idx + 1)
                
                # Add embedding if available
                if embeddings is not None and det_idx < len(embeddings):
                    face_result['embedding'] = embeddings[det_idx]
                
                result.append(face_result)
        
        return result
    
    def reset(self):
        """Reset tracker"""
        self.tracker.reset()
    
    def get_active_track_count(self) -> int:
        """Get number of active tracks"""
        return self.tracker.get_track_count()


