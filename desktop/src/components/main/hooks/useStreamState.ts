import { useCallback, useEffect } from "react";
import { useCameraStore } from "../stores";

interface UseStreamStateOptions {
  isProcessingRef: React.RefObject<boolean>;
  animationFrameRef: React.RefObject<number | undefined>;
  isScanningRef: React.RefObject<boolean>;
  isStreamingRef: React.RefObject<boolean>;
  isStartingRef: React.RefObject<boolean>;
  isStoppingRef: React.RefObject<boolean>;
  lastStartTimeRef: React.RefObject<number>;
  lastStopTimeRef: React.RefObject<number>;
}

export function useStreamState(options: UseStreamStateOptions) {
  const {
    isProcessingRef,
    animationFrameRef,
    isScanningRef,
    isStreamingRef,
    isStartingRef,
    isStoppingRef,
    lastStartTimeRef,
    lastStopTimeRef,
  } = options;
  const { setIsStreaming } = useCameraStore();

  const emergencyRecovery = useCallback(() => {
    (isStartingRef as React.RefObject<boolean>).current = false;
    (isStoppingRef as React.RefObject<boolean>).current = false;
    (isProcessingRef as React.RefObject<boolean>).current = false;
    (lastStartTimeRef as React.RefObject<number>).current = 0;
    (lastStopTimeRef as React.RefObject<number>).current = 0;
    if (isStreamingRef.current) {
      (isStreamingRef as React.RefObject<boolean>).current = false;
      (isScanningRef as React.RefObject<boolean>).current = false;
      setIsStreaming(false);
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      (animationFrameRef as React.RefObject<number | undefined>).current =
        undefined;
    }
  }, [
    setIsStreaming,
    isProcessingRef,
    animationFrameRef,
    isScanningRef,
    isStreamingRef,
    isStartingRef,
    isStoppingRef,
    lastStartTimeRef,
    lastStopTimeRef,
  ]);

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
