import { useCallback } from "react";
import {
  cleanupStream,
  cleanupVideo,
  cleanupAnimationFrame,
  resetFrameCounters,
  resetLastDetectionRef,
} from "../utils";
import { useDetectionStore } from "../stores";
import type { BackendService } from "../../../services/BackendService";
import type { DetectionResult } from "../types";

interface CameraControlProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  streamRef: React.MutableRefObject<MediaStream | null>;
  animationFrameRef: React.MutableRefObject<number | undefined>;
  backendServiceRef: React.MutableRefObject<BackendService | null>;
  isStreamingRef: React.MutableRefObject<boolean>;
  isScanningRef: React.MutableRefObject<boolean>;
  isStartingRef: React.MutableRefObject<boolean>;
  isStoppingRef: React.MutableRefObject<boolean>;
  lastStartTimeRef: React.MutableRefObject<number>;
  lastStopTimeRef: React.MutableRefObject<number>;
  frameCounterRef: React.MutableRefObject<number>;
  skipFramesRef: React.MutableRefObject<number>;
  lastFrameTimestampRef: React.MutableRefObject<number>;
  lastDetectionRef: React.MutableRefObject<DetectionResult | null>;
  lastDetectionFrameRef: React.MutableRefObject<ArrayBuffer | null>;
  fpsTrackingRef: React.MutableRefObject<{
    timestamps: number[];
    maxSamples: number;
    lastUpdateTime: number;
  }>;
  backendServiceReadyRef: React.MutableRefObject<boolean>;
  processCurrentFrameRef: React.MutableRefObject<() => Promise<void>>;
  resetOverlayRefs: () => void;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;

  // Store actions/state
  setIsStreaming: (val: boolean) => void;
  setIsVideoLoading: (val: boolean) => void;
  setCameraActive: (val: boolean) => void;
  setSelectedCamera: (id: string) => void;
  setDetectionFps: (fps: number) => void;
  setError: (msg: string | null) => void;
  selectedCamera: string | null;
  cameraDevices: MediaDeviceInfo[];

  // Methods from other hooks
  initializeWebSocket: () => Promise<void>;
  getCameraDevices: () => Promise<MediaDeviceInfo[]>;
}

