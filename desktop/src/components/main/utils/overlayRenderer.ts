// Canvas overlay rendering utilities

import type { DetectionResult } from "../types";
import type { ExtendedFaceRecognitionResponse } from "../index";
import type { QuickSettings } from "../../settings";

export const getFaceColor = (
  recognitionResult: {
    person_id?: string;
    confidence?: number;
    name?: string;
  } | null,
  recognitionEnabled: boolean,
) => {
  const isRecognized = recognitionEnabled && recognitionResult?.person_id;

  if (isRecognized) return "#00ff41"; // Green for recognized faces

  // All unknown/unrecognized faces should be red, regardless of liveness status
  return "#ff0000"; // Red for all unknown faces
};

export const drawBoundingBox = (
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) => {
  const width = x2 - x1;
  const height = y2 - y1;

  // Ultra minimalist full box with sharp corners
  ctx.lineWidth = 1.5;
  ctx.lineCap = "square";

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
  displayWidth?: number,
  displayHeight?: number,
) => {
  if (!bbox || landmarks.length < 4) {
    landmarks.forEach((point) => {
      if (point && point.length >= 2) {
        const x = displayWidth
          ? displayWidth - (point[0] * scaleX + offsetX)
          : point[0] * scaleX + offsetX;
        const y = point[1] * scaleY + offsetY;

        if (!isFinite(x) || !isFinite(y)) return;

        if (displayWidth !== undefined && displayHeight !== undefined) {
          const largeMargin = Math.max(
            20,
            Math.min(100, Math.max(displayWidth, displayHeight) * 0.05)
          );
          if (
            x < -largeMargin ||
            x > displayWidth + largeMargin ||
            y < -largeMargin ||
            y > displayHeight + largeMargin
          ) {
            return;
          }

          ctx.save();
          ctx.shadowColor = color;
          ctx.shadowBlur = 8;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.lineCap = "square";
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, 2 * Math.PI);
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(x, y, 1, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.globalAlpha = 0.6;
          ctx.beginPath();
          const hStart = Math.max(0, x - 5);
          const hMid1 = Math.max(0, x - 2);
          const hMid2 = Math.min(displayWidth, x + 2);
          const hEnd = Math.min(displayWidth, x + 5);
          ctx.moveTo(hStart, y);
          ctx.lineTo(hMid1, y);
          ctx.moveTo(hMid2, y);
          ctx.lineTo(hEnd, y);
          ctx.stroke();
          ctx.beginPath();
          const vStart = Math.max(0, y - 5);
          const vMid1 = Math.max(0, y - 2);
          const vMid2 = Math.min(displayHeight, y + 2);
          const vEnd = Math.min(displayHeight, y + 5);
          ctx.moveTo(x, vStart);
          ctx.lineTo(x, vMid1);
          ctx.moveTo(x, vMid2);
          ctx.lineTo(x, vEnd);
          ctx.stroke();
          ctx.restore();
        }
      }
    });
    return;
  }

  const bboxX = displayWidth
    ? displayWidth - (bbox.x * scaleX + offsetX) - bbox.width * scaleX
    : bbox.x * scaleX + offsetX;
  const bboxY = bbox.y * scaleY + offsetY;
  const bboxW = bbox.width * scaleX;
  const bboxH = bbox.height * scaleY;
  const bboxCenterX = bboxX + bboxW / 2;
  const bboxCenterY = bboxY + bboxH / 2;

  const transformedLandmarks: Array<{ x: number; y: number; original: number[] }> = [];
  for (const point of landmarks) {
    if (point && point.length >= 2) {
      const x = displayWidth
        ? displayWidth - (point[0] * scaleX + offsetX)
        : point[0] * scaleX + offsetX;
      const y = point[1] * scaleY + offsetY;

      if (isFinite(x) && isFinite(y)) {
        transformedLandmarks.push({ x, y, original: point });
      }
    }
  }

  if (transformedLandmarks.length < 4) {
    return;
  }

  const is5PointLandmarks = landmarks.length === 5;
  
  let outlierThreshold = Infinity;
  if (!is5PointLandmarks && transformedLandmarks.length > 5) {
    const distances = transformedLandmarks.map((lm) =>
      Math.hypot(lm.x - bboxCenterX, lm.y - bboxCenterY)
    );
    const sorted = [...distances].sort((a, b) => a - b);
    const q1Idx = Math.floor(sorted.length * 0.25);
    const q3Idx = Math.floor(sorted.length * 0.75);
    const q1 = sorted[q1Idx];
    const q3 = sorted[q3Idx];
    const iqr = q3 - q1;
    outlierThreshold = q3 + 1.5 * iqr;
  }

  const margin = Math.max(bboxW, bboxH) * 0.5;
  const largeMargin =
    displayWidth !== undefined && displayHeight !== undefined
      ? Math.max(20, Math.min(100, Math.max(displayWidth, displayHeight) * 0.05))
      : 50;

  transformedLandmarks.forEach((lm) => {
    const { x, y } = lm;

    if (
      x < bboxX - margin ||
      x > bboxX + bboxW + margin ||
      y < bboxY - margin ||
      y > bboxY + bboxH + margin
    ) {
      return;
    }

    if (!is5PointLandmarks && outlierThreshold !== Infinity) {
      const distance = Math.hypot(x - bboxCenterX, y - bboxCenterY);
      if (distance > outlierThreshold) {
        return;
      }
    }

    if (displayWidth !== undefined && displayHeight !== undefined) {
      if (
        x < -largeMargin ||
        x > displayWidth + largeMargin ||
        y < -largeMargin ||
        y > displayHeight + largeMargin
      ) {
        return;
      }

      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.lineCap = "square";
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      const hStart = Math.max(0, x - 5);
      const hMid1 = Math.max(0, x - 2);
      const hMid2 = Math.min(displayWidth, x + 2);
      const hEnd = Math.min(displayWidth, x + 5);
      ctx.moveTo(hStart, y);
      ctx.lineTo(hMid1, y);
      ctx.moveTo(hMid2, y);
      ctx.lineTo(hEnd, y);
      ctx.stroke();
      ctx.beginPath();
      const vStart = Math.max(0, y - 5);
      const vMid1 = Math.max(0, y - 2);
      const vMid2 = Math.min(displayHeight, y + 2);
      const vEnd = Math.min(displayHeight, y + 5);
      ctx.moveTo(x, vStart);
      ctx.lineTo(x, vMid1);
      ctx.moveTo(x, vMid2);
      ctx.lineTo(x, vEnd);
      ctx.stroke();
      ctx.restore();
    }
  });
};

