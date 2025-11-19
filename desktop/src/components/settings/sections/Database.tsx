import { useState, useEffect, useMemo } from "react";
import { attendanceManager } from "../../../services";
import type { SettingsOverview } from "../types";
import type {
  AttendanceGroup,
  AttendanceMember,
} from "../../../types/recognition";

interface DatabaseProps {
  systemData: SettingsOverview;
  groups: AttendanceGroup[];
  isLoading: boolean;
  onClearDatabase: () => void;
  onGroupsChanged?: () => void;
}

interface GroupWithMembers extends AttendanceGroup {
  members: AttendanceMember[];
  isLoading?: boolean;
}

export function Database({
  systemData,
  groups,
  isLoading,
  onClearDatabase,
  onGroupsChanged,
}: DatabaseProps) {
  const [groupsWithMembers, setGroupsWithMembers] = useState<
    GroupWithMembers[]
  >([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [editingMember, setEditingMember] = useState<{
    personId: string;
    field: "name" | "email" | "role";
  } | null>(null);
  const [editingGroup, setEditingGroup] = useState<{
    groupId: string;
    field: "name" | "description";
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingMember, setSavingMember] = useState<string | null>(null);
  const [savingGroup, setSavingGroup] = useState<string | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null);
  const [deletingMember, setDeletingMember] = useState<string | null>(null);

  // Load members for all groups
  useEffect(() => {
    const loadMembers = async () => {
      const groupsData: GroupWithMembers[] = await Promise.all(
        groups.map(async (group) => {
          try {
            const members = await attendanceManager.getGroupMembers(group.id);
            return { ...group, members, isLoading: false };
          } catch (error) {
            console.error(
              `Error loading members for group ${group.id}:`,
              error,
            );
            return { ...group, members: [], isLoading: false };
          }
        }),
      );
      setGroupsWithMembers(groupsData);
    };

    if (groups.length > 0) {
      loadMembers();
    } else {
      setGroupsWithMembers([]);
    }
  }, [groups]);

  // Filter groups and members based on search
  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) {
      return groupsWithMembers;
    }

    const query = searchQuery.toLowerCase();
    return groupsWithMembers
      .map((group) => {
        const filteredMembers = group.members.filter(
          (member) =>
            member.name.toLowerCase().includes(query) ||
            member.role?.toLowerCase().includes(query) ||
            member.email?.toLowerCase().includes(query),
        );
        return { ...group, members: filteredMembers };
      })
      .filter(
        (group) =>
          group.members.length > 0 || group.name.toLowerCase().includes(query),
      );
  }, [groupsWithMembers, searchQuery]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const startEditing = (
    member: AttendanceMember,
    field: "name" | "email" | "role",
  ) => {
    setEditingMember({ personId: member.person_id, field });
    setEditValue(member[field] || "");
  };

  const cancelEditing = () => {
    setEditingMember(null);
    setEditingGroup(null);
    setEditValue("");
  };

  const startEditingGroup = (
    group: AttendanceGroup,
    field: "name" | "description",
  ) => {
    setEditingGroup({ groupId: group.id, field });
    setEditValue(group[field] || "");
  };

  const saveEdit = async (
    personId: string,
    field: "name" | "email" | "role",
  ) => {
    if (editValue.trim() === "") {
      if (field === "name") {
        alert("Name cannot be empty");
        return;
      }
    }

    setSavingMember(personId);
    try {
      const updates: Partial<AttendanceMember> = {
        [field]: editValue.trim() || undefined,
      };

      const success = await attendanceManager.updateMember(personId, updates);
      if (success) {
        // Update local state
        setGroupsWithMembers((prev) =>
          prev.map((group) => ({
            ...group,
            members: group.members.map((m) =>
              m.person_id === personId
                ? { ...m, [field]: editValue.trim() || undefined }
                : m,
            ),
          })),
        );
        cancelEditing();
      } else {
        alert("Failed to save changes");
      }
    } catch (error) {
      console.error("Error saving member:", error);
      alert("Failed to save changes");
    } finally {
      setSavingMember(null);
    }
  };

  const saveGroupEdit = async (
    groupId: string,
    field: "name" | "description",
  ) => {
    if (field === "name" && !editValue.trim()) {
      alert("Group name cannot be empty");
      return;
    }

    setSavingGroup(groupId);
    try {
      const updates: Partial<AttendanceGroup> = {
        [field]: editValue.trim() || undefined,
      };

      const success = await attendanceManager.updateGroup(groupId, updates);
      if (success) {
        // Update local state
        setGroupsWithMembers((prev) =>
          prev.map((group) =>
            group.id === groupId
              ? { ...group, [field]: editValue.trim() || undefined }
              : group,
          ),
        );
        // Also update the groups prop if needed - we'll trigger a refresh through parent
        cancelEditing();
      } else {
        alert("Failed to save changes");
      }
    } catch (error) {
      console.error("Error saving group:", error);
      alert("Failed to save changes");
    } finally {
      setSavingGroup(null);
    }
  };

  const handleKeyDown = (
    e: React.KeyboardEvent,
    personId: string,
    field: "name" | "email" | "role",
  ) => {
    if (e.key === "Enter") {
      saveEdit(personId, field);
    } else if (e.key === "Escape") {
      cancelEditing();
    }
  };

  const handleGroupKeyDown = (
    e: React.KeyboardEvent,
    groupId: string,
    field: "name" | "description",
  ) => {
    if (e.key === "Enter") {
      saveGroupEdit(groupId, field);
    } else if (e.key === "Escape") {
      cancelEditing();
    }
  };

  const handleDeleteGroup = async (groupId: string, groupName: string) => {
    const confirmMessage = `⚠️ Delete group "${groupName}"?\n\nThis will delete the group and all its members. This cannot be undone.`;
    if (!window.confirm(confirmMessage)) return;

    setDeletingGroup(groupId);
    try {
      const success = await attendanceManager.deleteGroup(groupId);
      if (success) {
        // Remove from local state
        setGroupsWithMembers((prev) => prev.filter((g) => g.id !== groupId));
        // Notify parent to refresh
        if (onGroupsChanged) {
          onGroupsChanged();
        }
      } else {
        alert("Failed to delete group");
      }
    } catch (error) {
      console.error("Error deleting group:", error);
      alert("Failed to delete group");
    } finally {
      setDeletingGroup(null);
    }
  };

  const handleDeleteMember = async (personId: string, memberName: string) => {
    const confirmMessage = `⚠️ Delete member "${memberName}"?\n\nThis cannot be undone.`;
    if (!window.confirm(confirmMessage)) return;

    setDeletingMember(personId);
    try {
      const success = await attendanceManager.removeMember(personId);
      if (success) {
        // Remove from local state
        setGroupsWithMembers((prev) =>
          prev.map((group) => ({
            ...group,
            members: group.members.filter((m) => m.person_id !== personId),
          })),
        );
      } else {
        alert("Failed to delete member");
      }
    } catch (error) {
      console.error("Error deleting member:", error);
      alert("Failed to delete member");
    } finally {
      setDeletingMember(null);
    }
  };

  const handleClearAllGroups = async () => {
    const groupCount = groups.length;
    const confirmMessage = `⚠️ Delete ALL ${groupCount} groups?\n\nThis will delete all groups and all their members. This cannot be undone.`;
    if (!window.confirm(confirmMessage)) return;

    setDeletingGroup("all");
    try {
      // Delete all groups one by one
      const deletePromises = groups.map((group) =>
        attendanceManager.deleteGroup(group.id),
      );
      await Promise.all(deletePromises);

      // Clear local state
      setGroupsWithMembers([]);

      // Notify parent to refresh
      if (onGroupsChanged) {
        onGroupsChanged();
      }

      alert(`✓ Successfully deleted ${groupCount} groups`);
    } catch (error) {
      console.error("Error deleting all groups:", error);
      alert("❌ Failed to delete some groups");
    } finally {
      setDeletingGroup(null);
    }
  };

  const totalMembers = groupsWithMembers.reduce(
    (sum, group) => sum + group.members.length,
    0,
  );

  return (
    <div className="space-y-6 max-w-4xl p-6">
      {/* Statistics Overview */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg p-4 bg-white/5 border border-white/10">
          <div className="text-xs text-white/50 mb-1">Total Groups</div>
          <div className="text-2xl font-semibold text-white">
            {groups.length}
          </div>
        </div>
        <div className="rounded-lg p-4 bg-white/5 border border-white/10">
          <div className="text-xs text-white/50 mb-1">Total Members</div>
          <div className="text-2xl font-semibold text-white">
            {totalMembers}
          </div>
        </div>
        <div className="rounded-lg p-4 bg-white/5 border border-white/10">
          <div className="text-xs text-white/50 mb-1">Registered Faces</div>
          <div className="text-2xl font-semibold text-white">
            {systemData.totalPersons}
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search members by name, email, or role..."
          className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/40 focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20 transition-colors"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60 transition-colors"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        )}
      </div>

      {/* Groups with Members */}
      <div
        className={`space-y-2 ${filteredData.length === 0 ? "h-24" : "h-auto"}`}
      >
        {filteredData.length === 0 ? (
          <div className="text-center py-12 text-white/50">
            <div className="text-sm">No groups or members found</div>
            {groups.length === 0 && (
              <div className="text-xs mt-1">
                Create groups in the Menu to get started
              </div>
            )}
          </div>
        ) : (
          filteredData.map((group) => {
            const isExpanded = expandedGroups.has(group.id);
            const memberCount = group.members.length;

            return (
              <div
                key={group.id}
                className="rounded-lg border border-white/10 bg-white/5 overflow-hidden"
              >
                {/* Group Header */}
                <div className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <button
                      onClick={() => toggleGroup(group.id)}
                      className="flex-shrink-0"
                    >
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
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => saveGroupEdit(group.id, "name")}
                          onKeyDown={(e) =>
                            handleGroupKeyDown(e, group.id, "name")
                          }
                          autoFocus
                          disabled={savingGroup === group.id}
                          className="w-full px-2 py-1 bg-white/5 border border-white/10 rounded text-sm font-semibold text-white focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20 transition-colors"
                        />
                      ) : (
                        <div
                          onClick={() => startEditingGroup(group, "name")}
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
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => saveGroupEdit(group.id, "description")}
                          onKeyDown={(e) =>
                            handleGroupKeyDown(e, group.id, "description")
                          }
                          autoFocus
                          disabled={savingGroup === group.id}
                          placeholder="Description (optional)"
                          className="w-full px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20 transition-colors"
                        />
                      ) : (
                        <div
                          onClick={() =>
                            startEditingGroup(group, "description")
                          }
                          className="text-xs text-white/50 cursor-pointer hover:text-white/80 transition-colors truncate"
                          title="Click to edit description"
                        >
                          {group.description || (
                            <span className="text-white/30 italic">
                              No description
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                    <div className="text-xs text-white/50">
                      {memberCount} {memberCount === 1 ? "member" : "members"}
                    </div>
                    {group.members.filter((m) => m.has_face_data).length >
                      0 && (
                      <div className="text-xs px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                        {group.members.filter((m) => m.has_face_data).length}{" "}
                        registered
                      </div>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteGroup(group.id, group.name);
                      }}
                      disabled={
                        deletingGroup === group.id || deletingGroup === "all"
                      }
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
                          <div
                            key={member.person_id}
                            className="rounded-md p-3 bg-white/5 hover:bg-white/10 border border-white/5 transition-colors"
                          >
                            <div className="flex items-start gap-3">
                              {/* Member Info */}
                              <div className="flex-1 min-w-0 space-y-2">
                                {/* Name */}
                                <div>
                                  {editingMember?.personId ===
                                    member.person_id &&
                                  editingMember.field === "name" ? (
                                    <input
                                      type="text"
                                      value={editValue}
                                      onChange={(e) =>
                                        setEditValue(e.target.value)
                                      }
                                      onBlur={() =>
                                        saveEdit(member.person_id, "name")
                                      }
                                      onKeyDown={(e) =>
                                        handleKeyDown(
                                          e,
                                          member.person_id,
                                          "name",
                                        )
                                      }
                                      autoFocus
                                      disabled={
                                        savingMember === member.person_id
                                      }
                                      className="w-full px-2 py-1 bg-white/5 border border-white/10 rounded text-sm text-white focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20 transition-colors"
                                    />
                                  ) : (
                                    <div
                                      onClick={() =>
                                        startEditing(member, "name")
                                      }
                                      className="text-sm font-semibold text-white cursor-pointer hover:text-cyan-300 transition-colors"
                                      title="Click to edit"
                                    >
                                      {member.name}
                                    </div>
                                  )}
                                </div>

                                {/* Role */}
                                <div>
                                  {editingMember?.personId ===
                                    member.person_id &&
                                  editingMember.field === "role" ? (
                                    <input
                                      type="text"
                                      value={editValue}
                                      onChange={(e) =>
                                        setEditValue(e.target.value)
                                      }
                                      onBlur={() =>
                                        saveEdit(member.person_id, "role")
                                      }
                                      onKeyDown={(e) =>
                                        handleKeyDown(
                                          e,
                                          member.person_id,
                                          "role",
                                        )
                                      }
                                      autoFocus
                                      disabled={
                                        savingMember === member.person_id
                                      }
                                      placeholder="Role (optional)"
                                      className="w-full px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20 transition-colors"
                                    />
                                  ) : (
                                    <div
                                      onClick={() =>
                                        startEditing(member, "role")
                                      }
                                      className="text-xs text-white/60 cursor-pointer hover:text-white/80 transition-colors"
                                      title="Click to edit"
                                    >
                                      {member.role || (
                                        <span className="text-white/30 italic">
                                          No role
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* Email */}
                                <div>
                                  {editingMember?.personId ===
                                    member.person_id &&
                                  editingMember.field === "email" ? (
                                    <input
                                      type="email"
                                      value={editValue}
                                      onChange={(e) =>
                                        setEditValue(e.target.value)
                                      }
                                      onBlur={() =>
                                        saveEdit(member.person_id, "email")
                                      }
                                      onKeyDown={(e) =>
                                        handleKeyDown(
                                          e,
                                          member.person_id,
                                          "email",
                                        )
                                      }
                                      autoFocus
                                      disabled={
                                        savingMember === member.person_id
                                      }
                                      placeholder="Email (optional)"
                                      className="w-full px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20 transition-colors"
                                    />
                                  ) : (
                                    <div
                                      onClick={() =>
                                        startEditing(member, "email")
                                      }
                                      className="text-xs text-white/50 cursor-pointer hover:text-white/70 transition-colors"
                                      title="Click to edit"
                                    >
                                      {member.email || (
                                        <span className="text-white/30 italic">
                                          No email
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Status Indicators & Actions */}
                              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                                <div className="flex items-center gap-2">
                                  {member.has_face_data && (
                                    <div className="text-xs px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                                      Face
                                    </div>
                                  )}
                                  {!member.has_face_data && (
                                    <div className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                      No Face
                                    </div>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteMember(
                                        member.person_id,
                                        member.name,
                                      );
                                    }}
                                    disabled={
                                      deletingMember === member.person_id
                                    }
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
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Clear Actions */}
      <div className="pt-4 border-t border-white/10 space-y-3 pb-8">
        <button
          onClick={handleClearAllGroups}
          disabled={isLoading || deletingGroup === "all" || groups.length === 0}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-sm font-medium text-red-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {deletingGroup === "all" ? (
            <>
              <i className="fa-solid fa-spinner fa-spin"></i>
              <span>Deleting...</span>
            </>
          ) : (
            <>
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                  strokeWidth={2}
                />
              </svg>
              Clear All Groups
            </>
          )}
        </button>
        <button
          onClick={onClearDatabase}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-sm font-medium text-red-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
              strokeWidth={2}
            />
          </svg>
          Clear All Face Data
        </button>
      </div>
    </div>
  );
}
