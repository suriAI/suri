import { useEffect, useRef, useMemo } from "react";
import type { AttendanceGroup } from "../../../types/recognition";

import { useGroupStore } from "../stores";

/**
 * Hook that provides access to group data from Zustand store
 * Handles initialization and side effects
 */
export function useGroupData(initialGroup?: AttendanceGroup | null) {
  // Use selectors to prevent unnecessary re-renders
  const selectedGroup = useGroupStore((state) => state.selectedGroup);
  const groups = useGroupStore((state) => state.groups);
  const members = useGroupStore((state) => state.members);
  const loading = useGroupStore((state) => state.loading);
  const error = useGroupStore((state) => state.error);
  const lastDeletedGroupId = useGroupStore((state) => state.lastDeletedGroupId);
  const setSelectedGroup = useGroupStore((state) => state.setSelectedGroup);
  const setError = useGroupStore((state) => state.setError);
  const fetchGroups = useGroupStore((state) => state.fetchGroups);
  const fetchGroupDetails = useGroupStore((state) => state.fetchGroupDetails);
  const deleteGroup = useGroupStore((state) => state.deleteGroup);
  const exportData = useGroupStore((state) => state.exportData);

  const selectedGroupRef = useRef<AttendanceGroup | null>(selectedGroup);
  const initialGroupRef = useRef(initialGroup);
  const lastProcessedInitialGroupId = useRef<string | null>(null);
  const lastProcessedGroupsIdsString = useRef<string>("");

  // Memoize groups by IDs to prevent effect from running when array reference changes but contents are the same
  const groupsIdsString = useMemo(() => {
    return groups.map((g) => g.id).sort().join(',');
  }, [groups]);

  // Sync ref with store state
  useEffect(() => {
    selectedGroupRef.current = selectedGroup;
  }, [selectedGroup]);

  // Sync initialGroup changes with store (for when parent updates currentGroup)
  // BUT: Don't sync if initialGroup doesn't exist in groups list (was deleted)
  // IMPORTANT: Also check if selectedGroup is null (was just deleted) - don't restore deleted group
  useEffect(() => {
    // Get fresh groups from store to avoid stale closure
    const currentGroups = useGroupStore.getState().groups;
    const initialGroupId = initialGroup?.id ?? null;
    const selectedGroupId = selectedGroup?.id ?? null;
    
    // Check if groups have actually changed (by IDs)
    const currentGroupsIdsString = currentGroups.map((g) => g.id).sort().join(',');
    const groupsChanged = currentGroupsIdsString !== lastProcessedGroupsIdsString.current;
    
    // Check if initialGroup still exists in groups list
    // Recreate groupIds Set from current groups for accurate check
    const currentGroupIds = new Set(currentGroups.map((g) => g.id));
    const initialGroupExists = initialGroup
      ? currentGroupIds.has(initialGroup.id)
      : false;
    
    // Skip if we've already processed this exact state combination AND groups haven't changed
    // This prevents infinite loops when groups array reference changes but state is unchanged
    if (
      !groupsChanged &&
      initialGroupId === lastProcessedInitialGroupId.current &&
      (
        // Same state: both null or both same ID
        (initialGroupId === null && selectedGroupId === null) ||
        (initialGroupId === selectedGroupId && initialGroupId !== null) ||
        // Or: initialGroup is deleted (doesn't exist) and selectedGroup is null (we've already processed this)
        (initialGroup && !initialGroupExists && selectedGroupId === null)
      ) &&
      (initialGroupId === null || initialGroupRef.current?.id === initialGroupId)
    ) {
      return; // Already processed this exact state and groups haven't changed
    }
    
    // Early exit: If initialGroup is a deleted group (doesn't exist in groups) and we've already processed it
    // This handles the case where groups array reference changes but the deleted group state is the same
    if (!groupsChanged && initialGroup && !initialGroupExists && selectedGroupId === null && initialGroupId === lastProcessedInitialGroupId.current) {
      return; // Already processed this deleted group and groups haven't changed
    }
    
    initialGroupRef.current = initialGroup;
    
    // If there are no groups at all, don't restore any initialGroup
    if (currentGroups.length === 0 && initialGroup) {
      lastProcessedInitialGroupId.current = initialGroupId;
      return;
    }
    
    // If selectedGroup is null (was just deleted), don't restore it even if initialGroup matches
    if (selectedGroup === null && initialGroup) {
      // Check if this initialGroup was just deleted
      if (lastDeletedGroupId === initialGroup.id) {
        lastProcessedInitialGroupId.current = initialGroupId;
        return;
      }
      // Also check if it doesn't exist in groups list
      if (!initialGroupExists) {
        lastProcessedInitialGroupId.current = initialGroupId;
        return;
      }
      // If lastDeletedGroupId is set (deletion in progress), don't restore
      if (lastDeletedGroupId) {
        lastProcessedInitialGroupId.current = initialGroupId;
        return;
      }
    }
    
    // If initialGroup is null and selectedGroup exists, clear it
    if (initialGroup === null && selectedGroup) {
      setSelectedGroup(null);
      lastProcessedInitialGroupId.current = null;
    }
    // If initialGroup is provided but doesn't exist in groups, don't sync
    else if (initialGroup && !initialGroupExists) {
      lastProcessedInitialGroupId.current = initialGroupId;
    }
    // If initialGroup is provided and different from selectedGroup, update it
    else if (initialGroup && initialGroupExists && selectedGroup?.id !== initialGroup.id) {
      setSelectedGroup(initialGroup);
      lastProcessedInitialGroupId.current = initialGroupId;
    }
    // If initialGroup is provided and selectedGroup is null, set it
    else if (initialGroup && initialGroupExists && !selectedGroup) {
      setSelectedGroup(initialGroup);
      lastProcessedInitialGroupId.current = initialGroupId;
    } else {
      lastProcessedInitialGroupId.current = initialGroupId;
    }
    
    // Update refs after processing
    lastProcessedGroupsIdsString.current = currentGroupsIdsString;
  }, [initialGroup, selectedGroup, setSelectedGroup, groupsIdsString, lastDeletedGroupId]);

  // Load groups on mount only (not on every fetchGroups reference change)
  const hasLoadedGroupsRef = useRef(false);
  useEffect(() => {
    if (!hasLoadedGroupsRef.current) {
      hasLoadedGroupsRef.current = true;
      fetchGroups();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Load group details when selected group changes
  useEffect(() => {
    if (selectedGroup) {
      fetchGroupDetails(selectedGroup.id);
    }
  }, [selectedGroup, fetchGroupDetails]);

  return {
    selectedGroup,
    groups,
    members,
    loading,
    error,
    setSelectedGroup,
    setError,
    fetchGroups,
    fetchGroupDetails,
    deleteGroup,
    exportData,
  };
}
