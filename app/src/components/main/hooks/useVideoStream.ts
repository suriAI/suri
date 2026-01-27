import { useCallback, useEffect } from "react";
import { useCameraStore, useUIStore } from "../stores";

interface UseVideoStreamOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  isStreamingRef: React.RefObject<boolean>;
  isScanningRef: React.RefObject<boolean>;
  videoRectRef: React.RefObject<DOMRect | null>;
  lastVideoRectUpdateRef: React.RefObject<number>;
  isStartingRef: React.RefObject<boolean>;
}

export function useVideoStream(options: UseVideoStreamOptions) {
  const {
    videoRef,
    canvasRef,
    isStreamingRef,
    isScanningRef,
    videoRectRef,
    lastVideoRectUpdateRef,
    isStartingRef,
  } = options;

  const {
    cameraDevices,
    selectedCamera,
    setCameraDevices,
    setSelectedCamera,
    setIsStreaming,
    setCameraActive,
  } = useCameraStore();
  const { setError } = useUIStore();

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const checkVideoState = () => {
      const hasStream = video.srcObject !== null;
      const isPlaying = !video.paused && !video.ended && video.readyState > 2;
      const shouldBeActive = hasStream && isPlaying;

      const prevActive = useCameraStore.getState().cameraActive;
      if (prevActive !== shouldBeActive) {
        if (shouldBeActive && !isStreamingRef.current) {
          (isStreamingRef as React.RefObject<boolean>).current = true;
          setIsStreaming(true);
        } else if (!shouldBeActive && isStreamingRef.current) {
          if (isStartingRef.current) {
            return;
          }
          (isStreamingRef as React.RefObject<boolean>).current = false;
          setIsStreaming(false);
          (isScanningRef as React.RefObject<boolean>).current = false;
        }
        setCameraActive(shouldBeActive);
      }
    };

    checkVideoState();
    const events = ["loadedmetadata", "play", "pause", "ended", "emptied"];
    events.forEach((event) => {
      video.addEventListener(event, checkVideoState);
    });
    const interval = setInterval(checkVideoState, 200);

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (video && videoRectRef.current) {
          (videoRectRef as React.RefObject<DOMRect | null>).current =
            video.getBoundingClientRect();
          (lastVideoRectUpdateRef as React.RefObject<number>).current =
            Date.now();
        }
      });
    });
    resizeObserver.observe(video);

    return () => {
      events.forEach((event) => {
        video.removeEventListener(event, checkVideoState);
      });
      clearInterval(interval);
      resizeObserver.disconnect();
    };
  }, [
    isScanningRef,
    isStartingRef,
    isStreamingRef,
    lastVideoRectUpdateRef,
    setCameraActive,
    setIsStreaming,
    videoRectRef,
    videoRef,
  ]);

  const captureFrame = useCallback((): Promise<ArrayBuffer | null> => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) {
      return Promise.resolve(null);
    }

    if (video.videoWidth === 0 || video.videoHeight === 0) {
      return Promise.resolve(null);
    }

    const ctx = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: false,
    });
    if (!ctx) {
      return Promise.resolve(null);
    }

    if (
      canvas.width !== video.videoWidth ||
      canvas.height !== video.videoHeight
    ) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    return new Promise((resolve) => {
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(null);
              return;
            }
            blob
              .arrayBuffer()
              .then(resolve)
              .catch(() => {
                resolve(null);
              });
          },
          "image/jpeg",
          0.9,
        );
      } catch {
        resolve(null);
      }
    });
  }, [videoRef, canvasRef]);

  const getCameraDevices = useCallback(async (): Promise<MediaDeviceInfo[]> => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(
        (device) => device.kind === "videoinput",
      );
      setCameraDevices(videoDevices);
      if (videoDevices.length > 0 && !selectedCamera) {
        setSelectedCamera(videoDevices[0].deviceId);
      }
      return videoDevices;
    } catch {
      setError(
        "Unable to detect cameras. Please make sure your camera is connected.",
      );
      return [];
    }
  }, [selectedCamera, setError, setCameraDevices, setSelectedCamera]);

  useEffect(() => {
    getCameraDevices();
  }, [getCameraDevices]);

  return {
    cameraDevices,
    selectedCamera,
    setSelectedCamera,
    captureFrame,
    getCameraDevices,
  };
}
