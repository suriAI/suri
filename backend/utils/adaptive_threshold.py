import logging
from typing import Dict, Optional

logger = logging.getLogger(__name__)


class AdaptiveThresholdManager:
    def __init__(
        self,
        base_threshold: float = 0.65,
        min_threshold: float = 0.40,
        max_threshold: float = 0.85
    ):
        """
        Initialize adaptive threshold manager with RANK 1 optimal values.
        
        Args:
            base_threshold: Base threshold for ensemble (0.65 = RANK 1 optimal)
            min_threshold: Minimum allowed threshold (0.40 = very permissive)
            max_threshold: Maximum allowed threshold (0.85 = very strict)
        """
        self.base_threshold = base_threshold
        self.min_threshold = min_threshold
        self.max_threshold = max_threshold
        
        # RANK 1 OPTIMAL BOOST FACTORS (research-backed values)
        self.boost_factors = {
            "both_models_agree": 0.15,      # Strong consensus
            "high_quality_crop": 0.10,      # Clear image
            "stable_tracking": 0.10,        # Long history
            "temporal_consistency": 0.15,   # Natural behavior
        }
        
        # RANK 1 OPTIMAL PENALTY FACTORS
        self.penalty_factors = {
            "models_disagree": 0.10,        # Conflicting signals
            "poor_quality": 0.10,           # Bad image
            "short_tracking": 0.05,         # New track
            "temporal_anomaly": 0.15,       # Suspicious pattern
        }
        
        logger.info(
            f"AdaptiveThresholdManager initialized with RANK 1 optimal base: {base_threshold} "
            f"(range: {min_threshold}-{max_threshold})"
        )
    
    def get_adaptive_threshold(
        self,
        v2_score: float,
        v1se_score: float,
        quality_score: Optional[float] = None,
        track_stability: Optional[float] = None,
        temporal_verdict: Optional[str] = None,
        temporal_confidence: Optional[float] = None
    ) -> Dict:
        """
        Compute adaptive threshold based on context.
        
        Args:
            v2_score: MiniFASNetV2 real score
            v1se_score: MiniFASNetV1SE real score
            quality_score: Quality validation score [0.0, 1.0] or None
            track_stability: Tracking stability [0.0, 1.0] or None
            temporal_verdict: Temporal analysis verdict ("REAL", "SPOOF", "UNCERTAIN") or None
            temporal_confidence: Temporal analysis confidence [0.0, 1.0] or None
            
        Returns:
            Dict with adjusted_threshold, confidence_boost, and explanation
        """
        threshold = self.base_threshold
        boost = 0.0
        boosters = []
        penalties = []
        
        # BOOST 1: Model Agreement (with spoof detection safeguard)
        score_diff = abs(v2_score - v1se_score)
        avg_score = (v2_score + v1se_score) / 2
        
        # SPOOF DETECTION SAFEGUARD: Don't boost if both models give low real scores
        # This prevents false live classifications on high-quality spoofs
        if avg_score < 0.60:  # Both models think it's likely spoof
            # Don't apply agreement boost for low scores (likely spoofs)
            if score_diff > 0.25:  # Still apply disagreement penalty
                penalty = self.penalty_factors["models_disagree"]
                boost -= penalty
                penalties.append({
                    "factor": "models_disagree",
                    "value": penalty,
                    "reason": f"Models disagree on likely spoof (diff={score_diff:.3f}, avg={avg_score:.3f})"
                })
        else:  # Models think it might be real (avg_score >= 0.60)
            if score_diff < 0.10:  # Very strong agreement
                boost += self.boost_factors["both_models_agree"]
                boosters.append({
                    "factor": "both_models_agree",
                    "value": self.boost_factors["both_models_agree"],
                    "reason": f"Models agree strongly on likely real (diff={score_diff:.3f}, avg={avg_score:.3f})"
                })
            elif score_diff < 0.15:  # Moderate agreement
                partial_boost = self.boost_factors["both_models_agree"] * 0.6
                boost += partial_boost
                boosters.append({
                    "factor": "models_agree_moderate",
                    "value": partial_boost,
                    "reason": f"Models agree moderately on likely real (diff={score_diff:.3f}, avg={avg_score:.3f})"
                })
            elif score_diff > 0.25:  # Strong disagreement
                penalty = self.penalty_factors["models_disagree"]
                boost -= penalty
                penalties.append({
                    "factor": "models_disagree",
                    "value": penalty,
                    "reason": f"Models disagree on likely real (diff={score_diff:.3f}, avg={avg_score:.3f})"
                })
        
        # BOOST 2: Quality Score (with spoof detection safeguard)
        if quality_score is not None:
            # SPOOF DETECTION SAFEGUARD: Don't boost quality for likely spoofs
            if avg_score >= 0.60:  # Only boost quality if models think it might be real
                if quality_score >= 0.85:  # High quality
                    boost += self.boost_factors["high_quality_crop"]
                    boosters.append({
                        "factor": "high_quality_crop",
                        "value": self.boost_factors["high_quality_crop"],
                        "reason": f"High quality crop on likely real (score={quality_score:.2f}, avg={avg_score:.3f})"
                    })
                elif quality_score >= 0.70:  # Good quality
                    partial_boost = self.boost_factors["high_quality_crop"] * 0.5
                    boost += partial_boost
                    boosters.append({
                        "factor": "good_quality_crop",
                        "value": partial_boost,
                        "reason": f"Good quality crop on likely real (score={quality_score:.2f}, avg={avg_score:.3f})"
                    })
            elif quality_score < 0.50:  # Poor quality (always apply penalty)
                penalty = self.penalty_factors["poor_quality"]
                boost -= penalty
                penalties.append({
                    "factor": "poor_quality",
                    "value": penalty,
                    "reason": f"Poor quality crop (score={quality_score:.2f})"
                })
        
        # BOOST 3: Track Stability
        if track_stability is not None:
            if track_stability >= 0.90:  # Very stable (long track)
                boost += self.boost_factors["stable_tracking"]
                boosters.append({
                    "factor": "stable_tracking",
                    "value": self.boost_factors["stable_tracking"],
                    "reason": f"Stable tracking (stability={track_stability:.2f})"
                })
            elif track_stability >= 0.70:  # Moderately stable
                partial_boost = self.boost_factors["stable_tracking"] * 0.5
                boost += partial_boost
                boosters.append({
                    "factor": "moderate_tracking",
                    "value": partial_boost,
                    "reason": f"Moderate tracking (stability={track_stability:.2f})"
                })
            elif track_stability < 0.30:  # New/unstable track
                penalty = self.penalty_factors["short_tracking"]
                boost -= penalty
                penalties.append({
                    "factor": "short_tracking",
                    "value": penalty,
                    "reason": f"Short tracking (stability={track_stability:.2f})"
                })
        
        # BOOST 4: Temporal Consistency (with spoof detection safeguard)
        if temporal_verdict is not None and temporal_confidence is not None:
            if temporal_verdict == "REAL" and temporal_confidence >= 0.75:
                # Only boost temporal consistency if models also think it might be real
                if avg_score >= 0.60:
                    boost += self.boost_factors["temporal_consistency"]
                    boosters.append({
                        "factor": "temporal_consistency_real",
                        "value": self.boost_factors["temporal_consistency"],
                        "reason": f"Temporal analysis confirms REAL on likely real (conf={temporal_confidence:.2f}, avg={avg_score:.3f})"
                    })
            elif temporal_verdict == "SPOOF" and temporal_confidence >= 0.80:
                # Temporal analysis detects SPOOF with high confidence
                # Apply strong penalty (make threshold much higher)
                penalty = self.penalty_factors["temporal_anomaly"]
                boost -= penalty
                penalties.append({
                    "factor": "temporal_spoof_detected",
                    "value": penalty,
                    "reason": f"Temporal analysis detects SPOOF (conf={temporal_confidence:.2f})"
                })
        
        # Apply boost to threshold (boost reduces threshold = easier to accept)
        adjusted_threshold = threshold - boost
        
        # Clamp to valid range
        adjusted_threshold = max(self.min_threshold, min(self.max_threshold, adjusted_threshold))
        
        # Compute decision confidence
        # Higher boost = higher confidence in whatever decision is made
        decision_confidence = min(1.0, abs(boost) / 0.5)  # Normalize to [0, 1]
        
        return {
            "base_threshold": float(self.base_threshold),
            "adjusted_threshold": float(adjusted_threshold),
            "total_boost": float(boost),
            "decision_confidence": float(decision_confidence),
            "boosters": boosters,
            "penalties": penalties,
            "explanation": self._generate_explanation(adjusted_threshold, boost, boosters, penalties)
        }
    
    def _generate_explanation(
        self,
        adjusted_threshold: float,
        boost: float,
        boosters: list,
        penalties: list
    ) -> str:
        """Generate human-readable explanation of threshold adjustment"""
        if abs(boost) < 0.01:
            return f"Using base threshold {self.base_threshold:.2f} (no adjustments)"
        
        parts = []
        
        if boost > 0:
            parts.append(f"Threshold lowered to {adjusted_threshold:.2f} (from {self.base_threshold:.2f})")
            if boosters:
                reasons = [b["reason"] for b in boosters[:2]]  # Top 2 reasons
                parts.append(f"Reasons: {'; '.join(reasons)}")
        else:
            parts.append(f"Threshold raised to {adjusted_threshold:.2f} (from {self.base_threshold:.2f})")
            if penalties:
                reasons = [p["reason"] for p in penalties[:2]]  # Top 2 reasons
                parts.append(f"Reasons: {'; '.join(reasons)}")
        
        return ". ".join(parts)
    
    def compute_decision_confidence(
        self,
        score: float,
        threshold: float,
        adjusted_threshold: float
    ) -> float:
        """
        Compute confidence in the decision based on distance from threshold.
        
        Args:
            score: Actual score (real_score from ensemble)
            threshold: Base threshold
            adjusted_threshold: Adjusted threshold used for decision
            
        Returns:
            Confidence in decision [0.0, 1.0]
        """
        # Distance from threshold = confidence
        distance = abs(score - adjusted_threshold)
        
        # Normalize to [0, 1] where 0.3 distance = full confidence
        confidence = min(1.0, distance / 0.3)
        
        # Bonus confidence if both base and adjusted thresholds agree
        base_decision = score > threshold
        adjusted_decision = score > adjusted_threshold
        
        if base_decision == adjusted_decision:
            # Both thresholds give same decision = higher confidence
            confidence = min(1.0, confidence * 1.2)
        
        return float(confidence)