export function useCameraControl({
  videoRef,
  streamRef,
  animationFrameRef,
  backendServiceRef,
  isStreamingRef,
  isScanningRef,
  isStartingRef,
  isStoppingRef,
  lastStartTimeRef,
  lastStopTimeRef,
  frameCounterRef,
  skipFramesRef,
  lastFrameTimestampRef,
  lastDetectionRef,
  lastDetectionFrameRef,
  fpsTrackingRef,
  backendServiceReadyRef,
  processCurrentFrameRef,
  resetOverlayRefs,
  overlayCanvasRef,
  setIsStreaming,
  setIsVideoLoading,
  setCameraActive,
  setSelectedCamera,
  setDetectionFps,
  setError,
  selectedCamera,
  cameraDevices,
  initializeWebSocket,
  getCameraDevices,
}: CameraControlProps) {
  const startCamera = useCallback(async () => {
    try {
      const now = Date.now();
      const timeSinceLastStart = now - lastStartTimeRef.current;
      const timeSinceLastStop = now - lastStopTimeRef.current;

      if (isStartingRef.current || isStreamingRef.current) {
        return;
      }

      if (timeSinceLastStop < 100 || timeSinceLastStart < 200) {
        return;
      }

      isStartingRef.current = true;
      lastStartTimeRef.current = now;
      isStreamingRef.current = true;
      setIsStreaming(true);
      setIsVideoLoading(true);
      setError(null);

      const currentStatus =
        backendServiceRef.current?.getWebSocketStatus() || "disconnected";
      if (currentStatus !== "connected") {
        try {
          setError("Connecting to detection service...");
          await initializeWebSocket();
          setError(null);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          setError(`Failed to connect to detection service: ${errorMessage}`);
          isStreamingRef.current = false;
          setIsStreaming(false);
          setIsVideoLoading(false);
          isStartingRef.current = false;
          return;
        }
      }

      await getCameraDevices();

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      // Validate and get the correct camera device ID
      let deviceIdToUse: string | undefined = undefined;
      if (selectedCamera && cameraDevices.length > 0) {
        const deviceExists = cameraDevices.some(
          (device) => device.deviceId && device.deviceId === selectedCamera,
        );
        if (deviceExists) {
          deviceIdToUse = selectedCamera;
        } else {
          console.warn(
            `Selected camera (${selectedCamera}) not found. Falling back to first available camera.`,
          );
          const validDevice = cameraDevices.find(
            (device) => device.deviceId && device.deviceId.trim() !== "",
          );
          if (validDevice) {
            deviceIdToUse = validDevice.deviceId;
            setSelectedCamera(validDevice.deviceId);
          }
        }
      } else if (cameraDevices.length > 0 && !selectedCamera) {
        const validDevice = cameraDevices.find(
          (device) => device.deviceId && device.deviceId.trim() !== "",
        );
        if (validDevice) {
          deviceIdToUse = validDevice.deviceId;
          setSelectedCamera(validDevice.deviceId);
        }
      }

      if (cameraDevices.length === 0) {
        throw new Error(
          "No camera detected. Please make sure your camera is connected and try again.",
        );
      }

      const constraints: MediaStreamConstraints = {
        video: deviceIdToUse
          ? { deviceId: { ideal: deviceIdToUse } }
          : undefined,
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;

        const waitForVideoReady = () => {
          return new Promise<void>((resolve) => {
            const video = videoRef.current;
            if (!video) {
              resolve();
              return;
            }

            const checkVideoReady = () => {
              if (video.videoWidth > 0 && video.videoHeight > 0) {
                resolve();
              } else {
                setTimeout(checkVideoReady, 16);
              }
            };

            video
              .play()
              .then(() => {
                checkVideoReady();
              })
              .catch(() => {
                checkVideoReady();
              });
          });
        };

        await waitForVideoReady();
        setIsVideoLoading(false);
        setCameraActive(true);

        resetFrameCounters(
          frameCounterRef,
          skipFramesRef,
          lastFrameTimestampRef,
        );

        isScanningRef.current = true;
        backendServiceReadyRef.current = true;

        if (backendServiceRef.current?.isWebSocketReady()) {
          processCurrentFrameRef.current();
        }
      }
    } catch (err) {
      console.error("Error starting camera:", err);

      let errorMessage =
        "Unable to access your camera. Please make sure your camera is connected and try again.";
      if (err instanceof Error) {
        const errorName = err.name;
        if (
          errorName === "NotAllowedError" ||
          errorName === "PermissionDeniedError"
        ) {
          const userAgent = navigator.userAgent.toLowerCase();
          let instructions = "";
          if (userAgent.includes("win")) {
            instructions =
              "Go to Settings \u2192 Privacy \u2192 Camera \u2192 Turn ON 'Allow apps to access your camera'";
          } else if (userAgent.includes("mac")) {
            instructions =
              "Go to System Settings \u2192 Privacy & Security \u2192 Camera \u2192 Turn ON for this app";
          } else {
            instructions =
              "Go to your system settings and allow camera access for this application";
          }
          errorMessage = `Camera access was blocked. ${instructions}. Then close and reopen this app.`;
        } else if (
          errorName === "NotFoundError" ||
          errorName === "DevicesNotFoundError"
        ) {
          errorMessage =
            "No camera detected. Please make sure your camera is connected and try again.";
        } else if (
          errorName === "NotReadableError" ||
          errorName === "TrackStartError"
        ) {
          errorMessage =
            "Your camera is being used by another app. Please close other apps (like Zoom, Teams, or your web browser) that might be using the camera, then try again.";
        } else if (
          errorName === "OverconstrainedError" ||
          errorName === "ConstraintNotSatisfiedError"
        ) {
          errorMessage = "Switching to a different camera...";
          try {
            const fallbackConstraints: MediaStreamConstraints = {
              video: true,
              audio: false,
            };
            const fallbackStream =
              await navigator.mediaDevices.getUserMedia(fallbackConstraints);
            streamRef.current = fallbackStream;
            if (videoRef.current) {
              videoRef.current.srcObject = fallbackStream;
              await videoRef.current.play();
              setIsVideoLoading(false);
              setCameraActive(true);
              isStreamingRef.current = true;
              setIsStreaming(true);
              isScanningRef.current = true;
              backendServiceReadyRef.current = true;
              setError(null);
              isStartingRef.current = false;
              return;
            }
          } catch (fallbackErr) {
            console.error("Fallback camera start also failed:", fallbackErr);
            errorMessage =
              "Unable to start camera. Please check if your camera is working and not being used by another app.";
          }
        } else {
          errorMessage =
            "Unable to start camera. Please make sure your camera is connected and not being used by another app.";
        }
      }

      setError(errorMessage);
      isStreamingRef.current = false;
      isScanningRef.current = false;
      setIsStreaming(false);
      setIsVideoLoading(false);
      setCameraActive(false);
    } finally {
      isStartingRef.current = false;
    }
  }, [
    selectedCamera,
    cameraDevices,
    getCameraDevices,
    initializeWebSocket,
    setIsStreaming,
    setIsVideoLoading,
    setCameraActive,
    setError,
    setSelectedCamera,
    lastStartTimeRef,
    lastStopTimeRef,
    isStartingRef,
    isStreamingRef,
    backendServiceRef,
    streamRef,
    videoRef,
    frameCounterRef,
    skipFramesRef,
    lastFrameTimestampRef,
    isScanningRef,
    backendServiceReadyRef,
    processCurrentFrameRef,
  ]);

  const stopCamera = useCallback(
    (forceCleanup: boolean = false) => {
      const now = Date.now();
      const timeSinceLastStop = now - lastStopTimeRef.current;

      if (!forceCleanup) {
        if (isStoppingRef.current || !isStreamingRef.current) {
          return;
        }

        if (timeSinceLastStop < 100) {
          return;
        }
      }

      isStoppingRef.current = true;
      lastStopTimeRef.current = now;
      isScanningRef.current = false;

      cleanupStream(streamRef);
      cleanupVideo(videoRef, !forceCleanup);

      isStreamingRef.current = false;
      setIsStreaming(false);
      setIsVideoLoading(false);
      setCameraActive(false);

      cleanupAnimationFrame(animationFrameRef);

      lastDetectionFrameRef.current = null;
      resetLastDetectionRef(lastDetectionRef);
      useDetectionStore.getState().resetDetectionState();

      setDetectionFps(0);
      fpsTrackingRef.current = {
        timestamps: [],
        maxSamples: 10,
        lastUpdateTime: Date.now(),
      };

      resetFrameCounters(frameCounterRef, skipFramesRef, lastFrameTimestampRef);
      resetOverlayRefs();

      const overlayCanvas = overlayCanvasRef.current;
      if (overlayCanvas) {
        const ctx = overlayCanvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        }
      }

      isStoppingRef.current = false;
    },
    [
      resetOverlayRefs,
      setIsStreaming,
      setIsVideoLoading,
      setCameraActive,
      setDetectionFps,
      streamRef,
      videoRef,
      animationFrameRef,
      overlayCanvasRef,
      lastDetectionFrameRef,
      lastDetectionRef,
      frameCounterRef,
      skipFramesRef,
      lastFrameTimestampRef,
      fpsTrackingRef,
      isStreamingRef,
      isScanningRef,
      isStoppingRef,
      lastStopTimeRef,
    ],
  );

  return {
    startCamera,
    stopCamera,
  };
}
