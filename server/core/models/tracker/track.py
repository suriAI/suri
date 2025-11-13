import numpy as np
from typing import Optional
from filterpy.kalman import KalmanFilter
from .utils import convert_bbox_to_z, convert_x_to_bbox


class Track:
    """A single track with Kalman filter and appearance features"""

    def __init__(
        self, bbox: np.ndarray, track_id: int, feature: Optional[np.ndarray] = None
    ):
        self.kf = KalmanFilter(dim_x=7, dim_z=4)

        self.kf.F = np.array(
            [
                [1, 0, 0, 0, 1, 0, 0],
                [0, 1, 0, 0, 0, 1, 0],
                [0, 0, 1, 0, 0, 0, 1],
                [0, 0, 0, 1, 0, 0, 0],
                [0, 0, 0, 0, 1, 0, 0],
                [0, 0, 0, 0, 0, 1, 0],
                [0, 0, 0, 0, 0, 0, 1],
            ]
        )

        self.kf.H = np.array(
            [
                [1, 0, 0, 0, 0, 0, 0],
                [0, 1, 0, 0, 0, 0, 0],
                [0, 0, 1, 0, 0, 0, 0],
                [0, 0, 0, 1, 0, 0, 0],
            ]
        )

        self.kf.R[2:, 2:] *= 10.0
        self.kf.P[4:, 4:] *= 1000.0
        self.kf.P *= 10.0
        self.kf.Q[-1, -1] *= 0.01
        self.kf.Q[4:, 4:] *= 0.01

        self.kf.x[:4] = convert_bbox_to_z(bbox)

        self.track_id = track_id
        self.time_since_update = 0
        self.hits = 1
        self.hit_streak = 1
        self.age = 0
        self.state = "tentative"

        self.features = []
        if feature is not None:
            self.features.append(feature)

        self.feature_budget = 5

    def predict(self) -> np.ndarray:
        """Predict next state using Kalman filter"""
        if (self.kf.x[6] + self.kf.x[2]) <= 0:
            self.kf.x[6] *= 0.0

        self.kf.predict()
        self.age += 1

        if self.time_since_update > 0:
            self.hit_streak = 0

        self.time_since_update += 1
        return convert_x_to_bbox(self.kf.x)[0]

    def update(self, bbox: np.ndarray, feature: Optional[np.ndarray] = None):
        """Update track with new detection"""
        self.time_since_update = 0
        self.hits += 1
        self.hit_streak += 1

        self.kf.update(convert_bbox_to_z(bbox))

        if feature is not None:
            self.features.append(feature)
            if len(self.features) > self.feature_budget:
                self.features.pop(0)

    def mark_confirmed(self):
        """Mark track as confirmed"""
        self.state = "confirmed"

    def mark_missed(self):
        """Mark track as missed"""
        self.time_since_update += 1
        if self.time_since_update > 0:
            self.hit_streak = 0

    def is_confirmed(self) -> bool:
        """Check if track is confirmed"""
        return self.state == "confirmed"

    def is_tentative(self) -> bool:
        """Check if track is tentative"""
        return self.state == "tentative"

    def get_state(self) -> np.ndarray:
        """Get current bounding box"""
        return convert_x_to_bbox(self.kf.x)[0]

    def get_feature(self) -> Optional[np.ndarray]:
        """Get average appearance feature"""
        if not self.features:
            return None

        avg_feature = np.mean(self.features, axis=0)
        norm = np.linalg.norm(avg_feature)
        if norm > 0:
            avg_feature = avg_feature / norm

        return avg_feature

