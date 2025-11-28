from collections import defaultdict
from typing import Tuple


class TemporalSmoother:
    def __init__(
        self, alpha: float, max_stale_frames: int = 30, cleanup_interval: int = 10
    ):
        self.alpha = max(0.0, min(1.0, alpha))  # Clamp to [0, 1]
        self.max_stale_frames = max_stale_frames
        self.cleanup_interval = cleanup_interval
        self.current_frame = 0
        self.last_cleanup_frame = 0

        # Store smoothed scores per track_id
        # Format: {track_id: {"live": float, "spoof": float, "last_frame": int}}
        self.track_states = defaultdict(
            lambda: {"live": None, "spoof": None, "last_frame": -1}
        )

    def smooth(
        self, track_id: int, live_score: float, spoof_score: float, frame_number: int
    ) -> Tuple[float, float]:
        """
        Apply temporal smoothing to scores for a given track_id.

        Args:
            track_id: Unique identifier for the tracked face
            live_score: Current raw live score
            spoof_score: Current raw spoof score
            frame_number: Current video frame number (global frame counter)

        Returns:
            Tuple of (smoothed_live_score, smoothed_spoof_score)
        """
        if frame_number < 0:
            frame_number = 0
            
        if frame_number < self.current_frame:
            frame_number = self.current_frame
            
        self.current_frame = frame_number
        state = self.track_states[track_id]

        # First observation: initialize with current scores
        if state["live"] is None or state["spoof"] is None:
            smoothed_live = live_score
            smoothed_spoof = spoof_score
        else:
            # Apply EMA
            smoothed_live = self.alpha * live_score + (1 - self.alpha) * state["live"]
            smoothed_spoof = (
                self.alpha * spoof_score + (1 - self.alpha) * state["spoof"]
            )

        # Update state
        state["live"] = smoothed_live
        state["spoof"] = smoothed_spoof
        state["last_frame"] = frame_number

        return smoothed_live, smoothed_spoof

    def cleanup_stale_tracks(self, force: bool = False):
        """
        Remove tracks that haven't been seen for max_stale_frames.

        Args:
            force: If True, run cleanup regardless of interval (for testing).
        """
        if (
            not force
            and self.last_cleanup_frame > 0
            and (self.current_frame - self.last_cleanup_frame) < self.cleanup_interval
        ):
            return

        stale_tracks = [
            track_id
            for track_id, state in self.track_states.items()
            if self.current_frame - state["last_frame"] > self.max_stale_frames
        ]

        # Also remove any negative track IDs (untracked faces shouldn't use temporal smoothing)
        negative_tracks = [
            track_id
            for track_id in self.track_states.keys()
            if track_id < 0
        ]
        stale_tracks.extend(negative_tracks)

        for track_id in stale_tracks:
            del self.track_states[track_id]

        self.last_cleanup_frame = self.current_frame

    def reset(self):
        """Reset all track states (useful for testing or full reset)."""
        self.track_states.clear()
        self.current_frame = 0
        self.last_cleanup_frame = 0
