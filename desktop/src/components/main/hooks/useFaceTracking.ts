import { useRef, useCallback, useEffect } from "react";
import { useDetectionStore } from "../stores";

export function useFaceTracking() {
  const { setTrackedFaces } = useDetectionStore();

  const calculateAngleConsistencyRef = useRef<
    (
      history: Array<{
        timestamp: number;
        bbox: { x: number; y: number; width: number; height: number };
        confidence: number;
      }>,
    ) => number
  >(() => 1.0);

  const calculateAngleConsistency = useCallback(
    (
      history: Array<{
        timestamp: number;
        bbox: { x: number; y: number; width: number; height: number };
        confidence: number;
      }>,
    ) => {
      if (history.length < 2) return 1.0;

      let consistencyScore = 0;
      for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1];
        const curr = history[i];
        const dx = curr.bbox.x - prev.bbox.x;
        const dy = curr.bbox.y - prev.bbox.y;
        const movement = Math.sqrt(dx * dx + dy * dy);
        const smoothness = Math.max(0, 1 - movement / 100);
        consistencyScore += smoothness;
      }

      return consistencyScore / (history.length - 1);
    },
    [],
  );

  useEffect(() => {
    calculateAngleConsistencyRef.current = calculateAngleConsistency;
  }, [calculateAngleConsistency]);

  const handleOcclusion = useCallback(() => {
    setTrackedFaces((prev) => {
      const newTracked = new Map(prev);
      const currentTime = Date.now();
      const occlusionThreshold = 2000;

      for (const [id, track] of newTracked) {
        if (currentTime - track.lastSeen > occlusionThreshold) {
          track.occlusionCount++;
          if (track.occlusionCount > 5) {
            newTracked.delete(id);
          }
        }
      }

      return newTracked;
    });
  }, [setTrackedFaces]);

  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      handleOcclusion();
    }, 1000);

    return () => clearInterval(cleanupInterval);
  }, [handleOcclusion]);

  return {
    calculateAngleConsistencyRef,
    calculateAngleConsistency,
  };
}
