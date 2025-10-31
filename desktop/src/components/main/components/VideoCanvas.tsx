import { memo, useMemo } from 'react';
import type { RefObject } from 'react';
import type { QuickSettings } from '../../settings';
import type { DetectionResult } from '../types';
import type { ExtendedFaceRecognitionResponse } from '../index';
import { createDisplayNameMap } from '../../../utils/displayNameUtils';
import type { AttendanceMember } from '../../../types/recognition';

interface VideoCanvasProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
  quickSettings: QuickSettings;
  detectionFps: number;
  isVideoLoading: boolean;
  // Manual mode props
  trackingMode: 'auto' | 'manual';
  currentDetections: DetectionResult | null;
  currentRecognitionResults: Map<number, ExtendedFaceRecognitionResponse>;
  recognitionEnabled: boolean;
  groupMembers: AttendanceMember[];
  handleManualLog: (personId: string, name: string, confidence: number) => void;
  getVideoRect: () => { x: number; y: number; width: number; height: number } | null;
  calculateScaleFactors: () => { scaleX: number; scaleY: number; offsetX: number; offsetY: number } | null;
}

export const VideoCanvas = memo(function VideoCanvas({
  videoRef,
  canvasRef,
  overlayCanvasRef,
  quickSettings,
  detectionFps,
  isVideoLoading,
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
    if (trackingMode !== 'manual' || !currentDetections?.faces?.length) {
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
        const isRecognized = recognitionEnabled && !!recognitionResult?.person_id;

        if (!isRecognized || !recognitionResult?.person_id) return null;

        const displayName = displayNameMap.get(recognitionResult.person_id) || 'Unknown';
        const bbox = face.bbox;

        // Calculate button position below the bounding box
        const x = quickSettings.cameraMirrored
          ? displayWidth - (bbox.x * scaleX + offsetX) - (bbox.width * scaleX) / 2
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
    groupMembers,
    displayNameMap,
    getVideoRect,
    calculateScaleFactors,
    quickSettings.cameraMirrored,
  ]);

  return (
    <div className="relative w-full h-full min-h-[260px] overflow-hidden rounded-lg glass-card">
      <video
        ref={videoRef}
        className={`absolute inset-0 w-full h-full object-contain ${quickSettings.cameraMirrored ? 'scale-x-[-1]' : ''}`}
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
          onClick={() => handleManualLog(button.personId, button.displayName, button.confidence)}
          className="absolute transform -translate-x-1/2 px-3 py-1.5 bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/20 rounded-lg text-white text-xs font-medium transition-all duration-200 hover:scale-105 active:scale-95 shadow-lg z-20"
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
        <div className="absolute top-4 left-4 backdrop-blur-sm bg-white/5 px-3 py-1.5 rounded-full border border-white/10 pointer-events-none z-20">
          <span className="text-white/80 text-sm font-medium">{detectionFps.toFixed(1)} FPS</span>
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

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
});

