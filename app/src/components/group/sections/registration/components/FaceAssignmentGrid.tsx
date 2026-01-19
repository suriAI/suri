import type { AttendanceMember } from "../../../../../types/recognition";
import type { DetectedFace } from "../types";

interface FaceAssignmentGridProps {
  detectedFaces: DetectedFace[];
  members: AttendanceMember[];
  availableMembers: AttendanceMember[];
  assignedCount: number;
  isRegistering: boolean;
  onAssignMember: (faceId: string, personId: string) => void;
  onUnassign: (faceId: string) => void;
  onBulkRegister: () => void;
}

export function FaceAssignmentGrid({
  detectedFaces,
  members,
  availableMembers,
  assignedCount,
  isRegistering,
  onAssignMember,
  onUnassign,
  onBulkRegister,
}: FaceAssignmentGridProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="text-2xl font-light text-white">
            {assignedCount}
            <span className="text-white/40">/{detectedFaces.length}</span>
          </div>
          <div className="text-xs text-white/40">assigned</div>
        </div>
        <div className="text-xs text-white/40">
          {availableMembers.length} members available
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {detectedFaces.map((face) => {
          const assignedMember = face.assignedPersonId
            ? members.find((m) => m.person_id === face.assignedPersonId)
            : null;

          return (
            <div
              key={face.faceId}
              className={`group rounded-xl border overflow-hidden transition-all ${
                face.assignedPersonId
                  ? "border-cyan-400/40 bg-gradient-to-br from-cyan-500/10 to-cyan-600/5"
                  : face.isAcceptable
                    ? "border-white/10 bg-white/[0.02] hover:border-white/20"
                    : "border-amber-400/30 bg-amber-500/5"
              }`}
            >
              {/* Face Preview */}
              <div className="relative aspect-square">
                <img
                  src={face.previewUrl}
                  alt="Detected face"
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-black/80">
                  <span className="text-xs text-white">
                    {Math.round(face.confidence * 100)}%
                  </span>
                </div>
                {!face.isAcceptable && (
                  <div className="absolute bottom-2 left-2 right-2 px-2 py-1 rounded-lg bg-amber-500/90 text-center">
                    <div className="text-[10px] font-medium text-black">
                      ⚠️ Low quality
                    </div>
                  </div>
                )}
              </div>

              {/* Assignment */}
              <div className="p-3 space-y-2">
                {/* Member Select */}
                {!face.assignedPersonId ? (
                  <div className="relative">
                    <select
                      value=""
                      onChange={(e) =>
                        onAssignMember(face.faceId, e.target.value)
                      }
                      className="w-full px-2.5 py-2 pr-7 rounded-lg bg-white/5 border border-white/10 text-xs text-white focus:outline-none focus:border-purple-400/50 focus:bg-white/10 transition-all appearance-none cursor-pointer"
                      style={{ colorScheme: "dark" }}
                    >
                      <option value="" className="bg-black text-white">
                        Select member...
                      </option>
                      {availableMembers.map((member) => (
                        <option
                          key={member.person_id}
                          value={member.person_id}
                          className="bg-black text-white"
                        >
                          {member.name}
                        </option>
                      ))}
                    </select>
                    {/* Custom dropdown arrow */}
                    <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                      <svg
                        className="w-2.5 h-2.5 text-white/50 transition-colors duration-200"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2.5}
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-cyan-500/10 border border-cyan-400/20">
                    <div className="flex-1 truncate text-xs text-cyan-200 font-medium">
                      {assignedMember?.name}
                    </div>
                    <button
                      onClick={() => onUnassign(face.faceId)}
                      className="h-6 w-6 rounded-md bg-white/5 hover:bg-red-500/20 text-white/50 hover:text-red-300 transition flex items-center justify-center"
                    >
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {assignedCount > 0 && (
        <button
          onClick={onBulkRegister}
          disabled={isRegistering}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500/20 to-cyan-600/20 border border-cyan-400/40 px-4 py-4 text-sm font-medium text-cyan-100 hover:from-cyan-500/30 hover:to-cyan-600/30 disabled:from-white/5 disabled:to-white/5 disabled:border-white/10 disabled:text-white/30 transition-all shadow-lg shadow-cyan-500/10"
        >
          {isRegistering ? (
            <>
              <div className="h-4 w-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
              <span>Registering {assignedCount} faces...</span>
            </>
          ) : (
            <>
              <span className="text-lg">✓</span>
              <span>
                Register {assignedCount}{" "}
                {assignedCount === 1 ? "Face" : "Faces"}
              </span>
            </>
          )}
        </button>
      )}
    </div>
  );
}
