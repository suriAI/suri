import { useState, useEffect, useCallback, useRef } from "react";
import { persistentSettings } from "@/services";

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCameraState] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const setSelectedCamera = useCallback((deviceId: string) => {
    setSelectedCameraState(deviceId);
    persistentSettings
      .setUIState({ selectedCamera: deviceId })
      .catch(console.error);
  }, []);

  // Load saved camera setting on mount
  useEffect(() => {
    persistentSettings.getUIState().then((uiState) => {
      if (uiState.selectedCamera) {
        setSelectedCameraState(uiState.selectedCamera);
      }
    });
  }, []);

  const getCameraDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(
        (device) => device.kind === "videoinput",
      );
      setCameraDevices(videoDevices);
      return videoDevices;
    } catch {
      setCameraError(
        "Unable to detect cameras. Please make sure your camera is connected.",
      );
      return [];
    }
  }, []);

  // Initial load
  useEffect(() => {
    getCameraDevices();
  }, [getCameraDevices]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
    setIsVideoReady(false);
    setCameraError(null);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      setIsStreaming(true);
      setIsVideoReady(false);

      const videoDevices = await getCameraDevices();

      if (videoDevices.length === 0) {
        throw new Error(
          "No camera detected. Please make sure your camera is connected and try again.",
        );
      }

      let deviceIdToUse: string | undefined = undefined;
      let cameraToSelect = selectedCamera;

      // Logic to resolve valid camera ID
      if (cameraToSelect && videoDevices.length > 0) {
        const deviceExists = videoDevices.some(
          (device) => device.deviceId && device.deviceId === cameraToSelect,
        );
        if (deviceExists) {
          deviceIdToUse = cameraToSelect;
        } else {
          console.warn(
            `Selected camera (${cameraToSelect}) not found. Falling back to first available camera.`,
          );
          const validDevice = videoDevices.find(
            (device) => device.deviceId && device.deviceId.trim() !== "",
          );
          if (validDevice) {
            deviceIdToUse = validDevice.deviceId;
            cameraToSelect = validDevice.deviceId;
            setSelectedCamera(validDevice.deviceId);
          }
        }
      } else if (videoDevices.length > 0 && !cameraToSelect) {
        const validDevice = videoDevices.find(
          (device) => device.deviceId && device.deviceId.trim() !== "",
        );
        if (validDevice) {
          deviceIdToUse = validDevice.deviceId;
          cameraToSelect = validDevice.deviceId;
          setSelectedCamera(validDevice.deviceId);
        }
      }

      if (!deviceIdToUse) {
        throw new Error("No valid camera device found.");
      }

      const constraints: MediaStreamConstraints = {
        video: { deviceId: { ideal: deviceIdToUse } },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;

        // Wait for video to be actually ready/playing
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
                if (video.paused) {
                  return video.play();
                }
              })
              .then(() => {
                checkVideoReady();
              })
              .catch((err) => {
                console.error("Video play() failed:", err);
                checkVideoReady();
              });
          });
        };

        await waitForVideoReady();

        if (videoRef.current && videoRef.current.videoWidth > 0) {
          setIsVideoReady(true);
        }
      } else {
        throw new Error("Video element not available");
      }
    } catch (err) {
      console.error("Error starting camera:", err);
      // Construct user-friendly error message
      let errorMessage =
        "Unable to access your camera. Please make sure your camera is connected and try again.";

      if (err instanceof Error) {
        const errorName = err.name;
        if (
          errorName === "NotAllowedError" ||
          errorName === "PermissionDeniedError"
        ) {
          errorMessage =
            "Camera access was blocked. Please allow access in browser settings.";
        } else if (
          errorName === "NotFoundError" ||
          errorName === "DevicesNotFoundError"
        ) {
          errorMessage = "No camera detected.";
        } else if (
          errorName === "NotReadableError" ||
          errorName === "TrackStartError"
        ) {
          errorMessage = "Camera is being used by another app.";
        } else if (
          errorName === "OverconstrainedError" ||
          errorName === "ConstraintNotSatisfiedError"
        ) {
          // Fallback attempt would go here if needed, simplified for hook
          errorMessage = "Unable to start camera with current settings.";
        }
      }

      setCameraError(errorMessage);
      setIsStreaming(false);
      setIsVideoReady(false);
    }
  }, [selectedCamera, getCameraDevices, setSelectedCamera]);

  // Monitor video state
  useEffect(() => {
    if (!isStreaming || !isVideoReady) return;

    const video = videoRef.current;
    if (!video) return;

    const interval = setInterval(() => {
      // Ignore checks if video element is no longer in the DOM (e.g. unmounted)
      if (!video.isConnected) return;

      const isHealthy =
        !!video.srcObject &&
        video.videoWidth > 0 &&
        !video.paused &&
        !cameraError;

      if (!isHealthy) {
        let reason = "unknown";
        if (!video.srcObject) reason = "no srcObject";
        else if (video.videoWidth <= 0) reason = "videoWidth is 0";
        else if (video.paused) reason = "video is paused";
        else if (cameraError) reason = `cameraError: ${cameraError}`;

        console.warn(`Video stream became unhealthy: ${reason}`);
        setIsVideoReady(false);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isStreaming, isVideoReady, cameraError]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return {
    videoRef,
    cameraDevices,
    selectedCamera,
    setSelectedCamera,
    isStreaming,
    isVideoReady,
    cameraError,
    startCamera,
    stopCamera,
  };
}
