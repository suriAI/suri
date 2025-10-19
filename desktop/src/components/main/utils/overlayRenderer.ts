// Canvas overlay rendering utilities

import type { DetectionResult } from '../types';
import type { FaceRecognitionResponse } from '../../../types/recognition';
import type { QuickSettings } from '../../settings';

export const getFaceColor = (
  recognitionResult: { person_id?: string; confidence?: number; name?: string } | null,
  recognitionEnabled: boolean
) => {
  const isRecognized = recognitionEnabled && recognitionResult?.person_id;

  if (isRecognized) return "#00ff41"; // Green for recognized faces

  // All unknown/unrecognized faces should be red, regardless of antispoofing status
  return "#ff0000"; // Red for all unknown faces
};

export const drawBoundingBox = (ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) => {
  const width = x2 - x1;
  const height = y2 - y1;
  
  // Ultra minimalist full box with sharp corners
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'square';
  
  ctx.beginPath();
  ctx.rect(x1, y1, width, height);
  ctx.stroke();
};

export const setupCanvasContext = (ctx: CanvasRenderingContext2D, color: string) => {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
};


// REMOVED: drawFaceMeshLandmarks - no longer needed

interface DrawOverlaysParams {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  currentDetections: DetectionResult | null;
  isStreaming: boolean;
  currentRecognitionResults: Map<number, FaceRecognitionResponse>;
  recognitionEnabled: boolean;
  persistentCooldowns: Map<string, { personId: string; memberName?: string; startTime: number; lastKnownBbox?: { x: number; y: number; width: number; height: number } }>;
  attendanceCooldownSeconds: number;
  quickSettings: QuickSettings;
  getVideoRect: () => DOMRect | null;
  calculateScaleFactors: () => { scaleX: number; scaleY: number; offsetX: number; offsetY: number } | null;
}

export const drawOverlays = ({
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
}: DrawOverlaysParams) => {
  const video = videoRef.current;
  const overlayCanvas = overlayCanvasRef.current;

  if (!video || !overlayCanvas || !currentDetections) return;

  const ctx = overlayCanvas.getContext('2d', {
    alpha: true,
    willReadFrequently: false
  });
  if (!ctx) return;

  if (!isStreaming || !currentDetections.faces?.length) {
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    return;
  }

  const rect = getVideoRect();
  if (!rect) return;

  const displayWidth = Math.round(rect.width);
  const displayHeight = Math.round(rect.height);

  if (overlayCanvas.width !== displayWidth || overlayCanvas.height !== displayHeight) {
    overlayCanvas.width = displayWidth;
    overlayCanvas.height = displayHeight;
    overlayCanvas.style.width = `${displayWidth}px`;
    overlayCanvas.style.height = `${displayHeight}px`;
  }

  ctx.clearRect(0, 0, displayWidth, displayHeight);

  const scaleFactors = calculateScaleFactors();
  if (!scaleFactors) return;

  const { scaleX, scaleY, offsetX, offsetY } = scaleFactors;

  if (!isFinite(scaleX) || !isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) return;

  currentDetections.faces.forEach((face) => {
    const { bbox, antispoofing } = face;

    if (!bbox || !isFinite(bbox.x) || !isFinite(bbox.y) || !isFinite(bbox.width) || !isFinite(bbox.height)) return;

    const x1 = bbox.x * scaleX + offsetX;
    const y1 = bbox.y * scaleY + offsetY;
    const x2 = (bbox.x + bbox.width) * scaleX + offsetX;
    const y2 = (bbox.y + bbox.height) * scaleY + offsetY;

    if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) return;

    const trackId = face.track_id!;
    const recognitionResult = currentRecognitionResults.get(trackId);
    const color = getFaceColor(recognitionResult || null, recognitionEnabled);

    setupCanvasContext(ctx, color);
    if (quickSettings.showBoundingBoxes) {
      drawBoundingBox(ctx, x1, y1, x2, y2);
    }

    const isRecognized = recognitionEnabled && recognitionResult?.person_id;
    let label = "";
    let shouldShowLabel = false;

    if (isRecognized && recognitionResult && quickSettings.showRecognitionNames) {
      label = recognitionResult.name || recognitionResult.person_id || "Unknown";
      shouldShowLabel = true;
    } else if (antispoofing?.status === 'fake' && quickSettings.showAntiSpoofStatus) {
      label = "SPOOF";
      shouldShowLabel = true;
    } else if (antispoofing?.status === 'uncertain' && quickSettings.showAntiSpoofStatus) {
      label = "UNCERTAIN";
      shouldShowLabel = true;
    }

    if (shouldShowLabel) {
      ctx.font = '600 13px system-ui, -apple-system, sans-serif';
      ctx.fillText(label, x1 + 4, y1 - 6);
    }

    if (isRecognized && recognitionResult?.person_id) {
      const cooldownKey = recognitionResult.person_id;
      const cooldownInfo = persistentCooldowns.get(cooldownKey);
      if (cooldownInfo) {
        const currentTime = Date.now();
        const timeSinceStart = currentTime - cooldownInfo.startTime;
        const cooldownMs = attendanceCooldownSeconds * 1000;

        if (timeSinceStart < cooldownMs) {
          ctx.save();

          const centerX = (x1 + x2) / 2;
          const centerY = (y1 + y2) / 2;

          ctx.fillStyle = '#FFFFFF';
          ctx.font = '500 40px system-ui, -apple-system, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('Done', centerX, centerY);

          ctx.restore();
        }
      }
    }

    ctx.shadowBlur = 0;
  });
};

export const getGroupTypeIcon = (type: string): string => {
  switch (type) {
    case 'employee': return '👔';
    case 'student': return '🎓';
    case 'visitor': return '👤';
    case 'general': return '';
    default: return '';
  }
};
