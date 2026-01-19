import { useState, useEffect, useMemo, useCallback } from "react";
import { attendanceManager } from "../../../../services";
import type {
  AttendanceGroup,
  AttendanceMember,
} from "../../../../types/recognition";
import type {
  GroupWithMembers,
  EditingMember,
  EditingGroup,
  MemberField,
  GroupField,
} from "../types";

export function useDatabaseManagement(
  groups: AttendanceGroup[],
  onGroupsChanged?: () => void,
) {
  const [groupsWithMembers, setGroupsWithMembers] = useState<
    GroupWithMembers[]
  >([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [editingMember, setEditingMember] = useState<EditingMember | null>(
    null,
  );
  const [editingGroup, setEditingGroup] = useState<EditingGroup | null>(null);
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

    if (getGroupsLength(groups) > 0) {
      loadMembers();
    } else {
      setGroupsWithMembers([]);
    }
  }, [groups]);

  function getGroupsLength(g: AttendanceGroup[]) {
    return g.length;
  }

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

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingMember(null);
    setEditingGroup(null);
    setEditValue("");
  }, []);

  const startEditing = useCallback(
    (member: AttendanceMember, field: MemberField) => {
      setEditingMember({ personId: member.person_id, field });
      setEditValue(member[field] || "");
    },
    [],
  );

  const startEditingGroup = useCallback(
    (group: AttendanceGroup, field: GroupField) => {
      setEditingGroup({ groupId: group.id, field });
      setEditValue(group[field] || "");
    },
    [],
  );

  const saveEdit = useCallback(
    async (personId: string, field: MemberField, value: string) => {
      if (value.trim() === "" && field === "name") {
        alert("Name cannot be empty");
        return;
      }

      setSavingMember(personId);
      try {
        const updates: Partial<AttendanceMember> = {
          [field]: value.trim() || undefined,
        };

        const success = await attendanceManager.updateMember(personId, updates);
        if (success) {
          setGroupsWithMembers((prev) =>
            prev.map((group) => ({
              ...group,
              members: group.members.map((m) =>
                m.person_id === personId
                  ? { ...m, [field]: value.trim() || undefined }
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
    },
    [cancelEditing],
  );

  const saveGroupEdit = useCallback(
    async (groupId: string, field: GroupField, value: string) => {
      if (field === "name" && !value.trim()) {
        alert("Group name cannot be empty");
        return;
      }

      setSavingGroup(groupId);
      try {
        const updates: Partial<AttendanceGroup> = {
          [field]: value.trim() || undefined,
        };

        const success = await attendanceManager.updateGroup(groupId, updates);
        if (success) {
          setGroupsWithMembers((prev) =>
            prev.map((group) =>
              group.id === groupId
                ? { ...group, [field]: value.trim() || undefined }
                : group,
            ),
          );
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
    },
    [cancelEditing],
  );

  const handleDeleteGroup = useCallback(
    async (groupId: string, groupName: string) => {
      const confirmMessage = `⚠️ Delete group "${groupName}"?\n\nThis will delete the group and all its members. This cannot be undone.`;
      if (!window.confirm(confirmMessage)) return;

      setDeletingGroup(groupId);
      try {
        const success = await attendanceManager.deleteGroup(groupId);
        if (success) {
          try {
            const { useGroupStore } =
              await import("../../../group/stores/index");
            const groupStore = useGroupStore.getState();
            const currentSelected = groupStore.selectedGroup;

            window.dispatchEvent(
              new CustomEvent("selectGroup", {
                detail: { group: null },
              }),
            );

            if (currentSelected?.id === groupId) {
              groupStore.setSelectedGroup(null);
              groupStore.setMembers([]);
            }
            await groupStore.fetchGroups();
          } catch (error) {
            console.error("[Database] Error updating group store:", error);
          }
          setGroupsWithMembers((prev) => prev.filter((g) => g.id !== groupId));
          if (onGroupsChanged) {
            onGroupsChanged();
          }
        } else {
          alert("Failed to delete group");
        }
      } catch (error) {
        console.error("[Database] ❌ Error deleting group:", error);
        alert("Failed to delete group");
      } finally {
        setDeletingGroup(null);
      }
    },
    [onGroupsChanged],
  );

  const handleDeleteMember = useCallback(
    async (personId: string, memberName: string) => {
      const confirmMessage = `⚠️ Delete member "${memberName}"?\n\nThis cannot be undone.`;
      if (!window.confirm(confirmMessage)) return;

      setDeletingMember(personId);
      try {
        const success = await attendanceManager.removeMember(personId);
        if (success) {
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
    },
    [],
  );

  const handleClearAllGroups = useCallback(async () => {
    const groupCount = groups.length;
    const confirmMessage = `⚠️ Delete ALL ${groupCount} groups?\n\nThis will delete all groups and all their members. This cannot be undone.`;
    if (!window.confirm(confirmMessage)) return;

    setDeletingGroup("all");
    try {
      const deletePromises = groups.map((group) =>
        attendanceManager.deleteGroup(group.id),
      );
      await Promise.all(deletePromises);
      setGroupsWithMembers([]);
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
  }, [groups, onGroupsChanged]);

  const totalMembers = useMemo(
    () =>
      groupsWithMembers.reduce((sum, group) => sum + group.members.length, 0),
    [groupsWithMembers],
  );

  return {
    groupsWithMembers,
    expandedGroups,
    searchQuery,
    setSearchQuery,
    editingMember,
    editingGroup,
    editValue,
    setEditValue,
    savingMember,
    savingGroup,
    deletingGroup,
    deletingMember,
    filteredData,
    toggleGroup,
    startEditing,
    startEditingGroup,
    cancelEditing,
    saveEdit,
    saveGroupEdit,
    handleDeleteGroup,
    handleDeleteMember,
    handleClearAllGroups,
    totalMembers,
  };
}
