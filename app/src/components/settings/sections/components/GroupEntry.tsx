import type {
  GroupWithMembers,
  EditingMember,
  EditingGroup,
  MemberField,
  GroupField,
} from "../types";
import { MemberEntry } from "./MemberEntry";
import type {
  AttendanceGroup,
  AttendanceMember,
} from "../../../../types/recognition";

interface GroupEntryProps {
  group: GroupWithMembers;
  isExpanded: boolean;
  editingGroup: EditingGroup | null;
  editingMember: EditingMember | null;
  editValue: string;
  savingGroup: string | null;
  savingMember: string | null;
  deletingGroup: string | null;
  deletingMember: string | null;
  onToggle: (groupId: string) => void;
  onStartEditingGroup: (group: AttendanceGroup, field: GroupField) => void;
  onStartEditingMember: (member: AttendanceMember, field: MemberField) => void;
  onEditValueChange: (value: string) => void;
  onSaveGroupEdit: (groupId: string, field: GroupField, value: string) => void;
  onSaveMemberEdit: (
    personId: string,
    field: MemberField,
    value: string,
  ) => void;
  onCancelEditing: () => void;
  onDeleteGroup: (groupId: string, name: string) => void;
  onDeleteMember: (personId: string, name: string) => void;
}

export function GroupEntry({
  group,
  isExpanded,
  editingGroup,
  editingMember,
  editValue,
  savingGroup,
  savingMember,
  deletingGroup,
  deletingMember,
  onToggle,
  onStartEditingGroup,
  onStartEditingMember,
  onEditValueChange,
  onSaveGroupEdit,
  onSaveMemberEdit,
  onCancelEditing,
  onDeleteGroup,
  onDeleteMember,
}: GroupEntryProps) {
  const memberCount = group.members.length;
  const registeredCount = group.members.filter((m) => m.has_face_data).length;

  const handleGroupKeyDown = (e: React.KeyboardEvent, field: GroupField) => {
    if (e.key === "Enter") {
      onSaveGroupEdit(group.id, field, editValue);
    } else if (e.key === "Escape") {
      onCancelEditing();
    }
  };

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 overflow-hidden">
      {/* Group Header */}
      <div className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-colors">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <button onClick={() => onToggle(group.id)} className="flex-shrink-0">
            <i
              className={`fa-solid fa-chevron-${isExpanded ? "down" : "right"} text-white/40 text-xs transition-transform`}
            ></i>
          </button>
          <div className="flex-1 min-w-0 text-left space-y-1">
            {/* Group Name */}
            {editingGroup?.groupId === group.id &&
            editingGroup.field === "name" ? (
              <input
                type="text"
                value={editValue}
                onChange={(e) => onEditValueChange(e.target.value)}
                onBlur={() => onSaveGroupEdit(group.id, "name", editValue)}
                onKeyDown={(e) => handleGroupKeyDown(e, "name")}
                autoFocus
                disabled={savingGroup === group.id}
                className="w-full px-2 py-1 bg-white/5 border border-white/10 rounded text-sm font-semibold text-white focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20 transition-colors"
              />
            ) : (
              <div
                onClick={() => onStartEditingGroup(group, "name")}
                className="text-sm font-semibold text-white cursor-pointer hover:text-cyan-300 transition-colors truncate"
                title="Click to edit name"
              >
                {group.name}
                {savingGroup === group.id && (
                  <span className="ml-2 text-white/40">
                    <i className="fa-solid fa-spinner fa-spin"></i>
                  </span>
                )}
              </div>
            )}
            {/* Group Description */}
            {editingGroup?.groupId === group.id &&
            editingGroup.field === "description" ? (
              <input
                type="text"
                value={editValue}
                onChange={(e) => onEditValueChange(e.target.value)}
                onBlur={() =>
                  onSaveGroupEdit(group.id, "description", editValue)
                }
                onKeyDown={(e) => handleGroupKeyDown(e, "description")}
                autoFocus
                disabled={savingGroup === group.id}
                placeholder="Description (optional)"
                className="w-full px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20 transition-colors"
              />
            ) : (
              <div
                onClick={() => onStartEditingGroup(group, "description")}
                className="text-xs text-white/50 cursor-pointer hover:text-white/80 transition-colors truncate"
                title="Click to edit description"
              >
                {group.description || (
                  <span className="text-white/30 italic">No description</span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 ml-4">
          <div className="text-xs text-white/50">
            {memberCount} {memberCount === 1 ? "member" : "members"}
          </div>
          {registeredCount > 0 && (
            <div className="text-xs px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              {registeredCount} registered
            </div>
          )}
          <button
            onClick={() => onDeleteGroup(group.id, group.name)}
            disabled={deletingGroup === group.id || deletingGroup === "all"}
            className="px-2 py-1 text-xs bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 hover:text-red-300 rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            title="Delete group"
          >
            {deletingGroup === group.id ? (
              <i className="fa-solid fa-spinner fa-spin"></i>
            ) : (
              <i className="fa-solid fa-trash"></i>
            )}
          </button>
        </div>
      </div>

      {/* Members List */}
      {isExpanded && (
        <div className="border-t border-white/5 bg-white/[0.02]">
          {group.members.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-white/40">
              No members in this group
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {group.members.map((member) => (
                <MemberEntry
                  key={member.person_id}
                  member={member}
                  editingMember={editingMember}
                  editValue={editValue}
                  savingMember={savingMember}
                  deletingMember={deletingMember}
                  onStartEditing={onStartEditingMember}
                  onEditValueChange={onEditValueChange}
                  onSaveEdit={onSaveMemberEdit}
                  onCancelEditing={onCancelEditing}
                  onDeleteMember={onDeleteMember}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
