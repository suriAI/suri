import type { DetectionResult } from "../types";

export function resetLastDetectionRef(
  lastDetectionRef: React.MutableRefObject<DetectionResult | null>
): void {
  lastDetectionRef.current = null;
}

export function resetFrameCounters(
  frameCounterRef: React.MutableRefObject<number>,
  skipFramesRef: React.MutableRefObject<number>,
  lastFrameTimestampRef: React.MutableRefObject<number>
): void {
  frameCounterRef.current = 0;
  skipFramesRef.current = 0;
  lastFrameTimestampRef.current = 0;
}

