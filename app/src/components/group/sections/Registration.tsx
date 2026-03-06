import { motion, AnimatePresence } from "framer-motion";
import { EmptyState } from "@/components/group/shared/EmptyState";
import { CameraQueue } from "@/components/group/sections/registration/CameraQueue";
import { BulkRegistration } from "@/components/group/sections/registration/BulkRegistration";
import { FaceCapture } from "@/components/group/sections";
import { useGroupUIStore } from "@/components/group/stores";
import type { AttendanceGroup, AttendanceMember } from "@/types/recognition";

interface RegistrationProps {
  group: AttendanceGroup;
  members: AttendanceMember[];
  onRefresh: () => void;
  deselectMemberTrigger?: number;
  onHasSelectedMemberChange?: (hasSelectedMember: boolean) => void;
  onAddMember?: () => void;
}

export function Registration({
  group,
  members,
  onRefresh,
  deselectMemberTrigger,
  onHasSelectedMemberChange,
  onAddMember,
}: RegistrationProps) {
  const source = useGroupUIStore((state) => state.lastRegistrationSource);
  const mode = useGroupUIStore((state) => state.lastRegistrationMode);
  const setRegistrationState = useGroupUIStore(
    (state) => state.setRegistrationState,
  );
  const handleBack = useGroupUIStore((state) => state.handleRegistrationBack);
  const resetRegistration = useGroupUIStore((state) => state.resetRegistration);

  const animationProps = {
    initial: { opacity: 0, scale: 0.995 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.995 },
    transition: { duration: 0.15, ease: "easeOut" as const },
    style: { willChange: "opacity, transform" },
    className: "h-full w-full",
  };

  return (
    <AnimatePresence mode="wait">
      {mode === "bulk" && source === "upload" ? (
        <motion.div key="bulk-upload" {...animationProps}>
          <BulkRegistration
            group={group}
            members={members}
            onRefresh={onRefresh}
            onClose={resetRegistration}
          />
        </motion.div>
      ) : mode === "queue" && source === "camera" ? (
        <motion.div key="camera-queue" {...animationProps}>
          <CameraQueue
            group={group}
            members={members}
            onRefresh={onRefresh}
            onClose={resetRegistration}
          />
        </motion.div>
      ) : mode === "single" && source ? (
        <motion.div key="single-capture" {...animationProps}>
          <FaceCapture
            group={group}
            members={members}
            onRefresh={onRefresh}
            initialSource={source === "camera" ? "live" : source}
            deselectMemberTrigger={deselectMemberTrigger}
            onHasSelectedMemberChange={onHasSelectedMemberChange}
          />
        </motion.div>
      ) : members.length === 0 ? (
        <motion.div key="empty-state" {...animationProps}>
          <EmptyState
            title="No members in this group yet"
            action={
              onAddMember
                ? {
                  label: "Add Member",
                  onClick: onAddMember,
                }
                : undefined
            }
          />
        </motion.div>
      ) : !source ? (
        <motion.div
          key="source-selection"
          {...animationProps}
          className="h-full flex flex-col items-center justify-center px-6"
        >
          <div className="w-full max-w-lg">
            <div className="flex justify-between items-start mb-12">
              <div className="space-y-1">
                <h2 className="text-2xl text-center font-black text-white/90 tracking-tighter">
                  How would you like to register members for <span className="text-cyan-400/80">{group.name}</span>?
                </h2>
              </div>

              {source && (
                <button
                  onClick={handleBack}
                  className="group flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:border-cyan-500/30 hover:bg-cyan-500/5 text-white/40 hover:text-cyan-400 transition-all duration-300"
                >
                  <i className="fa-solid fa-arrow-left text-xs group-hover:-translate-x-0.5 transition-transform"></i>
                  <span className="text-[10px] font-black uppercase tracking-widest">
                    Back
                  </span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-6">
              <button
                onClick={() => setRegistrationState("camera", null)}
                className="group relative flex flex-col items-center gap-6 p-10 rounded-[2.5rem] border border-white/5 bg-white/5 hover:border-cyan-500/30 hover:bg-cyan-500/3 transition-all duration-300"
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
                onClick={() => setRegistrationState("upload", null)}
                className="group relative flex flex-col items-center gap-6 p-10 rounded-[2.5rem] border border-white/5 bg-white/5 hover:border-cyan-500/30 hover:bg-cyan-500/3 transition-all duration-300"
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
        </motion.div>
      ) : (
        <motion.div
          key="mode-selection"
          {...animationProps}
          className="h-full flex flex-col items-center justify-center px-6"
        >
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
                onClick={() => setRegistrationState(source, "single")}
                className="group p-6 rounded-4xl border border-white/5 bg-white/5 hover:border-cyan-500/30 hover:bg-cyan-500/3 transition-all duration-300 flex items-center gap-6"
              >
                <div className="w-14 h-14 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-cyan-500/10 transition-colors">
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
                  onClick={() => setRegistrationState(source, "bulk")}
                  className="group p-6 rounded-4xl border border-white/5 bg-white/5 hover:border-cyan-500/30 hover:bg-cyan-500/3 transition-all duration-300 flex items-center gap-6"
                >
                  <div className="w-14 h-14 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-cyan-500/10 transition-colors">
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
                  onClick={() => setRegistrationState(source, "queue")}
                  className="group p-6 rounded-4xl border border-white/5 bg-white/5 hover:border-cyan-500/30 hover:bg-cyan-500/3 transition-all duration-300 flex items-center gap-6"
                >
                  <div className="w-14 h-14 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-cyan-500/10 transition-colors">
                    <i className="fa-solid fa-users-viewfinder text-xl text-white/30 group-hover:text-cyan-400"></i>
                  </div>
                  <div className="text-left">
                    <span className="block text-lg font-black text-white/80 group-hover:text-white">
                      Queue
                    </span>
                    <span className="text-[10px] uppercase font-black tracking-widest text-white/20 group-hover:text-cyan-500/50">
                      Multi-member capture
                    </span>
                  </div>
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
