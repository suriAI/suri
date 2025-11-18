import { useCallback, useEffect } from "react";
import { useCameraStore } from "../stores/cameraStore";

interface UseStreamStateOptions {
  isProcessingRef: React.MutableRefObject<boolean>;
  animationFrameRef: React.MutableRefObject<number | undefined>;
  isScanningRef: React.MutableRefObject<boolean>;
  isStreamingRef: React.MutableRefObject<boolean>;
  isStartingRef: React.MutableRefObject<boolean>;
  isStoppingRef: React.MutableRefObject<boolean>;
  lastStartTimeRef: React.MutableRefObject<number>;
  lastStopTimeRef: React.MutableRefObject<number>;
}

export function useStreamState(options: UseStreamStateOptions) {
  const { isProcessingRef, animationFrameRef, isScanningRef, isStreamingRef, isStartingRef, isStoppingRef, lastStartTimeRef, lastStopTimeRef } = options;
  const { setIsStreaming } = useCameraStore();

  const emergencyRecovery = useCallback(() => {
    isStartingRef.current = false;
    isStoppingRef.current = false;
    isProcessingRef.current = false;
    lastStartTimeRef.current = 0;
    lastStopTimeRef.current = 0;
    if (isStreamingRef.current) {
      isStreamingRef.current = false;
      isScanningRef.current = false;
      setIsStreaming(false);
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }
  }, [setIsStreaming, isProcessingRef, animationFrameRef, isScanningRef, isStreamingRef, isStartingRef, isStoppingRef, lastStartTimeRef, lastStopTimeRef]);

  useEffect(() => {
    let startTimeout: NodeJS.Timeout | undefined;
    let stopTimeout: NodeJS.Timeout | undefined;

    if (isStartingRef.current) {
      startTimeout = setTimeout(() => {
        if (isStartingRef.current) {
          emergencyRecovery();
        }
      }, 10000);
    }

    if (isStoppingRef.current) {
      stopTimeout = setTimeout(() => {
        if (isStoppingRef.current) {
          emergencyRecovery();
        }
      }, 5000);
    }

    return () => {
      if (startTimeout) clearTimeout(startTimeout);
      if (stopTimeout) clearTimeout(stopTimeout);
    };
  }, [emergencyRecovery, isStartingRef, isStoppingRef]);
}

