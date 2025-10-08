// Canvas overlay rendering utilities

import type { DetectionResult } from '../types';
import type { FaceRecognitionResponse } from '../../../types/recognition';
import type { QuickSettings } from '../../Settings';

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
  const cornerRadius = 8; // Modern rounded corners
  
  ctx.beginPath();
  ctx.roundRect(x1, y1, width, height, cornerRadius);
  ctx.stroke();
  
  // Add subtle corner accents for modern look
  const accentLength = 20;
  const accentOffset = 4;
  
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  
  // Top-left corner accent
  ctx.beginPath();
  ctx.moveTo(x1 + accentOffset, y1 + accentLength);
  ctx.lineTo(x1 + accentOffset, y1 + accentOffset);
  ctx.lineTo(x1 + accentLength, y1 + accentOffset);
  ctx.stroke();
  
  // Top-right corner accent
  ctx.beginPath();
  ctx.moveTo(x2 - accentLength, y1 + accentOffset);
  ctx.lineTo(x2 - accentOffset, y1 + accentOffset);
  ctx.lineTo(x2 - accentOffset, y1 + accentLength);
  ctx.stroke();
  
  // Bottom-left corner accent
  ctx.beginPath();
  ctx.moveTo(x1 + accentOffset, y2 - accentLength);
  ctx.lineTo(x1 + accentOffset, y2 - accentOffset);
  ctx.lineTo(x1 + accentLength, y2 - accentOffset);
  ctx.stroke();
  
  // Bottom-right corner accent
  ctx.beginPath();
  ctx.moveTo(x2 - accentLength, y2 - accentOffset);
  ctx.lineTo(x2 - accentOffset, y2 - accentOffset);
  ctx.lineTo(x2 - accentOffset, y2 - accentLength);
  ctx.stroke();
};

export const setupCanvasContext = (ctx: CanvasRenderingContext2D, color: string) => {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
};

export const drawLandmarks = (
  ctx: CanvasRenderingContext2D,
  landmarks: {
    right_eye: { x: number; y: number };
    left_eye: { x: number; y: number };
    nose_tip: { x: number; y: number };
    right_mouth_corner: { x: number; y: number };
    left_mouth_corner: { x: number; y: number };
  },
  scaleX: number,
  scaleY: number,
  offsetX: number,
  offsetY: number
) => {
  const landmarkColor = '#00D4FF';

  Object.entries(landmarks).forEach(([, point]) => {
    const x = point.x * scaleX + offsetX;
    const y = point.y * scaleY + offsetY;

    ctx.save();

    ctx.fillStyle = landmarkColor;
    ctx.shadowColor = landmarkColor;
    ctx.shadowBlur = 4;

    ctx.beginPath();
    ctx.arc(x, y, 3, 0, 2 * Math.PI);
    ctx.fill();

    ctx.restore();
  });
};

export const drawFaceMeshLandmarks = (
  ctx: CanvasRenderingContext2D,
  landmarks: Array<{ x: number; y: number }>,
  scaleX: number,
  scaleY: number,
  offsetX: number,
  offsetY: number
) => {
  const landmarkColor = '#00D4FF';
  const landmarkSize = 1;

  ctx.save();

  ctx.fillStyle = landmarkColor;
  ctx.shadowColor = landmarkColor;
  ctx.shadowBlur = 2;

  landmarks.forEach(point => {
    const x = point.x * scaleX + offsetX;
    const y = point.y * scaleY + offsetY;

    ctx.beginPath();
    ctx.arc(x, y, landmarkSize, 0, 2 * Math.PI);
    ctx.fill();
  });

  ctx.restore();
};

interface DrawOverlaysParams {
  videoRef: React.RefObject<HTMLVideoElement>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement>;
  currentDetections: DetectionResult | null;
  isStreaming: boolean;
  currentRecognitionResults: Map<number, FaceRecognitionResponse>;
  recognitionEnabled: boolean;
  persistentCooldowns: Map<string, { personId: string; memberName: string; startTime: number }>;
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
    let label = "Unknown";
    let shouldShowLabel = false;

    if (isRecognized && recognitionResult && quickSettings.showRecognitionNames) {
      label = recognitionResult.name || recognitionResult.person_id || "Unknown";
      shouldShowLabel = true;
    } else if (antispoofing?.status === 'fake' && quickSettings.showAntiSpoofStatus) {
      label = "⚠ SPOOF";
      shouldShowLabel = true;
    }

    if (shouldShowLabel) {
      ctx.font = 'bold 16px "Courier New", monospace';
      ctx.fillText(label, x1, y1 - 10);
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

          ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.lineWidth = 1;

          const pillWidth = 80;
          const pillHeight = 28;
          const pillRadius = 14;

          ctx.beginPath();
          ctx.roundRect(centerX - pillWidth / 2, centerY - pillHeight / 2, pillWidth, pillHeight, pillRadius);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#FFFFFF';
          ctx.font = '500 14px system-ui, -apple-system, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('Logged', centerX, centerY);

          ctx.restore();
        }
      }
    }

    if (isRecognized && quickSettings.showRecognitionNames) {
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillStyle = "#00ff00";
      ctx.fillText("RECOGNIZED", x1 + 10, y2 + 15);
    }

    if (quickSettings.showLandmarks) {
      if (face.landmarks_468 && face.landmarks_468.length > 0) {
        drawFaceMeshLandmarks(ctx, face.landmarks_468, scaleX, scaleY, offsetX, offsetY);
      } else if (face.landmarks) {
        drawLandmarks(ctx, face.landmarks, scaleX, scaleY, offsetX, offsetY);
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
    case 'general': return '👥';
    default: return '👥';
  }
};
