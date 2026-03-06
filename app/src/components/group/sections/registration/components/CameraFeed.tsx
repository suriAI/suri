import { Dropdown } from "@/components/shared";
import type { CaptureSource } from "@/components/group/sections/registration/types";

interface CameraFeedProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isStreaming: boolean;
  isVideoReady: boolean;
  cameraError: string | null;
  onCapture: () => void;
  onStart: () => void;
  onStop: () => void;
  source: CaptureSource;

  isCameraSelected: boolean;
  cameraDevices: MediaDeviceInfo[];
  selectedCamera: string;
  setSelectedCamera: (deviceId: string) => void;
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
  cameraDevices,
  selectedCamera,
  setSelectedCamera,
}: CameraFeedProps) {
  if (source !== "live") return null;

  return (
    <div className="h-full w-full relative group/feed">
      <video
        ref={videoRef}
        className="w-full h-full object-contain scale-x-[-1]"
        playsInline
        muted
      />

      {/* Compact Camera Selection Overlay */}
      <div className="absolute top-4 left-4 z-30 w-64">
        <Dropdown
          options={cameraDevices.map((device, index) => ({
            value: device.deviceId,
            label: device.label || `Camera ${index + 1}`,
          }))}
          value={selectedCamera}
          onChange={(deviceId) => {
            if (deviceId) {
              setSelectedCamera(String(deviceId));
              if (isStreaming) onStop();
            }
          }}
          placeholder="Select camera…"
          emptyMessage="No cameras available"
          disabled={isStreaming || cameraDevices.length <= 1}
          maxHeight={256}
          buttonClassName="text-[11px] px-3 py-1.5 bg-black/60 border border-white/10 hover:bg-black/80 transition-all font-medium backdrop-blur-md"
          showPlaceholderOption={false}
          allowClear={false}
        />
      </div>

      {!isStreaming && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <div className="text-center space-y-2">
            {cameraError ? (
              <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 max-w-[280px]">
                <div className="text-[11px] text-red-200/60 font-medium">
                  {cameraError}
                </div>
              </div>
            ) : (
              <div className="relative opacity-20">
                <svg
                  className="w-10 h-10 text-white animate-pulse"
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

      {isStreaming && !isVideoReady && !cameraError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <div className="h-10 w-10 rounded-full border-2 border-white/10 border-t-cyan-400 animate-spin" />
        </div>
      )}

      {isStreaming && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20">
          <button
            onClick={() => onCapture()}
            disabled={!isVideoReady || !!cameraError}
            className="px-8 py-2.5 rounded-lg border border-cyan-400/40 bg-cyan-500/20 text-cyan-100 font-bold text-[10px] uppercase tracking-widest hover:bg-cyan-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-cyan-500/10"
          >
            Capture Face
          </button>
        </div>
      )}

      <div className="absolute bottom-6 right-6 z-20">
        <button
          onClick={isStreaming ? onStop : onStart}
          disabled={!isStreaming && !isCameraSelected}
          className={`px-6 py-2.5 rounded-lg border text-[10px] font-black uppercase tracking-widest transition-all min-w-[140px] ${
            isStreaming
              ? "bg-red-500/20 border-red-500/30 text-red-200 hover:bg-red-500/30 shadow-lg shadow-red-500/10"
              : isCameraSelected
                ? "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white"
                : "bg-black/20 border-white/5 text-white/20 cursor-not-allowed opacity-50"
          }`}
        >
          {isStreaming ? "Stop Camera" : "Start Camera"}
        </button>
      </div>
    </div>
  );
}
