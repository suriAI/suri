import type { AttendanceMember } from "../../../../types/recognition";
import type { EditingMember, MemberField } from "../types";

interface MemberEntryProps {
  member: AttendanceMember;
  editingMember: EditingMember | null;
  editValue: string;
  savingMember: string | null;
  deletingMember: string | null;
  onStartEditing: (member: AttendanceMember, field: MemberField) => void;
  onEditValueChange: (value: string) => void;
  onSaveEdit: (personId: string, field: MemberField, value: string) => void;
  onCancelEditing: () => void;
  onDeleteMember: (personId: string, name: string) => void;
}

export function MemberEntry({
  member,
  editingMember,
  editValue,
  savingMember,
  deletingMember,
  onStartEditing,
  onEditValueChange,
  onSaveEdit,
  onCancelEditing,
  onDeleteMember,
}: MemberEntryProps) {
  const isEditing = (field: MemberField) =>
    editingMember?.personId === member.person_id &&
    editingMember.field === field;

  const handleKeyDown = (e: React.KeyboardEvent, field: MemberField) => {
    if (e.key === "Enter") {
      onSaveEdit(member.person_id, field, editValue);
    } else if (e.key === "Escape") {
      onCancelEditing();
    }
  };

  return (
    <div className="rounded-md p-3 bg-white/5 hover:bg-white/10 border border-white/5 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-2">
          {/* Name */}
          <div>
            {isEditing("name") ? (
              <input
                type="text"
                value={editValue}
                onChange={(e) => onEditValueChange(e.target.value)}
                onBlur={() => onSaveEdit(member.person_id, "name", editValue)}
                onKeyDown={(e) => handleKeyDown(e, "name")}
                autoFocus
                disabled={savingMember === member.person_id}
                className="w-full px-2 py-1 bg-white/5 border border-white/10 rounded text-sm text-white focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20 transition-colors"
              />
            ) : (
              <div
                onClick={() => onStartEditing(member, "name")}
                className="text-sm font-semibold text-white cursor-pointer hover:text-cyan-300 transition-colors"
                title="Click to edit"
              >
                {member.name}
              </div>
            )}
          </div>

          {/* Role */}
          <div>
            {isEditing("role") ? (
              <input
                type="text"
                value={editValue}
                onChange={(e) => onEditValueChange(e.target.value)}
                onBlur={() => onSaveEdit(member.person_id, "role", editValue)}
                onKeyDown={(e) => handleKeyDown(e, "role")}
                autoFocus
                disabled={savingMember === member.person_id}
                placeholder="Role (optional)"
                className="w-full px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20 transition-colors"
              />
            ) : (
              <div
                onClick={() => onStartEditing(member, "role")}
                className="text-xs text-white/60 cursor-pointer hover:text-white/80 transition-colors"
                title="Click to edit"
              >
                {member.role || (
                  <span className="text-white/30 italic">No role</span>
                )}
              </div>
            )}
          </div>

          {/* Email */}
          <div>
            {isEditing("email") ? (
              <input
                type="email"
                value={editValue}
                onChange={(e) => onEditValueChange(e.target.value)}
                onBlur={() => onSaveEdit(member.person_id, "email", editValue)}
                onKeyDown={(e) => handleKeyDown(e, "email")}
                autoFocus
                disabled={savingMember === member.person_id}
                placeholder="Email (optional)"
                className="w-full px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20 transition-colors"
              />
            ) : (
              <div
                onClick={() => onStartEditing(member, "email")}
                className="text-xs text-white/50 cursor-pointer hover:text-white/70 transition-colors"
                title="Click to edit"
              >
                {member.email || (
                  <span className="text-white/30 italic">No email</span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            {member.has_face_data ? (
              <div className="text-xs px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                Face
              </div>
            ) : (
              <div className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                No Face
              </div>
            )}
            <button
              onClick={() => onDeleteMember(member.person_id, member.name)}
              disabled={deletingMember === member.person_id}
              className="px-2 py-0.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Delete member"
            >
              {deletingMember === member.person_id ? (
                <i className="fa-solid fa-spinner fa-spin"></i>
              ) : (
                <i className="fa-solid fa-trash"></i>
              )}
            </button>
          </div>
          {savingMember === member.person_id && (
            <div className="text-xs text-white/40">
              <i className="fa-solid fa-spinner fa-spin"></i>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
