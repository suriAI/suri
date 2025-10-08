import { RefObject } from 'react';
import type { DetectionResult } from '../types';
import type { QuickSettings } from '../../Settings';

interface VideoCanvasProps {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  overlayCanvasRef: RefObject<HTMLCanvasElement>;
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
    <div className="relative w-full h-full min-h-[260px] overflow-hidden rounded-lg bg-white/[0.02] border border-white/[0.08]">
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

      {/* FPS Counter Overlay */}
      {quickSettings.showFPS && detectionFps > 0 && (
        <div className="absolute top-4 left-4 bg-black/70 backdrop-blur-sm border border-white/20 rounded-lg px-3 py-2 pointer-events-none" style={{ zIndex: 20 }}>
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span className="text-green-400 font-mono text-sm font-semibold">{detectionFps.toFixed(1)} FPS</span>
          </div>
        </div>
      )}

      {/* Debug Info Overlay */}
      {quickSettings.showDebugInfo && currentDetections && (
        <div className="absolute top-4 right-4 bg-black/70 backdrop-blur-sm border border-white/20 rounded-lg px-3 py-2 pointer-events-none text-xs font-mono space-y-1" style={{ zIndex: 20 }}>
          <div className="text-white/60">Time: <span className="text-white">{currentDetections.processing_time.toFixed(1)}ms</span></div>
          <div className="text-white/60">Faces: <span className="text-white">{currentDetections.faces.length}</span></div>
          <div className="text-white/60">WS: <span className={websocketStatus === 'connected' ? 'text-green-400' : 'text-red-400'}>{websocketStatus}</span></div>

          {/* Detailed Spoof Detection Info */}
          {currentDetections.faces.map((face, index) => (
            face.antispoofing && face.antispoofing.live_score !== undefined && face.antispoofing.spoof_score !== undefined && (
              <div key={index} className="border-t border-white/10 pt-1 mt-1">
                <div className="text-white/60">Face {index + 1}:</div>
                <div className="text-green-400">Live: {(face.antispoofing.live_score * 100).toFixed(1)}%</div>
                <div className="text-red-400">Spoof: {(face.antispoofing.spoof_score * 100).toFixed(1)}%</div>
                <div className="text-white/60">Status: <span className={face.antispoofing.status === 'real' ? 'text-green-400' : 'text-red-400'}>{face.antispoofing.status}</span></div>
              </div>
            )
          ))}
        </div>
      )}

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

