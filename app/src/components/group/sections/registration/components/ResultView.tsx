import type { CapturedFrame } from "@/components/group/sections/registration/types";
import { ImagePreviewWithBbox } from "@/components/group/sections/registration/components/ImagePreviewWithBbox";

interface ResultViewProps {
  frames: CapturedFrame[];
  selectedMemberName: string;
  onRetake: () => void;
  onRegister: () => void;
  isRegistering: boolean;
  framesReady: boolean;
}

export function ResultView({
  frames,
  selectedMemberName,
  onRetake,
  onRegister,
  isRegistering,
  framesReady,
}: ResultViewProps) {
  const REQUIRED_ANGLE = "Front";
  const relevantFrames = frames.filter((f) => f.angle === REQUIRED_ANGLE);

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      {relevantFrames.map((frame) => (
        <div key={frame.id} className="flex-1 min-h-0 flex flex-col">
          <ImagePreviewWithBbox frame={frame} />
        </div>
      ))}
      <div className="absolute top-2 left-2 z-10">
        <div className="text-md font-medium text-white/80 truncate">
          {selectedMemberName}
        </div>
      </div>

      <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1.5">
        <button
          onClick={onRetake}
          className="px-2 py-2 rounded-md border border-white/10 bg-black/40 text-white/70 hover:text-white hover:bg-black/60 text-xs font-medium transition-all min-w-[100px]"
        >
          Retake
        </button>

        <button
          onClick={onRegister}
          disabled={!framesReady || isRegistering}
          className="px-2 py-2 rounded-md border border-cyan-400/50 bg-cyan-500/40 text-cyan-100 hover:bg-cyan-500/50 text-xs font-medium transition-all min-w-[100px] flex items-center justify-center gap-2 disabled:bg-black/40 disabled:border-white/10 disabled:text-white/30 disabled:cursor-not-allowed"
        >
          {isRegistering ? (
            <>
              <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              <span>Saving...</span>
            </>
          ) : (
            "Register"
          )}
        </button>
      </div>
    </div>
  );
}
