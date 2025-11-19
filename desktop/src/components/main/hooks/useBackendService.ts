import { useRef, useCallback, useEffect } from "react";
import { startTransition } from "react";
import { BackendService } from "../../../services";
import type {
  WebSocketDetectionResponse,
  WebSocketConnectionMessage,
  WebSocketErrorMessage,
  DetectionResult,
  WebSocketFaceData,
} from "../types";
import { cleanupStream, cleanupVideo, cleanupAnimationFrame } from "../utils";
import {
  useCameraStore,
  useDetectionStore,
  useAttendanceStore,
  useUIStore,
} from "../stores";

interface UseBackendServiceOptions {
  backendServiceRef: React.RefObject<BackendService | null>;
  isStreamingRef: React.RefObject<boolean>;
  isScanningRef: React.RefObject<boolean>;
  isStartingRef: React.RefObject<boolean>;
  performFaceRecognition: (
    detectionResult: DetectionResult,
    frameData: ArrayBuffer | null,
  ) => Promise<void>;
  lastDetectionFrameRef: React.RefObject<ArrayBuffer | null>;
  lastFrameTimestampRef: React.RefObject<number>;
  lastDetectionRef: React.RefObject<DetectionResult | null>;
  fpsTrackingRef: React.RefObject<{
    timestamps: number[];
    maxSamples: number;
    lastUpdateTime: number;
  }>;
  skipFramesRef: React.RefObject<number>;
  processCurrentFrameRef: React.RefObject<() => Promise<void>>;
  stopCamera: React.RefObject<((forceCleanup: boolean) => void) | null>;
  animationFrameRef: React.RefObject<number | undefined>;
  streamRef: React.RefObject<MediaStream | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  backendServiceReadyRef: React.RefObject<boolean>;
}

