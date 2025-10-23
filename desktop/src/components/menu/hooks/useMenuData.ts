import { useState, useEffect, useCallback, useRef } from 'react';
import { attendanceManager } from '../../../services/AttendanceManager';
import type { AttendanceGroup, AttendanceMember } from '../../../types/recognition';

interface UseMenuDataReturn {
  selectedGroup: AttendanceGroup | null;
  groups: AttendanceGroup[];
  members: AttendanceMember[];
  loading: boolean;
  error: string | null;
  setSelectedGroup: (group: AttendanceGroup | null) => void;
  setError: (error: string | null) => void;
  fetchGroups: () => Promise<void>;
  fetchGroupDetails: (groupId: string) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
  exportData: () => Promise<void>;
}

export function useMenuData(): UseMenuDataReturn {
  const [selectedGroup, setSelectedGroup] = useState<AttendanceGroup | null>(null);
  const [groups, setGroups] = useState<AttendanceGroup[]>([]);
  const [members, setMembers] = useState<AttendanceMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const selectedGroupRef = useRef<AttendanceGroup | null>(null);

  // Fetch all groups
  const fetchGroups = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      const allGroups = await attendanceManager.getGroups();
      setGroups(allGroups);

      if (allGroups.length === 0) {
        setSelectedGroup(null);
        setMembers([]);
        return;
      }

      // Preserve existing selection if it still exists
      const existingSelection = selectedGroupRef.current;
      if (existingSelection) {
        const stillExists = allGroups.find(group => group.id === existingSelection.id);
        if (stillExists) {
          setSelectedGroup(stillExists);
        } else {
          // Group was deleted, clear selection
          setSelectedGroup(null);
          setMembers([]);
        }
      }
      // Don't auto-select first group - let user explicitly select
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load groups');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch group members
  const fetchGroupDetails = useCallback(async (groupId: string) => {
    setLoading(true);
    try {
      setError(null);
      const groupMembers = await attendanceManager.getGroupMembers(groupId);
      setMembers(groupMembers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load group data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Delete group
  const deleteGroup = useCallback(async (groupId: string) => {
    setLoading(true);
    try {
      await attendanceManager.deleteGroup(groupId);
      setSelectedGroup(null);
      await fetchGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete group');
    } finally {
      setLoading(false);
    }
  }, [fetchGroups]);

  // Export data
  const exportData = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      const data = await attendanceManager.exportData();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `attendance-data-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Sync ref with state
  useEffect(() => {
    selectedGroupRef.current = selectedGroup;
  }, [selectedGroup]);

  // Load groups on mount
  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  // Load group details when group changes
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

