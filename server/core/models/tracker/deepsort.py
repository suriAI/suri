import numpy as np
from typing import List, Tuple, Optional, Dict
from .track import Track
from .utils import linear_assignment, iou_batch, cosine_distance


class DeepSort:
    """Deep SORT tracker with appearance features"""

    def __init__(
        self,
        max_age: int,
        n_init: int,
        max_iou_distance: float,
        max_cosine_distance: float,
        nn_budget: int,
        matching_weights: Dict[str, float] = None,
    ):
        self.max_age = max_age
        self.n_init = n_init
        self.max_iou_distance = max_iou_distance
        self.max_cosine_distance = max_cosine_distance

        if matching_weights is None:
            matching_weights = {"appearance": 0.7, "motion": 0.3}
        self.appearance_weight = matching_weights.get("appearance", 0.7)
        self.motion_weight = matching_weights.get("motion", 0.3)
        self.nn_budget = nn_budget

        self.tracks: List[Track] = []
        self.next_id = 1
        self.frame_count = 0

    def _match(
        self, detections: np.ndarray, features: Optional[np.ndarray]
    ) -> Tuple[List[Tuple[int, int]], List[int], List[int]]:
        """Match detections to tracks using cascade matching"""
        if len(self.tracks) == 0:
            return [], list(range(len(detections))), []

        confirmed_tracks = [i for i, t in enumerate(self.tracks) if t.is_confirmed()]
        unconfirmed_tracks = [i for i, t in enumerate(self.tracks) if t.is_tentative()]

        matches_a, unmatched_dets_a, unmatched_tracks_a = self._matching_cascade(
            detections, features, confirmed_tracks
        )

        iou_track_indices = unconfirmed_tracks + [k for k in unmatched_tracks_a]
        matches_b, unmatched_dets_b, unmatched_tracks_b = self._iou_matching(
            detections, iou_track_indices, unmatched_dets_a
        )

        matches = matches_a + matches_b
        unmatched_detections = unmatched_dets_b
        unmatched_tracks = [
            k for k in unmatched_tracks_a if k not in [m[1] for m in matches_b]
        ]

        return matches, unmatched_detections, unmatched_tracks

    def _matching_cascade(
        self,
        detections: np.ndarray,
        features: Optional[np.ndarray],
        track_indices: List[int],
    ) -> Tuple[List[Tuple[int, int]], List[int], List[int]]:
        """Cascade matching prioritizing recently seen tracks"""
        if not track_indices:
            return [], list(range(len(detections))), []

        matches = []
        unmatched_detections = list(range(len(detections)))

        for level in range(self.max_age):
            if not unmatched_detections:
                break

            track_indices_l = [
                k
                for k in track_indices
                if self.tracks[k].time_since_update == 1 + level
            ]

            if not track_indices_l:
                continue

            matches_l, _, unmatched_tracks_l = self._appearance_matching(
                detections[unmatched_detections],
                features[unmatched_detections] if features is not None else None,
                track_indices_l,
            )

            matches += [(unmatched_detections[m[0]], m[1]) for m in matches_l]
            unmatched_detections = [
                unmatched_detections[k]
                for k in range(len(unmatched_detections))
                if k not in [m[0] for m in matches_l]
            ]

        unmatched_tracks = [
            k for k in track_indices if k not in [m[1] for m in matches]
        ]

        return matches, unmatched_detections, unmatched_tracks

    def _appearance_matching(
        self,
        detections: np.ndarray,
        features: Optional[np.ndarray],
        track_indices: List[int],
    ) -> Tuple[List[Tuple[int, int]], List[int], List[int]]:
        """Match using appearance features + IOU"""
        if not track_indices or len(detections) == 0:
            return [], list(range(len(detections))), track_indices

        cost_matrix = np.zeros((len(detections), len(track_indices)))

        if features is not None:
            track_features = []
            for idx in track_indices:
                feat = self.tracks[idx].get_feature()
                if feat is not None:
                    track_features.append(feat)
                else:
                    track_features.append(np.zeros(features.shape[1]))

            track_features = np.array(track_features)
            appearance_cost = cosine_distance(features, track_features)
        else:
            appearance_cost = np.zeros((len(detections), len(track_indices)))

        track_bboxes = np.array([self.tracks[idx].get_state() for idx in track_indices])
        det_bboxes = detections[:, :4]
        iou_matrix = iou_batch(det_bboxes, track_bboxes)
        iou_cost = 1.0 - iou_matrix

        if features is not None:
            cost_matrix = (
                self.appearance_weight * appearance_cost + self.motion_weight * iou_cost
            )
        else:
            cost_matrix = iou_cost

        cost_matrix[appearance_cost > self.max_cosine_distance] = np.inf
        cost_matrix[iou_cost > self.max_iou_distance] = np.inf

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
                d
                for d in range(len(detections))
                if d not in [m[0] for m in matches_local]
            ]
            unmatched_tracks = [
                track_indices[t]
                for t in range(len(track_indices))
                if t not in [m[1] for m in matches_local]
            ]

        return matches, unmatched_detections, unmatched_tracks

    def _iou_matching(
        self,
        detections: np.ndarray,
        track_indices: List[int],
        detection_indices: List[int],
    ) -> Tuple[List[Tuple[int, int]], List[int], List[int]]:
        """Match using IOU only (for unconfirmed tracks)"""
        if not track_indices or not detection_indices:
            return [], detection_indices, track_indices

        track_bboxes = np.array([self.tracks[idx].get_state() for idx in track_indices])
        det_bboxes = detections[detection_indices, :4]

        iou_matrix = iou_batch(det_bboxes, track_bboxes)
        cost_matrix = 1.0 - iou_matrix

        cost_matrix[cost_matrix > self.max_iou_distance] = np.inf

        if np.all(np.isinf(cost_matrix)):
            return [], detection_indices, track_indices

        matches_local = linear_assignment(cost_matrix)

        matches = []
        for m in matches_local:
            if cost_matrix[m[0], m[1]] < np.inf:
                matches.append((detection_indices[m[0]], track_indices[m[1]]))

        unmatched_detections = [
            detection_indices[d]
            for d in range(len(detection_indices))
            if d not in [m[0] for m in matches_local]
        ]
        unmatched_tracks = [
            track_indices[t]
            for t in range(len(track_indices))
            if t not in [m[1] for m in matches_local]
        ]

        return matches, unmatched_detections, unmatched_tracks

    def update(
        self,
        detections: np.ndarray = np.empty((0, 5)),
        features: Optional[np.ndarray] = None,
    ) -> np.ndarray:
        """Update tracker with new detections"""
        self.frame_count += 1

        for track in self.tracks:
            track.predict()

        matches, unmatched_dets, unmatched_tracks = self._match(detections, features)

        for det_idx, track_idx in matches:
            bbox = detections[det_idx, :4]
            feature = features[det_idx] if features is not None else None
            self.tracks[track_idx].update(bbox, feature)

        for track_idx in unmatched_tracks:
            self.tracks[track_idx].mark_missed()

        for det_idx in unmatched_dets:
            bbox = detections[det_idx, :4]
            feature = features[det_idx] if features is not None else None
            track = Track(bbox, self.next_id, feature)
            self.tracks.append(track)
            self.next_id += 1

        for track in self.tracks:
            if track.is_tentative() and track.hits >= self.n_init:
                track.mark_confirmed()

        self.tracks = [t for t in self.tracks if t.time_since_update <= self.max_age]

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

