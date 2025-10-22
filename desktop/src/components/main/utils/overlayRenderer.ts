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

  // All unknown/unrecognized faces should be red, regardless of liveness status
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

export const drawLandmarks = (
  ctx: CanvasRenderingContext2D, 
  landmarks: number[][], 
  scaleX: number, 
  scaleY: number, 
  offsetX: number, 
  offsetY: number,
  color: string,
  bbox?: { x: number; y: number; width: number; height: number },
  displayWidth?: number
) => {
  
  landmarks.forEach((point) => {
    if (point && point.length >= 2) {
      // Mirror X coordinate to match mirrored video display
      const x = displayWidth ? displayWidth - (point[0] * scaleX + offsetX) : point[0] * scaleX + offsetX;
      const y = point[1] * scaleY + offsetY;
      
      if (!isFinite(x) || !isFinite(y)) return;
      
      // Sanity check: skip obviously wrong landmarks
      if (bbox) {
        // Calculate mirrored bbox coordinates if display is mirrored
        const bboxX = displayWidth 
          ? displayWidth - (bbox.x * scaleX + offsetX) - (bbox.width * scaleX)
          : bbox.x * scaleX + offsetX;
        const bboxY = bbox.y * scaleY + offsetY;
        const bboxW = bbox.width * scaleX;
        const bboxH = bbox.height * scaleY;
        
        const margin = Math.max(bboxW, bboxH) * 0.5;
        
        if (x < bboxX - margin || x > bboxX + bboxW + margin ||
            y < bboxY - margin || y > bboxY + bboxH + margin) {
          return;
        }
      }
      
      // FUTURISTIC MINIMALIST DESIGN
      ctx.save();
      
      // Outer glow (subtle)
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      
      // Sharp geometric ring (minimalist)
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'square';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.stroke();
      
      // Remove shadow for inner elements
      ctx.shadowBlur = 0;
      
      // Center dot (sharp, minimal)
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, 2 * Math.PI);
      ctx.fill();
      
      // Crosshair indicator (futuristic targeting aesthetic)
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.6;
      
      // Horizontal line
      ctx.beginPath();
      ctx.moveTo(x - 5, y);
      ctx.lineTo(x - 2, y);
      ctx.moveTo(x + 2, y);
      ctx.lineTo(x + 5, y);
      ctx.stroke();
      
      // Vertical line
      ctx.beginPath();
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x, y - 2);
      ctx.moveTo(x, y + 2);
      ctx.lineTo(x, y + 5);
      ctx.stroke();
      
      ctx.restore();
    }
  });
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
    const { bbox, liveness, landmarks_5 } = face;

    if (!bbox || !isFinite(bbox.x) || !isFinite(bbox.y) || !isFinite(bbox.width) || !isFinite(bbox.height)) return;

    // Mirror X coordinates only if camera mirroring is enabled
    const x1 = quickSettings.cameraMirrored 
      ? displayWidth - (bbox.x * scaleX + offsetX) - (bbox.width * scaleX)
      : bbox.x * scaleX + offsetX;
    const y1 = bbox.y * scaleY + offsetY;
    const x2 = quickSettings.cameraMirrored 
      ? displayWidth - (bbox.x * scaleX + offsetX)
      : (bbox.x + bbox.width) * scaleX + offsetX;
    const y2 = (bbox.y + bbox.height) * scaleY + offsetY;

    if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) return;

    const trackId = face.track_id!;
    const recognitionResult = currentRecognitionResults.get(trackId);
    const color = getFaceColor(recognitionResult || null, recognitionEnabled);

    setupCanvasContext(ctx, color);
    if (quickSettings.showBoundingBoxes) {
      drawBoundingBox(ctx, x1, y1, x2, y2);
    }

    // Draw YuNet 5-point landmarks if available and enabled
    if (quickSettings.showLandmarks && landmarks_5 && Array.isArray(landmarks_5) && landmarks_5.length === 5) {
      drawLandmarks(ctx, landmarks_5, scaleX, scaleY, offsetX, offsetY, color, bbox, quickSettings.cameraMirrored ? displayWidth : undefined);
    }

    const isRecognized = recognitionEnabled && recognitionResult?.person_id;
    let label = "";
    let shouldShowLabel = false;

    if (isRecognized && recognitionResult && quickSettings.showRecognitionNames) {
      label = recognitionResult.name || recognitionResult.person_id;
      shouldShowLabel = true;
    } else if (liveness?.status === 'fake' && quickSettings.showAntiSpoofStatus) {
      label = "SPOOF";
      shouldShowLabel = true;
    } else if (liveness?.status === 'uncertain' && quickSettings.showAntiSpoofStatus) {
      label = "UNCERTAIN";
      shouldShowLabel = true;
    } else if (liveness?.status === 'insufficient_quality' && quickSettings.showAntiSpoofStatus) {
      label = "TOO SMALL";
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
