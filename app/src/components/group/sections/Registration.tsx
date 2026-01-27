import { useEffect, useCallback } from "react";
import { CameraQueue } from "./registration/CameraQueue";
import { BulkRegistration } from "./registration/BulkRegistration";
import { FaceCapture } from "../sections";
import { useGroupUIStore } from "../stores";
import type {
  AttendanceGroup,
  AttendanceMember,
} from "../../../types/recognition.js";

interface RegistrationProps {
  group: AttendanceGroup;
  members: AttendanceMember[];
  onRefresh: () => void;
  deselectMemberTrigger?: number;
  onHasSelectedMemberChange?: (hasSelectedMember: boolean) => void;
  onAddMember?: () => void;
}

type SourceType = "upload" | "camera" | null;
type RegistrationMode = "single" | "bulk" | "queue" | null;

export function Registration({
  group,
  members,
  onRefresh,
  deselectMemberTrigger,
  onHasSelectedMemberChange,
  onAddMember,
}: RegistrationProps) {
  // Store integration
  // Store integration
  const source = useGroupUIStore((state) => state.lastRegistrationSource);
  const mode = useGroupUIStore((state) => state.lastRegistrationMode);
  const preSelectedId = useGroupUIStore((state) => state.preSelectedMemberId);
  const setRegistrationState = useGroupUIStore(
    (state) => state.setRegistrationState,
  );

  // Handle Deep Linking / Pre-selection
  useEffect(() => {
    if (preSelectedId && !source && !mode) {
      setRegistrationState("camera", "single");
    }
  }, [preSelectedId, source, mode, setRegistrationState]);

  const handleSourceChange = useCallback(
    (newSource: SourceType) => {
      setRegistrationState(newSource, mode);
    },
    [mode, setRegistrationState],
  );

  const handleModeChange = useCallback(
    (newMode: RegistrationMode) => {
      setRegistrationState(source, newMode);
    },
    [source, setRegistrationState],
  );

  const handleBack = useCallback(() => {
    if (mode) {
      setRegistrationState(source, null);
    } else {
      setRegistrationState(null, null);
    }
    // Also clear pre-selection when going back
    useGroupUIStore.setState({ preSelectedMemberId: null });
  }, [mode, source, setRegistrationState]);

  // --- Sub-View Routing ---

  if (mode === "bulk" && source === "upload") {
    return (
      <BulkRegistration
        group={group}
        members={members}
        onRefresh={onRefresh}
        onClose={handleBack}
      />
    );
  }

  if (mode === "queue" && source === "camera") {
    return (
      <CameraQueue
        group={group}
        members={members}
        onRefresh={onRefresh}
        onClose={handleBack}
      />
    );
  }

  if (mode === "single" && source) {
    return (
      <FaceCapture
        group={group}
        members={members}
        onRefresh={onRefresh}
        initialSource={source === "camera" ? "live" : source}
        deselectMemberTrigger={deselectMemberTrigger}
        onSelectedMemberChange={onHasSelectedMemberChange}
        // preSelectedMemberId is handled internally by FaceCapture reading from store if needed
        // but it's better if we just use FaceCapture's internal selection logic.
        // Let's ensure FaceCapture picks up the preSelectedId.
      />
    );
  }

  // --- Main View (Wizard / Quick Start) ---

  if (members.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-6">
        <div className="flex flex-col items-center justify-center space-y-4 max-w-sm text-center">
          <div className="w-16 h-16 rounded-3xl bg-white/[0.02] border border-white/5 flex items-center justify-center mb-2">
            <i className="fa-solid fa-user-plus text-2xl text-white/10"></i>
          </div>
          <div>
            <h3 className="text-base font-bold text-white/80 mb-1">
              Add your first member
            </h3>
            <p className="text-xs text-white/30 leading-relaxed">
              Create a member profile first so we can attach face data to it.
            </p>
          </div>
          {onAddMember && (
            <button
              onClick={onAddMember}
              className="px-6 py-2.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 rounded-xl text-cyan-400 text-xs font-black uppercase tracking-widest transition-all active:scale-95"
            >
              Get Started
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!source) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-lg space-y-8">
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-black text-white/90 tracking-tight">
              How would you like to add faces?
            </h2>
            <p className="text-sm text-white/30 max-w-xs mx-auto font-medium leading-relaxed">
              How would you like to capture faces for{" "}
              <span className="text-cyan-400/80">{group.name}</span>?
            </p>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <button
              onClick={() => handleSourceChange("camera")}
              className="group relative flex flex-col items-center gap-6 p-10 rounded-[2.5rem] border border-white/5 bg-white/[0.02] hover:border-cyan-500/30 hover:bg-cyan-500/[0.03] transition-all duration-300"
            >
              <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center group-hover:scale-110 group-hover:shadow-[0_0_30px_rgba(34,211,238,0.15)] transition-all duration-500">
                <i className="fa-solid fa-camera-retro text-4xl text-white/40 group-hover:text-cyan-400 transition-colors"></i>
              </div>
              <div className="text-center">
                <span className="block text-lg font-black text-white/80 group-hover:text-white transition-colors">
                  Camera
                </span>
                <span className="text-[10px] uppercase font-black tracking-widest text-white/20 group-hover:text-cyan-500/50 transition-colors">
                  Live Capture
                </span>
              </div>
            </button>

            <button
              onClick={() => handleSourceChange("upload")}
              className="group relative flex flex-col items-center gap-6 p-10 rounded-[2.5rem] border border-white/5 bg-white/[0.02] hover:border-cyan-500/30 hover:bg-cyan-500/[0.03] transition-all duration-300"
            >
              <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center group-hover:scale-110 group-hover:shadow-[0_0_30px_rgba(34,211,238,0.15)] transition-all duration-500">
                <i className="fa-solid fa-cloud-arrow-up text-4xl text-white/40 group-hover:text-cyan-400 transition-colors"></i>
              </div>
              <div className="text-center">
                <span className="block text-lg font-black text-white/80 group-hover:text-white transition-colors">
                  File
                </span>
                <span className="text-[10px] uppercase font-black tracking-widest text-white/20 group-hover:text-cyan-500/50 transition-colors">
                  Local Photos
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-lg space-y-8">
        <div className="text-center space-y-2 relative">
          <h2 className="text-2xl font-black text-white/90 tracking-tight">
            Registration Method
          </h2>
          <p className="text-sm text-white/30 max-w-xs mx-auto font-medium leading-relaxed uppercase tracking-widest text-[9px]">
            Selected Source:{" "}
            <span className="text-cyan-400/80">
              {source === "camera" ? "Live Camera" : "Photo Upload"}
            </span>
          </p>
        </div>

        <div className="grid gap-4">
          <button
            onClick={() => handleModeChange("single")}
            className="group p-6 rounded-[2rem] border border-white/5 bg-white/[0.02] hover:border-cyan-500/30 hover:bg-cyan-500/[0.03] transition-all duration-300 flex items-center gap-6"
          >
            <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center group-hover:bg-cyan-500/10 transition-colors">
              <i className="fa-solid fa-user text-xl text-white/30 group-hover:text-cyan-400"></i>
            </div>
            <div className="text-left">
              <span className="block text-lg font-black text-white/80 group-hover:text-white">
                One person
              </span>
              <span className="text-[10px] uppercase font-black tracking-widest text-white/20 group-hover:text-cyan-500/50">
                One member at a time
              </span>
            </div>
          </button>

          {source === "upload" && (
            <button
              onClick={() => handleModeChange("bulk")}
              className="group p-6 rounded-[2rem] border border-white/5 bg-white/[0.02] hover:border-cyan-500/30 hover:bg-cyan-500/[0.03] transition-all duration-300 flex items-center gap-6"
            >
              <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center group-hover:bg-cyan-500/10 transition-colors">
                <i className="fa-solid fa-layer-group text-xl text-white/30 group-hover:text-cyan-400"></i>
              </div>
              <div className="text-left">
                <span className="block text-lg font-black text-white/80 group-hover:text-white">
                  Multiple photos
                </span>
                <span className="text-[10px] uppercase font-black tracking-widest text-white/20 group-hover:text-cyan-500/50">
                  Upload several portraits
                </span>
              </div>
            </button>
          )}

          {source === "camera" && (
            <button
              onClick={() => handleModeChange("queue")}
              className="group p-6 rounded-[2rem] border border-white/5 bg-white/[0.02] hover:border-cyan-500/30 hover:bg-cyan-500/[0.03] transition-all duration-300 flex items-center gap-6"
            >
              <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center group-hover:bg-cyan-500/10 transition-colors">
                <i className="fa-solid fa-users-viewfinder text-xl text-white/30 group-hover:text-cyan-400"></i>
              </div>
              <div className="text-left">
                <span className="block text-lg font-black text-white/80 group-hover:text-white">
                  Quick sequence
                </span>
                <span className="text-[10px] uppercase font-black tracking-widest text-white/20 group-hover:text-cyan-500/50">
                  Fast multi-person capture
                </span>
              </div>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
