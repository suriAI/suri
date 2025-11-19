import type { AttendanceMember } from "../../types/recognition";

interface RegistrationStatusProps {
  members: AttendanceMember[];
}

export function RegistrationStatus({ members }: RegistrationStatusProps) {
  const total = members.length;
  const registered = members.filter((member) => member.has_face_data).length;

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-white/70">Registered:</span>
      {total === 0 ? (
        <span className="text-sm text-white/60 italic">No members yet</span>
      ) : (
        <span className="text-sm font-semibold text-white">
          {registered} out of {total} {total === 1 ? "member" : "members"}
        </span>
      )}
    </div>
  );
}
