import type { CaptureSource } from "@/components/group/sections/registration/types";

interface CaptureControlsProps {
  source: CaptureSource;
  setSource: (source: CaptureSource) => void;
  hasRequiredFrame: boolean;
}

export function CaptureControls({
  source,
  setSource,
  hasRequiredFrame,
}: CaptureControlsProps) {
  return (
    <div className="flex flex-col space-y-4">
      <div className="flex gap-2 shrink-0">
        {(["upload", "live"] as CaptureSource[]).map((option) => (
          <button
            key={option}
            onClick={() => setSource(option)}
            disabled={hasRequiredFrame}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
              source === option
                ? "bg-white/10 text-white border border-white/20"
                : "bg-white/5 text-white/40 border border-white/10 hover:bg-white/10 hover:text-white/60"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {option === "upload" ? "Upload" : "Camera"}
          </button>
        ))}
      </div>
    </div>
  );
}
