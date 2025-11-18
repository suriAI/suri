import { useCallback, useEffect } from "react";
import type { BackendService } from "../../../services/BackendService";
import type { DetectionResult } from "../types";
import { useDetectionStore } from "../stores/detectionStore";

interface UseFaceDetectionOptions {
  backendServiceRef: React.MutableRefObject<BackendService | null>;
  isScanningRef: React.MutableRefObject<boolean>;
  isStreamingRef: React.MutableRefObject<boolean>;
  captureFrame: () => Promise<ArrayBuffer | null>;
  lastDetectionFrameRef: React.MutableRefObject<ArrayBuffer | null>;
  frameCounterRef: React.MutableRefObject<number>;
  skipFramesRef: React.MutableRefObject<number>;
  lastFrameTimestampRef: React.MutableRefObject<number>;
  lastDetectionRef: React.MutableRefObject<DetectionResult | null>;
  processCurrentFrameRef: React.MutableRefObject<() => Promise<void>>;
  fpsTrackingRef: React.MutableRefObject<{
    timestamps: number[];
    maxSamples: number;
    lastUpdateTime: number;
  }>;
}

export function useFaceDetection(options: UseFaceDetectionOptions) {
  const { backendServiceRef, isScanningRef, isStreamingRef, captureFrame, lastDetectionFrameRef, frameCounterRef, skipFramesRef, processCurrentFrameRef } = options;

  // Zustand store
  const { detectionFps, currentDetections, setDetectionFps, setCurrentDetections } = useDetectionStore();

  const processCurrentFrame = useCallback(async () => {
    if (
      !backendServiceRef.current?.isWebSocketReady() ||
      !isScanningRef.current ||
      !isStreamingRef.current
    ) {
      return;
    }

    frameCounterRef.current += 1;

    if (frameCounterRef.current % (skipFramesRef.current + 1) !== 0) {
      requestAnimationFrame(() => processCurrentFrameRef.current());
      return;
    }

    try {
      const frameData = await captureFrame();
      if (!frameData) {
        requestAnimationFrame(() => processCurrentFrameRef.current());
        return;
      }

      lastDetectionFrameRef.current = frameData;

      backendServiceRef.current
        .sendDetectionRequest(frameData)
        .catch((error) => {
          console.error("❌ WebSocket detection request failed:", error);
          requestAnimationFrame(() => processCurrentFrameRef.current());
        });
    } catch (error) {
      console.error("❌ Frame capture failed:", error);
      requestAnimationFrame(() => processCurrentFrameRef.current());
    }
  }, [captureFrame, backendServiceRef, isScanningRef, isStreamingRef, frameCounterRef, lastDetectionFrameRef, processCurrentFrameRef, skipFramesRef]);

  useEffect(() => {
    processCurrentFrameRef.current = processCurrentFrame;
  }, [processCurrentFrame, processCurrentFrameRef]);

  return {
    detectionFps,
    setDetectionFps,
    currentDetections,
    setCurrentDetections,
  };
}