export function useBackendService(options: UseBackendServiceOptions) {
  const {
    backendServiceRef,
    isStreamingRef,
    isScanningRef,
    isStartingRef,
    performFaceRecognition,
    lastDetectionFrameRef,
    lastFrameTimestampRef,
    lastDetectionRef,
    fpsTrackingRef,
    skipFramesRef,
    processCurrentFrameRef,
    stopCamera,
    animationFrameRef,
    streamRef,
    videoRef,
    backendServiceReadyRef,
  } = options;

  // Zustand stores
  const {
    setIsStreaming,
    setIsVideoLoading,
    setCameraActive,
    websocketStatus,
    setWebsocketStatus,
  } = useCameraStore();
  const { setCurrentDetections, setDetectionFps } = useDetectionStore();
  const { enableSpoofDetection } = useAttendanceStore();
  const { setError } = useUIStore();

  const recognitionEnabled = true;
  const initializationRef = useRef<{
    initialized: boolean;
    isInitializing: boolean;
    cleanupTimeout?: NodeJS.Timeout;
  }>({ initialized: false, isInitializing: false });

  useEffect(() => {
    if (backendServiceRef.current) {
      backendServiceRef.current.setLivenessDetection(enableSpoofDetection);
    }
  }, [enableSpoofDetection, backendServiceRef]);

  const waitForBackendReady = useCallback(
    async (
      maxWaitTime: number = 60000,
      pollInterval: number = 500,
    ): Promise<{ ready: boolean; modelsLoaded: boolean; error?: string }> => {
      const startTime = Date.now();
      let lastError: string | undefined;

      while (Date.now() - startTime < maxWaitTime) {
        try {
          if (!window.electronAPI?.backend) {
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
            continue;
          }

          const readinessCheck =
            await window.electronAPI.backend.checkReadiness();

          if (readinessCheck?.ready && readinessCheck?.modelsLoaded) {
            return {
              ready: true,
              modelsLoaded: true,
            };
          }

          if (readinessCheck?.error) {
            lastError = readinessCheck.error;
          } else {
            lastError = "Models still loading";
          }

          if (
            readinessCheck?.error?.includes("Backend service not started") ||
            readinessCheck?.error?.includes("Backend health check failed")
          ) {
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
            continue;
          }

          const waitTime = Math.min(pollInterval * 2, 2000);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        } catch (error) {
          lastError = error instanceof Error ? error.message : "Unknown error";
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
        }
      }

      return {
        ready: false,
        modelsLoaded: false,
        error: lastError ?? "Timeout waiting for backend to be ready",
      };
    },
    [],
  );

  const registerWebSocketHandlers = useCallback(() => {
    if (!backendServiceRef.current) return;

    backendServiceRef.current.offMessage("detection_response");
    backendServiceRef.current.offMessage("connection");
    backendServiceRef.current.offMessage("error");

    backendServiceRef.current.onMessage(
      "detection_response",
      (data: WebSocketDetectionResponse) => {
        if (!isStreamingRef.current || !isScanningRef.current) {
          return;
        }

        if (data.frame_timestamp === undefined) {
          return;
        }

        const responseFrameTimestamp = data.frame_timestamp;
        const lastFrameTimestamp = lastFrameTimestampRef.current ?? 0;

        if (responseFrameTimestamp < lastFrameTimestamp) {
          return;
        }

        (lastFrameTimestampRef as React.RefObject<number>).current =
          responseFrameTimestamp;

        const now = Date.now();
        const fpsTracking = fpsTrackingRef.current;
        if (!fpsTracking) return;
        fpsTracking.timestamps.push(now);

        if (fpsTracking.timestamps.length > fpsTracking.maxSamples) {
          fpsTracking.timestamps.shift();
        }

        if (
          now - fpsTracking.lastUpdateTime >= 100 &&
          fpsTracking.timestamps.length >= 2
        ) {
          const timeSpan =
            fpsTracking.timestamps[fpsTracking.timestamps.length - 1] -
            fpsTracking.timestamps[0];
          const frameCount = fpsTracking.timestamps.length - 1;

          if (timeSpan > 0) {
            const accurateFps = (frameCount * 1000) / timeSpan;
            setDetectionFps(Math.round(accurateFps * 10) / 10);
          }

          fpsTracking.lastUpdateTime = now;
        }

        if (data.faces && Array.isArray(data.faces)) {
          if (data.suggested_skip !== undefined) {
            (skipFramesRef as React.RefObject<number>).current =
              data.suggested_skip;
          }

          if (!data.model_used) {
            return;
          }

          const detectionResult: DetectionResult = {
            faces: data.faces
              .map((face: WebSocketFaceData) => {
                if (
                  !face.bbox ||
                  !Array.isArray(face.bbox) ||
                  face.bbox.length !== 4
                ) {
                  return null;
                }

                if (face.confidence === undefined) {
                  return null;
                }

                const bbox = face.bbox;

                return {
                  bbox: {
                    x: bbox[0],
                    y: bbox[1],
                    width: bbox[2],
                    height: bbox[3],
                  },
                  confidence: face.confidence,
                  track_id: face.track_id,
                  landmarks_5: face.landmarks_5,
                  liveness: (() => {
                    if (!face.liveness) {
                      return undefined;
                    }
                    if (face.liveness.status === undefined) {
                      return undefined;
                    }
                    if (face.liveness.is_real === undefined) {
                      return undefined;
                    }
                    return {
                      is_real: face.liveness.is_real,
                      confidence: face.liveness.confidence,
                      live_score: face.liveness.live_score,
                      spoof_score: face.liveness.spoof_score,
                      status: face.liveness.status,
                      attack_type: face.liveness.attack_type,
                      message: face.liveness.message,
                    };
                  })(),
                };
              })
              .filter((face) => face !== null) as DetectionResult["faces"],
            model_used: data.model_used,
          };

          setCurrentDetections(detectionResult);
          (
            lastDetectionRef as React.RefObject<DetectionResult | null>
          ).current = detectionResult;

          if (
            recognitionEnabled &&
            backendServiceReadyRef.current &&
            detectionResult.faces.length > 0
          ) {
            startTransition(() => {
              const frameDataForRecognition = lastDetectionFrameRef.current;
              performFaceRecognition(
                detectionResult,
                frameDataForRecognition,
              ).catch((error) => {
                console.error("Face recognition failed:", error);
              });
            });
          }
        }

        if (isScanningRef.current && isStreamingRef.current) {
          requestAnimationFrame(() => processCurrentFrameRef.current?.());
        }
      },
    );

    backendServiceRef.current.onMessage(
      "connection",
      (data: WebSocketConnectionMessage) => {
        if (data.status === "connected") {
          (backendServiceReadyRef as React.RefObject<boolean>).current = true;
          setWebsocketStatus("connected");
        } else if (data.status === "disconnected") {
          setWebsocketStatus("disconnected");
        }
      },
    );

    backendServiceRef.current.onMessage(
      "error",
      (data: WebSocketErrorMessage) => {
        if (!isStreamingRef.current || !isScanningRef.current) {
          return;
        }

        console.error("❌ WebSocket error message:", data);
        if (data.message) {
          setError(`Detection error: ${data.message}`);
        } else {
          setError("Detection error occurred");
        }

        requestAnimationFrame(() => processCurrentFrameRef.current?.());
      },
    );
  }, [
    recognitionEnabled,
    performFaceRecognition,
    backendServiceRef,
    isStreamingRef,
    isScanningRef,
    lastFrameTimestampRef,
    fpsTrackingRef,
    skipFramesRef,
    lastDetectionRef,
    backendServiceReadyRef,
    lastDetectionFrameRef,
    processCurrentFrameRef,
    setCurrentDetections,
    setDetectionFps,
    setWebsocketStatus,
    setError,
  ]);

  const initializeWebSocket = useCallback(async () => {
    try {
      if (!backendServiceRef.current) {
        backendServiceRef.current = new BackendService();
      }

      const currentStatus = backendServiceRef.current.getWebSocketStatus();
      if (currentStatus === "connected") {
        registerWebSocketHandlers();
        return;
      }

      if (currentStatus === "connecting") {
        let attempts = 0;
        while (attempts < 50) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const status = backendServiceRef.current.getWebSocketStatus();
          if (status === "connected") {
            registerWebSocketHandlers();
            return;
          }
          if (status === "disconnected") {
            break;
          }
          attempts++;
        }
      }

      const readinessResult = await waitForBackendReady(60000, 500);

      if (!readinessResult.ready || !readinessResult.modelsLoaded) {
        const errorMessage =
          readinessResult.error ?? "Backend not ready: Models still loading";
        throw new Error(errorMessage);
      }

      await backendServiceRef.current.connectWebSocket();
      registerWebSocketHandlers();
    } catch (error) {
      console.error("❌ WebSocket initialization failed:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      if (!isStartingRef.current) {
        if (errorMessage.includes("Models still loading")) {
          setError(
            "AI models are still loading. Please wait a moment and try again.",
          );
        } else if (errorMessage.includes("Backend service not started")) {
          setError(
            "Backend service is not running. Please restart the application.",
          );
        } else if (errorMessage.includes("Timeout")) {
          setError(
            "Backend took too long to load models. Please check if the backend service is running.",
          );
        } else {
          setError(`Failed to connect to detection service: ${errorMessage}`);
        }
      }
      throw error;
    }
  }, [
    waitForBackendReady,
    registerWebSocketHandlers,
    backendServiceRef,
    isStartingRef,
    setError,
  ]);

  useEffect(() => {
    (isStreamingRef as React.RefObject<boolean>).current = false;
    (isScanningRef as React.RefObject<boolean>).current = false;
    (backendServiceReadyRef as React.RefObject<boolean>).current = false;
    setError(null);
    setIsStreaming(false);
    setIsVideoLoading(false);
    setCameraActive(false);
    setWebsocketStatus("disconnected");

    cleanupStream(streamRef);
    cleanupVideo(videoRef, true);
    cleanupAnimationFrame(animationFrameRef);

    if (initializationRef.current.cleanupTimeout) {
      clearTimeout(initializationRef.current.cleanupTimeout);
      initializationRef.current.cleanupTimeout = undefined;
    }

    if (backendServiceRef.current?.isWebSocketReady()) {
      registerWebSocketHandlers();
      initializationRef.current.initialized = true;
      initializationRef.current.isInitializing = false;
      return;
    }

    if (initializationRef.current.isInitializing) {
      return;
    }

    if (
      initializationRef.current.initialized &&
      !backendServiceRef.current?.isWebSocketReady()
    ) {
      initializationRef.current.initialized = false;
    }

    initializationRef.current.isInitializing = true;

    const initWebSocket = async () => {
      try {
        await initializeWebSocket();
        initializationRef.current.initialized = true;
      } catch {
        setWebsocketStatus("disconnected");
        initializationRef.current.initialized = false;
      } finally {
        initializationRef.current.isInitializing = false;
      }
    };

    initWebSocket();

    const cleanupTimeout = initializationRef.current.cleanupTimeout;
    const wasInitialized = initializationRef.current.initialized;
    const wasInitializing = initializationRef.current.isInitializing;
    const stopCameraFn = stopCamera.current;
    // Capture ref values at effect time to avoid linter warnings
    const currentAnimationFrame = animationFrameRef.current;
    const isCurrentlyStreaming = isStreamingRef.current;

    return () => {
      if (cleanupTimeout) {
        clearTimeout(cleanupTimeout);
      }

      if (wasInitialized || wasInitializing) {
        // Use captured values to avoid linter warnings about refs changing
        if (isCurrentlyStreaming) {
          if (stopCameraFn) {
            stopCameraFn(false);
          }
        } else if (currentAnimationFrame) {
          cancelAnimationFrame(currentAnimationFrame);
          (animationFrameRef as React.RefObject<number | undefined>).current =
            undefined;
        }

        const initRef = initializationRef;
        setTimeout(() => {
          initRef.current.initialized = false;
          initRef.current.isInitializing = false;
        }, 50);
      }
    };
  }, [
    initializeWebSocket,
    registerWebSocketHandlers,
    stopCamera,
    isStreamingRef,
    isScanningRef,
    animationFrameRef,
    backendServiceReadyRef,
    backendServiceRef,
    setIsStreaming,
    setIsVideoLoading,
    setCameraActive,
    setError,
    setWebsocketStatus,
    streamRef,
    videoRef,
  ]);

  useEffect(() => {
    if (!backendServiceRef.current) return;

    const pollWebSocketStatus = () => {
      if (backendServiceRef.current) {
        const actualStatus = backendServiceRef.current.getWebSocketStatus();
        if (actualStatus !== websocketStatus) {
          setWebsocketStatus(actualStatus);
        }
      }
    };

    const statusInterval = setInterval(pollWebSocketStatus, 1000);

    return () => {
      clearInterval(statusInterval);
    };
  }, [websocketStatus, backendServiceRef, setWebsocketStatus]);

  useEffect(() => {
    if (
      websocketStatus === "connected" &&
      isScanningRef.current &&
      isStreamingRef.current
    ) {
      if (backendServiceRef.current?.isWebSocketReady()) {
        processCurrentFrameRef.current?.();
      }
    }
  }, [
    websocketStatus,
    isScanningRef,
    isStreamingRef,
    backendServiceRef,
    processCurrentFrameRef,
  ]);

  return {
    backendServiceReadyRef,
    initializeWebSocket,
    registerWebSocketHandlers,
    waitForBackendReady,
  };
}
