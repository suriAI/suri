import type { CaptureSource } from "@/components/group/sections/registration/types";

// Helper hook or props could be passed here if needed
interface CameraFeedProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isStreaming: boolean;
  isVideoReady: boolean;
  cameraError: string | null;
  onCapture: () => void;
  onStart: () => void;
  onStop: () => void;
  source: CaptureSource;

  // Specific UI flags
  isCameraSelected: boolean;
}

export function CameraFeed({
  videoRef,
  isStreaming,
  isVideoReady,
  cameraError,
  onCapture,
  onStart,
  onStop,
  source,
  isCameraSelected,
}: CameraFeedProps) {
  // If source is not live, we don't render this component usually,
  // but parent controls that.

  if (source !== "live") return null;

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      <div className="flex-1 relative overflow-hidden rounded-xl border border-white/20 bg-black">
        <video
          ref={videoRef}
          className="w-full h-full object-contain scale-x-[-1]"
          playsInline
          muted
        />

        {/* Not Streaming State */}
        {!isStreaming && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/90">
            <div className="text-center space-y-2">
              {cameraError ? (
                <div className="text-sm text-white/60">{cameraError}</div>
              ) : (
                <div className="relative">
                  <svg
                    className="w-8 h-8 text-white/30 animate-pulse"
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
              )}
            </div>
          </div>
        )}

        {/* Loading State */}
        {isStreaming && !isVideoReady && !cameraError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="h-12 w-12 rounded-full border-2 border-white/20 border-t-cyan-400 animate-spin" />
          </div>
        )}

        {/* Error State Overlay */}
        {cameraError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/90 p-4 text-center">
            <div className="space-y-2">
              <div className="text-xs text-red-300">{cameraError}</div>
            </div>
          </div>
        )}

        {/* Capture Button */}
        {isStreaming && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10">
            <button
              onClick={() => onCapture()}
              disabled={!isVideoReady || !!cameraError}
              className="px-3 py-1.5 rounded-md border border-cyan-400/50 bg-cyan-500/40 text-xs font-medium text-cyan-100 hover:bg-cyan-500/50 disabled:bg-black/40 disabled:border-white/10 disabled:text-white/30 disabled:cursor-not-allowed transition-all"
            >
              Capture Face
            </button>
          </div>
        )}

        {/* Start/Stop Controls */}
        <div className="absolute bottom-2 right-2 z-10">
          <button
            onClick={isStreaming ? onStop : onStart}
            disabled={!isStreaming && !isCameraSelected}
            // Note: parent logic was: disabled = !isButtonEnabled
            // isButtonEnabled = isStreaming || (isCameraSelected && !isStreaming)
            className={`px-2 py-2 rounded-md border text-xs font-medium transition-all min-w-[100px] ${isStreaming
                ? "bg-red-500/40 border-red-400/50 text-red-100 hover:bg-red-500/50"
                : isCameraSelected
                  ? "bg-cyan-500/40 border-cyan-400/50 text-cyan-100 hover:bg-cyan-500/50"
                  : "bg-black/40 border-white/10 text-white/30 cursor-not-allowed opacity-50"
              }`}
          >
            {isStreaming ? "Stop Camera" : "Start Camera"}
          </button>
        </div>
      </div>
    </div>
  );
}
