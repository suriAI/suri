import { useRef, useCallback } from "react";
import type { DetectionResult } from "../types";
import { drawOverlays } from "../utils/overlayRenderer";
import { useDetectionStore } from "../stores/detectionStore";
import { useCameraStore } from "../stores/cameraStore";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useUIStore } from "../stores/uiStore";

interface UseOverlayRenderingOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  animationFrameRef: React.MutableRefObject<number | undefined>;
  videoRectRef: React.MutableRefObject<DOMRect | null>;
  lastVideoRectUpdateRef: React.MutableRefObject<number>;
}

export function useOverlayRendering(options: UseOverlayRenderingOptions) {
  const {
    videoRef,
    overlayCanvasRef,
    animationFrameRef,
    videoRectRef,
    lastVideoRectUpdateRef,
  } = options;

  // Zustand stores
  const { currentDetections, currentRecognitionResults } = useDetectionStore();
  const { isStreaming } = useCameraStore();
  const { persistentCooldowns, attendanceCooldownSeconds } = useAttendanceStore();
  const { quickSettings } = useUIStore();
  
  const recognitionEnabled = true;

  const lastCanvasSizeRef = useRef<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const lastVideoSizeRef = useRef<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const scaleFactorsRef = useRef<{
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
  }>({ scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 });
  const lastDetectionHashRef = useRef<string>("");
  const lastHashCalculationRef = useRef<number>(0);
  const lastDetectionRef = useRef<DetectionResult | null>(null);

  const getVideoRect = useCallback(() => {
    const video = videoRef.current;
    if (!video) return null;

    const now = Date.now();
    if (!videoRectRef.current || now - lastVideoRectUpdateRef.current > 200) {
      videoRectRef.current = video.getBoundingClientRect();
      lastVideoRectUpdateRef.current = now;
    }

    return videoRectRef.current;
  }, [videoRef, videoRectRef, lastVideoRectUpdateRef]);

  const calculateScaleFactors = useCallback(() => {
    const video = videoRef.current;
    const overlayCanvas = overlayCanvasRef.current;

    if (!video || !overlayCanvas) return null;

    const currentVideoWidth = video.videoWidth;
    const currentVideoHeight = video.videoHeight;

    if (
      lastVideoSizeRef.current.width === currentVideoWidth &&
      lastVideoSizeRef.current.height === currentVideoHeight &&
      lastCanvasSizeRef.current.width === overlayCanvas.width &&
      lastCanvasSizeRef.current.height === overlayCanvas.height
    ) {
      return scaleFactorsRef.current;
    }

    lastVideoSizeRef.current = {
      width: currentVideoWidth,
      height: currentVideoHeight,
    };
    lastCanvasSizeRef.current = {
      width: overlayCanvas.width,
      height: overlayCanvas.height,
    };

    const displayWidth = overlayCanvas.width;
    const displayHeight = overlayCanvas.height;

    const videoAspectRatio = currentVideoWidth / currentVideoHeight;
    const containerAspectRatio = displayWidth / displayHeight;

    let actualVideoWidth: number;
    let actualVideoHeight: number;
    let offsetX = 0;
    let offsetY = 0;

    if (videoAspectRatio > containerAspectRatio) {
      actualVideoWidth = displayWidth;
      actualVideoHeight = displayWidth / videoAspectRatio;
      offsetY = (displayHeight - actualVideoHeight) / 2;
    } else {
      actualVideoHeight = displayHeight;
      actualVideoWidth = displayHeight * videoAspectRatio;
      offsetX = (displayWidth - actualVideoWidth) / 2;
    }

    const scaleX = actualVideoWidth / currentVideoWidth;
    const scaleY = actualVideoHeight / currentVideoHeight;

    scaleFactorsRef.current = { scaleX, scaleY, offsetX, offsetY };
    return scaleFactorsRef.current;
  }, [videoRef, overlayCanvasRef]);

  const handleDrawOverlays = useCallback(() => {
    drawOverlays({
      videoRef,
      overlayCanvasRef,
      currentDetections,
      isStreaming,
      currentRecognitionResults,
      recognitionEnabled,
      persistentCooldowns,
      attendanceCooldownSeconds,
      quickSettings,
      getVideoRect,
      calculateScaleFactors,
    });
  }, [
    currentDetections,
    isStreaming,
    currentRecognitionResults,
    recognitionEnabled,
    persistentCooldowns,
    attendanceCooldownSeconds,
    quickSettings,
    getVideoRect,
    calculateScaleFactors,
    videoRef,
    overlayCanvasRef,
  ]);

  const animate = useCallback(() => {
    const detectionsToRender = currentDetections;
    const overlayCanvas = overlayCanvasRef.current;
    
    if (!overlayCanvas || !isStreaming) {
      if (overlayCanvas && overlayCanvas.width > 0 && overlayCanvas.height > 0) {
        const ctx = overlayCanvas.getContext("2d", { willReadFrequently: false });
        if (ctx) {
          ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        }
      }
      if (isStreaming) {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
      return;
    }

    if (!detectionsToRender || !detectionsToRender.faces?.length) {
      const ctx = overlayCanvas.getContext("2d", { willReadFrequently: false });
      if (ctx && overlayCanvas.width > 0 && overlayCanvas.height > 0) {
        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
      lastDetectionHashRef.current = "";
      if (isStreaming) {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
      return;
    }

    const now = performance.now();
    const recognitionForHash = currentRecognitionResults;
    let shouldRedraw = false;

    if (now - lastHashCalculationRef.current >= 16) {
      const facesCount = detectionsToRender.faces.length;
      const recognitionCount = recognitionForHash.size;
      
      let hashSum = facesCount * 1000 + recognitionCount;
      
      const sampleCount = Math.min(3, detectionsToRender.faces.length);
      for (let i = 0; i < sampleCount; i++) {
        const face = detectionsToRender.faces[i];
        hashSum += Math.round(face.bbox.x / 10) * 100;
        hashSum += Math.round(face.bbox.y / 10) * 10;
      }
      
      let recIndex = 0;
      for (const [trackId, result] of recognitionForHash) {
        if (recIndex >= 3) break;
        hashSum += trackId * 1000;
        if (result.person_id) {
          hashSum += result.person_id.length * 100;
        }
        recIndex++;
      }
      
      // Include persistentCooldowns in hash to trigger redraw when cooldowns change
      // This ensures the "Done" indicator appears/disappears correctly
      hashSum += persistentCooldowns.size * 10000;
      let cooldownIndex = 0;
      for (const [personId, cooldownInfo] of persistentCooldowns) {
        if (cooldownIndex >= 5) break;
        hashSum += personId.length * 1000;
        hashSum += Math.floor(cooldownInfo.startTime / 1000);
        cooldownIndex++;
      }
      
      const simpleHash = String(hashSum);

      if (simpleHash !== lastDetectionHashRef.current) {
        lastDetectionHashRef.current = simpleHash;
        shouldRedraw = true;
        lastHashCalculationRef.current = now;
      }
    } else {
      if (detectionsToRender !== lastDetectionRef.current) {
        shouldRedraw = true;
        lastDetectionRef.current = detectionsToRender;
      }
    }

    if (shouldRedraw) {
      handleDrawOverlays();
    }

    if (isStreaming) {
      animationFrameRef.current = requestAnimationFrame(animate);
    }
  }, [
    isStreaming,
    handleDrawOverlays,
    currentDetections,
    currentRecognitionResults,
    persistentCooldowns,
    overlayCanvasRef,
    animationFrameRef,
  ]);

  const resetOverlayRefs = useCallback(() => {
    lastDetectionHashRef.current = "";
    lastVideoSizeRef.current = { width: 0, height: 0 };
    lastCanvasSizeRef.current = { width: 0, height: 0 };
    scaleFactorsRef.current = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
  }, []);

  return {
    getVideoRect,
    calculateScaleFactors,
    animate,
    resetOverlayRefs,
  };
}

