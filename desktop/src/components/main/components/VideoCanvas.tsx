import type { RefObject } from 'react';
import type { DetectionResult } from '../types';
import type { QuickSettings } from '../../settings';

interface VideoCanvasProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
  quickSettings: QuickSettings;
  currentDetections: DetectionResult | null;
  detectionFps: number;
  websocketStatus: string;
}

export function VideoCanvas({
  videoRef,
  canvasRef,
  overlayCanvasRef,
  quickSettings,
  currentDetections,
  detectionFps,
  websocketStatus,
}: VideoCanvasProps) {
  return (
    <div className="relative w-full h-full min-h-[260px] overflow-hidden rounded-lg glass-card">
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain"
        playsInline
        muted
      />
      <canvas
        ref={overlayCanvasRef}
        className="absolute top-0 left-0 w-full h-full pointer-events-none"
        style={{
          zIndex: 10,
          mixBlendMode: "normal",
        }}
      />

      {quickSettings.showFPS && detectionFps > 0 && (
        <div className="absolute top-3 left-3 bg-black/60 px-2 py-1 rounded border border-white/10 pointer-events-none" style={{ zIndex: 20 }}>
          <span className="text-green-400 font-mono text-xs font-semibold">{detectionFps.toFixed(1)} FPS</span>
        </div>
      )}

      {quickSettings.showDebugInfo && currentDetections && (
        <div className="absolute top-3 right-3 bg-black/60 px-2 py-1 rounded border border-white/10 pointer-events-none text-xs font-mono" style={{ zIndex: 20 }}>
          <div className="flex items-center gap-3 text-white/70">
            <span>{currentDetections.processing_time.toFixed(0)}ms</span>
            <span>{currentDetections.faces.length}F</span>
            <span className={websocketStatus === 'connected' ? 'text-green-400' : 'text-red-400'}>
              {websocketStatus === 'connected' ? '●' : '○'}
            </span>
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