export const setupCanvasContext = (
  ctx: CanvasRenderingContext2D,
  color: string,
) => {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.lineCap = "square";
  ctx.lineJoin = "miter";
};

interface DrawOverlaysParams {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  currentDetections: DetectionResult | null;
  isStreaming: boolean;
  currentRecognitionResults: Map<number, ExtendedFaceRecognitionResponse>;
  recognitionEnabled: boolean;
  persistentCooldowns: Map<
    string,
    {
      personId: string;
      memberName?: string;
      startTime: number;
      lastKnownBbox?: { x: number; y: number; width: number; height: number };
      cooldownDurationSeconds: number;
    }
  >;
  attendanceCooldownSeconds: number;
  quickSettings: QuickSettings;
  getVideoRect: () => DOMRect | null;
  calculateScaleFactors: () => {
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
  } | null;
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

  // OPTIMIZATION: Reuse canvas context with optimal settings
  const ctx = overlayCanvas.getContext("2d", {
    alpha: true,
    willReadFrequently: false,
    desynchronized: true, // Enable desynchronized hint for better performance
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

  // OPTIMIZATION: Batch DOM writes - only update if size changed
  if (
    overlayCanvas.width !== displayWidth ||
    overlayCanvas.height !== displayHeight
  ) {
    overlayCanvas.width = displayWidth;
    overlayCanvas.height = displayHeight;
    overlayCanvas.style.width = `${displayWidth}px`;
    overlayCanvas.style.height = `${displayHeight}px`;
  }

  // OPTIMIZATION: Save/restore context state only once at start
  ctx.save();

  ctx.clearRect(0, 0, displayWidth, displayHeight);

  const scaleFactors = calculateScaleFactors();
  if (!scaleFactors) return;

  const { scaleX, scaleY, offsetX, offsetY } = scaleFactors;

  if (!isFinite(scaleX) || !isFinite(scaleY) || scaleX <= 0 || scaleY <= 0)
    return;

  currentDetections.faces.forEach((face) => {
    const { bbox, landmarks_5 } = face;

    if (
      !bbox ||
      !isFinite(bbox.x) ||
      !isFinite(bbox.y) ||
      !isFinite(bbox.width) ||
      !isFinite(bbox.height)
    )
      return;

    // Mirror X coordinates only if camera mirroring is enabled
    const x1 = quickSettings.cameraMirrored
      ? displayWidth - (bbox.x * scaleX + offsetX) - bbox.width * scaleX
      : bbox.x * scaleX + offsetX;
    const y1 = bbox.y * scaleY + offsetY;
    const x2 = quickSettings.cameraMirrored
      ? displayWidth - (bbox.x * scaleX + offsetX)
      : (bbox.x + bbox.width) * scaleX + offsetX;
    const y2 = (bbox.y + bbox.height) * scaleY + offsetY;

    if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2))
      return;

    // CRITICAL: Clamp coordinates to canvas bounds to prevent rendering outside visible area
    // This ensures accuracy even when faces are at video edges
    const clampedX1 = Math.max(0, Math.min(displayWidth, x1));
    const clampedY1 = Math.max(0, Math.min(displayHeight, y1));
    const clampedX2 = Math.max(0, Math.min(displayWidth, x2));
    const clampedY2 = Math.max(0, Math.min(displayHeight, y2));

    // Skip if bbox is completely outside canvas (edge case handling)
    if (clampedX2 <= clampedX1 || clampedY2 <= clampedY1) return;

    const trackId = face.track_id!;
    const recognitionResult = currentRecognitionResults.get(trackId);
    const color = getFaceColor(recognitionResult || null, recognitionEnabled);

    setupCanvasContext(ctx, color);
    if (quickSettings.showBoundingBoxes) {
      // Use clamped coordinates to ensure accurate rendering at edges
      drawBoundingBox(ctx, clampedX1, clampedY1, clampedX2, clampedY2);
    }

    // Draw YuNet 5-point landmarks if available and enabled
    // Pass displayHeight for accurate edge case handling
    if (
      quickSettings.showLandmarks &&
      landmarks_5 &&
      Array.isArray(landmarks_5) &&
      landmarks_5.length === 5
    ) {
      drawLandmarks(
        ctx,
        landmarks_5,
        scaleX,
        scaleY,
        offsetX,
        offsetY,
        color,
        bbox,
        quickSettings.cameraMirrored ? displayWidth : undefined,
        displayHeight,
      );
    }

    const isRecognized = recognitionEnabled && recognitionResult?.person_id;
    let label = "";
    let shouldShowLabel = false;
    const similarityScore =
      isRecognized && recognitionResult?.similarity
        ? (recognitionResult.similarity * 100).toFixed(0)
        : null;

    if (
      isRecognized &&
      recognitionResult &&
      quickSettings.showRecognitionNames
    ) {
      label =
        recognitionResult.name || recognitionResult.person_id || "Unknown";
      shouldShowLabel = true;
    }

    if (shouldShowLabel) {
      ctx.save();

      // Clamp label position to canvas bounds to ensure visibility at edges
      const labelX = Math.max(4, Math.min(displayWidth - 100, clampedX1 + 4));
      const labelY = Math.max(13, Math.min(displayHeight - 4, clampedY1 - 6));

      // Draw name
      ctx.font = "600 13px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = color;
      ctx.fillText(label, labelX, labelY);

      // Draw similarity percentage beside the name if available
      if (similarityScore) {
        // Measure name width to position percentage next to it
        const nameWidth = ctx.measureText(label).width;
        const percentageX = labelX + nameWidth + 6; // 6px spacing

        ctx.font = "500 11px system-ui, -apple-system, sans-serif";
        ctx.globalAlpha = 0.8; // Slightly transparent
        ctx.fillStyle = color;
        ctx.fillText(`${similarityScore}%`, percentageX, labelY);
        ctx.globalAlpha = 1.0; // Reset alpha
      }

      ctx.restore();
    }

    if (isRecognized && recognitionResult?.person_id) {
      const cooldownKey = recognitionResult.person_id;
      const cooldownInfo = persistentCooldowns.get(cooldownKey);
      if (cooldownInfo) {
        const currentTime = Date.now();
        const timeSinceStart = currentTime - cooldownInfo.startTime;
        const cooldownSeconds =
          cooldownInfo.cooldownDurationSeconds ?? attendanceCooldownSeconds;
        const cooldownMs = cooldownSeconds * 1000;
        const remainingMs = cooldownMs - timeSinceStart;
        const remainingCooldownSeconds = Math.floor(remainingMs / 1000);

        // Show "Done" while cooldown is active, but hide when showing 0s for better UX
        if (timeSinceStart < cooldownMs && remainingCooldownSeconds > 0) {
          ctx.save();

          // Use clamped coordinates for center calculation to ensure accurate positioning at edges
          const centerX = (clampedX1 + clampedX2) / 2;
          const centerY = (clampedY1 + clampedY2) / 2;

          ctx.fillStyle = "#FFFFFF";
          ctx.font = "500 40px system-ui, -apple-system, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("Done", centerX, centerY);

          ctx.restore();
        }
      }
    }

    ctx.shadowBlur = 0;
  });

  // OPTIMIZATION: Restore context state once at end
  ctx.restore();
};
