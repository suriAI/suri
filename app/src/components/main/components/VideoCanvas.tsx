import { memo, useMemo } from "react";
import type { RefObject } from "react";
import type { QuickSettings } from "@/components/settings";
import type { DetectionResult } from "@/components/main/types";
import type { ExtendedFaceRecognitionResponse } from "@/components/main/utils";
import { createDisplayNameMap } from "@/utils";
import type { AttendanceMember } from "@/types/recognition";

interface VideoCanvasProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
  quickSettings: QuickSettings;
  detectionFps: number;
  isVideoLoading: boolean;
  isStreaming: boolean;
  hasSelectedGroup: boolean;
  // Manual mode props
  trackingMode: "auto" | "manual";
  currentDetections: DetectionResult | null;
  currentRecognitionResults: Map<number, ExtendedFaceRecognitionResponse>;
  recognitionEnabled: boolean;
  groupMembers: AttendanceMember[];
  handleManualLog: (personId: string, name: string, confidence: number) => void;
  getVideoRect: () => {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  calculateScaleFactors: () => {
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
  } | null;
}

export const VideoCanvas = memo(function VideoCanvas({
  videoRef,
  canvasRef,
  overlayCanvasRef,
  quickSettings,
  detectionFps,
  isVideoLoading,
  isStreaming,
  hasSelectedGroup,
  trackingMode,
  currentDetections,
  currentRecognitionResults,
  recognitionEnabled,
  groupMembers,
  handleManualLog,
  getVideoRect,
  calculateScaleFactors,
}: VideoCanvasProps) {
  // Create display name map for members
  const displayNameMap = useMemo(() => {
    return createDisplayNameMap(groupMembers);
  }, [groupMembers]);

  // Calculate button positions for manual mode
  const manualLogButtons = useMemo(() => {
    if (trackingMode !== "manual" || !currentDetections?.faces?.length) {
      return [];
    }

    const rect = getVideoRect();
    const scaleFactors = calculateScaleFactors();
    if (!rect || !scaleFactors) return [];

    const { scaleX, scaleY, offsetX, offsetY } = scaleFactors;
    const displayWidth = rect.width;

    return currentDetections.faces
      .map((face) => {
        const trackId = face.track_id!;
        const recognitionResult = currentRecognitionResults.get(trackId);
        const isRecognized =
          recognitionEnabled && !!recognitionResult?.person_id;

        if (!isRecognized || !recognitionResult?.person_id) return null;

        const displayName =
          displayNameMap.get(recognitionResult.person_id) || "Unknown";
        const bbox = face.bbox;

        // Calculate button position below the bounding box
        const x = quickSettings.cameraMirrored
          ? displayWidth -
          (bbox.x * scaleX + offsetX) -
          (bbox.width * scaleX) / 2
          : (bbox.x + bbox.width / 2) * scaleX + offsetX;
        const y = (bbox.y + bbox.height) * scaleY + offsetY + 8; // 8px below bbox

        return {
          trackId,
          personId: recognitionResult.person_id,
          displayName,
          confidence: face.confidence,
          x,
          y,
        };
      })
      .filter((btn): btn is NonNullable<typeof btn> => btn !== null);
  }, [
    trackingMode,
    currentDetections,
    currentRecognitionResults,
    recognitionEnabled,
    displayNameMap,
    getVideoRect,
    calculateScaleFactors,
    quickSettings.cameraMirrored,
  ]);

  return (
    <div className="relative w-full h-full min-h-[260px] overflow-hidden rounded-lg bg-black border border-white/[0.08]">
      <video
        ref={videoRef}
        className={`absolute inset-0 w-full h-full object-contain ${quickSettings.cameraMirrored ? "scale-x-[-1]" : ""}`}
        playsInline
        muted
      />
      <canvas
        ref={overlayCanvasRef}
        className="absolute top-0 left-0 w-full h-full pointer-events-none z-10"
        style={{
          mixBlendMode: "normal",
        }}
      />

      {/* Manual Mode - Floating LOG Buttons (Rank #1 UX Pattern) */}
      {manualLogButtons.map((button) => (
        <button
          key={button.trackId}
          onClick={() =>
            handleManualLog(
              button.personId,
              button.displayName,
              button.confidence,
            )
          }
          className="absolute transform -translate-x-1/2 px-3 py-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-white text-xs font-medium transition-all duration-200 hover:scale-105 active:scale-95 shadow-lg z-20"
          style={{
            left: `${button.x}px`,
            top: `${button.y}px`,
          }}
          title={`Log ${button.displayName}`}
        >
          <i className="fa-solid fa-circle-check mr-1.5"></i>
          LOG
        </button>
      ))}

      {quickSettings.showFPS && detectionFps > 0 && (
        <div className="absolute top-4 left-4 bg-white/5 px-3 py-1.5 rounded-full border border-white/10 pointer-events-none z-20">
          <span className="text-white/80 text-sm font-medium">
            {detectionFps.toFixed(1)} FPS
          </span>
        </div>
      )}

      {/* Minimalist Video Loader */}
      {isVideoLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none z-15">
          <div className="flex flex-col items-center">
            <div className="w-20 h-20 border-2 border-white/20 border-t-white/60 rounded-full animate-spin"></div>
          </div>
        </div>
      )}

      {/* Camera Icon - Show when not streaming (before Start Tracking) */}
      {!isStreaming && !isVideoLoading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-15">
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <div className="relative">
              <svg
                className="w-16 h-16 text-white/30 animate-pulse"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            </div>
            <div className="text-xs text-white/60 max-w-sm">
              {hasSelectedGroup
                ? "Select a camera, then press Start Tracking to begin attendance."
                : "Create or select a group to start tracking attendance."}
            </div>
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
});
