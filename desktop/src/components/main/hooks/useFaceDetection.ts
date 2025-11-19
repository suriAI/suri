import { useCallback, useEffect } from "react";
import type { BackendService } from "../../../services";
import type { DetectionResult } from "../types";
import { useDetectionStore } from "../stores";

interface UseFaceDetectionOptions {
  backendServiceRef: React.RefObject<BackendService | null>;
  isScanningRef: React.RefObject<boolean>;
  isStreamingRef: React.RefObject<boolean>;
  captureFrame: () => Promise<ArrayBuffer | null>;
  lastDetectionFrameRef: React.RefObject<ArrayBuffer | null>;
  frameCounterRef: React.RefObject<number>;
  skipFramesRef: React.RefObject<number>;
  lastFrameTimestampRef: React.RefObject<number>;
  lastDetectionRef: React.RefObject<DetectionResult | null>;
  processCurrentFrameRef: React.RefObject<() => Promise<void>>;
  fpsTrackingRef: React.RefObject<{
    timestamps: number[];
    maxSamples: number;
    lastUpdateTime: number;
  }>;
}

export function useFaceDetection(options: UseFaceDetectionOptions) {
  const {
    backendServiceRef,
    isScanningRef,
    isStreamingRef,
    captureFrame,
    lastDetectionFrameRef,
    frameCounterRef,
    skipFramesRef,
    processCurrentFrameRef,
  } = options;

  // Zustand store
  const {
    detectionFps,
    currentDetections,
    setDetectionFps,
    setCurrentDetections,
  } = useDetectionStore();

  const processCurrentFrame = useCallback(async () => {
    if (
      !backendServiceRef.current?.isWebSocketReady() ||
      !isScanningRef.current ||
      !isStreamingRef.current
    ) {
      return;
    }

    (frameCounterRef as React.RefObject<number>).current += 1;

    if (
      (frameCounterRef.current ?? 0) % ((skipFramesRef.current ?? 0) + 1) !==
      0
    ) {
      requestAnimationFrame(() => processCurrentFrameRef.current?.());
      return;
    }

    try {
      const frameData = await captureFrame();
      if (!frameData) {
        requestAnimationFrame(() => processCurrentFrameRef.current?.());
        return;
      }

      (lastDetectionFrameRef as React.RefObject<ArrayBuffer | null>).current =
        frameData;

      backendServiceRef.current
        .sendDetectionRequest(frameData)
        .catch((error) => {
          console.error("❌ WebSocket detection request failed:", error);
          requestAnimationFrame(() => processCurrentFrameRef.current?.());
        });
    } catch (error) {
      console.error("❌ Frame capture failed:", error);
      requestAnimationFrame(() => processCurrentFrameRef.current?.());
    }
  }, [
    captureFrame,
    backendServiceRef,
    isScanningRef,
    isStreamingRef,
    frameCounterRef,
    lastDetectionFrameRef,
    processCurrentFrameRef,
    skipFramesRef,
  ]);

  useEffect(() => {
    (processCurrentFrameRef as React.RefObject<() => Promise<void>>).current =
      processCurrentFrame;
  }, [processCurrentFrame, processCurrentFrameRef]);

  return {
    detectionFps,
    setDetectionFps,
    currentDetections,
    setCurrentDetections,
  };
}
