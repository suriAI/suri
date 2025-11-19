import { useEffect, useRef } from "react";
import type { AttendanceGroup } from "../../../types/recognition";

import { useGroupStore } from "../stores";

/**
 * Hook that provides access to group data from Zustand store
 * Handles initialization and side effects
 */
export function useGroupData(initialGroup?: AttendanceGroup | null) {
  const {
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
  } = useGroupStore();

  const selectedGroupRef = useRef<AttendanceGroup | null>(selectedGroup);
  const initialGroupRef = useRef(initialGroup);

  // Sync ref with store state
  useEffect(() => {
    selectedGroupRef.current = selectedGroup;
  }, [selectedGroup]);

  // Initialize with initialGroup if provided
  useEffect(() => {
    if (initialGroupRef.current && !selectedGroup) {
      setSelectedGroup(initialGroupRef.current);
    }
  }, [initialGroup, selectedGroup, setSelectedGroup]);

  // Load groups on mount
  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

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
