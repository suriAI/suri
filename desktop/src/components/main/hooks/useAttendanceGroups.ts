import { useRef, useCallback, useEffect } from "react";
import { attendanceManager, appStore } from "../../../services";
import type {
  AttendanceGroup,
  AttendanceMember,
} from "../../../types/recognition";
import { useAttendanceStore, useUIStore } from "../stores";

export function useAttendanceGroups() {
  // Zustand stores
  const {
    currentGroup,
    setCurrentGroup,
    attendanceGroups,
    setAttendanceGroups,
    groupMembers,
    setGroupMembers,
    recentAttendance,
    setRecentAttendance,
    showGroupManagement,
    setShowGroupManagement,
    showDeleteConfirmation,
    setShowDeleteConfirmation,
    groupToDelete,
    setGroupToDelete,
    newGroupName,
    setNewGroupName,
    setAttendanceCooldownSeconds,
  } = useAttendanceStore();
  const { setError } = useUIStore();

  const currentGroupRef = useRef<AttendanceGroup | null>(null);
  const memberCacheRef = useRef<Map<string, AttendanceMember | null>>(
    new Map(),
  );
  const loadAttendanceDataRef = useRef<() => Promise<void>>(async () => {});

  // Sync ref with store
  useEffect(() => {
    currentGroupRef.current = currentGroup;
  }, [currentGroup]);

  // Enhanced setCurrentGroup that also clears cache
  const setCurrentGroupWithCache = useCallback(
    (group: AttendanceGroup | null) => {
      setCurrentGroup(group);
      memberCacheRef.current.clear();
    },
    [setCurrentGroup],
  );

  const loadSettings = useCallback(async () => {
    try {
      const settings = await attendanceManager.getSettings();
      setAttendanceCooldownSeconds(settings.attendance_cooldown_seconds ?? 10);
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  }, [setAttendanceCooldownSeconds]);

  const loadAttendanceData = useCallback(async () => {
    try {
      const currentGroupValue = currentGroupRef.current;
      const groups = await attendanceManager.getGroups();
      setAttendanceGroups(groups);

      if (!currentGroupValue) {
        return;
      }

      const groupStillExists = groups.some(
        (group) => group.id === currentGroupValue.id,
      );
      if (!groupStillExists) {
        setTimeout(() => {
          attendanceManager.getGroups().then((latestGroups) => {
            const stillMissing = !latestGroups.some(
              (group) => group.id === currentGroupValue.id,
            );
            if (stillMissing) {
              setCurrentGroupWithCache(null);
              setGroupMembers([]);
              setRecentAttendance([]);
            }
          });
        }, 100);
        return;
      }

      const [members, , records] = await Promise.all([
        attendanceManager.getGroupMembers(currentGroupValue.id),
        attendanceManager.getGroupStats(currentGroupValue.id),
        attendanceManager.getRecords({
          group_id: currentGroupValue.id,
          limit: 100,
        }),
      ]);

      setGroupMembers(members);
      setRecentAttendance(records);
    } catch (error) {
      console.error("❌ Failed to load attendance data:", error);
    }
  }, [
    setGroupMembers,
    setRecentAttendance,
    setAttendanceGroups,
    setCurrentGroupWithCache,
  ]);

  useEffect(() => {
    loadAttendanceDataRef.current = loadAttendanceData;
  }, [loadAttendanceData]);

  const handleSelectGroup = useCallback(
    async (group: AttendanceGroup) => {
      setCurrentGroupWithCache(group);

      try {
        const [members, , records] = await Promise.all([
          attendanceManager.getGroupMembers(group.id),
          attendanceManager.getGroupStats(group.id),
          attendanceManager.getRecords({
            group_id: group.id,
            limit: 100,
          }),
        ]);

        setGroupMembers(members);
        setRecentAttendance(records);
      } catch (error) {
        console.error("❌ Failed to load data for selected group:", error);
      }
    },
    [setCurrentGroupWithCache, setGroupMembers, setRecentAttendance],
  );

  const handleCreateGroup = useCallback(async () => {
    if (!newGroupName.trim()) return;

    try {
      const group = await attendanceManager.createGroup(newGroupName.trim());
      setNewGroupName("");
      setShowGroupManagement(false);
      await loadAttendanceData();

      await handleSelectGroup(group);
    } catch (error) {
      console.error("❌ Failed to create group:", error);
      setError("Failed to create group");
    }
  }, [
    newGroupName,
    loadAttendanceData,
    handleSelectGroup,
    setError,
    setNewGroupName,
    setShowGroupManagement,
  ]);

  const handleDeleteGroup = useCallback(
    (group: AttendanceGroup) => {
      setGroupToDelete(group);
      setShowDeleteConfirmation(true);
    },
    [setGroupToDelete, setShowDeleteConfirmation],
  );

  const confirmDeleteGroup = useCallback(async () => {
    if (!groupToDelete) return;

    try {
      const success = await attendanceManager.deleteGroup(groupToDelete.id);
      if (success) {
        if (currentGroup?.id === groupToDelete.id) {
          setCurrentGroupWithCache(null);
          setGroupMembers([]);
          setRecentAttendance([]);
        }

        await loadAttendanceData();
      } else {
        throw new Error("Failed to delete group");
      }
    } catch (error) {
      console.error("❌ Failed to delete group:", error);
      setError("Failed to delete group");
    } finally {
      setShowDeleteConfirmation(false);
      setGroupToDelete(null);
    }
  }, [
    groupToDelete,
    currentGroup,
    loadAttendanceData,
    setCurrentGroupWithCache,
    setError,
    setGroupMembers,
    setGroupToDelete,
    setRecentAttendance,
    setShowDeleteConfirmation,
  ]);

  const cancelDeleteGroup = useCallback(() => {
    setShowDeleteConfirmation(false);
    setGroupToDelete(null);
  }, [setGroupToDelete, setShowDeleteConfirmation]);

  // Listen for selectGroup custom event (e.g., from Settings when group is deleted)
  useEffect(() => {
    const handleSelectGroupEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{
        group: AttendanceGroup | null;
      }>;
      const { group } = customEvent.detail;
      if (group === null) {
        setCurrentGroupWithCache(null);
        setGroupMembers([]);
        setRecentAttendance([]);
        // Refresh groups list to remove deleted group from dropdown immediately
        // Call getGroups directly (don't use loadAttendanceData as it returns early when currentGroup is null)
        attendanceManager
          .getGroups()
          .then((groups) => {
            setAttendanceGroups(groups);
          })
          .catch((error) => {
            console.error(
              "[useAttendanceGroups] Error refreshing groups:",
              error,
            );
          });
      } else {
        handleSelectGroup(group);
      }
    };

    window.addEventListener(
      "selectGroup",
      handleSelectGroupEvent as EventListener,
    );
    return () => {
      window.removeEventListener(
        "selectGroup",
        handleSelectGroupEvent as EventListener,
      );
    };
  }, [
    handleSelectGroup,
    setCurrentGroupWithCache,
    setGroupMembers,
    setRecentAttendance,
    setAttendanceGroups,
  ]);

  useEffect(() => {
    const initializeAttendance = async () => {
      try {
        await loadSettings();
        const groups = await attendanceManager.getGroups();
        setAttendanceGroups(groups);

        if (groups.length === 0) {
          setCurrentGroupWithCache(null);
        } else if (!currentGroup) {
          const uiState = await appStore.getUIState();
          const savedGroupId = uiState.selectedGroupId;
          let groupToSelect = null;

          if (savedGroupId) {
            groupToSelect = groups.find((group) => group.id === savedGroupId);
          }

          if (!groupToSelect) {
            groupToSelect = groups[0];
          }

          await handleSelectGroup(groupToSelect);
        }
      } catch (error) {
        console.error("Failed to initialize attendance system:", error);
        setError("Failed to initialize attendance system");
      }
    };

    initializeAttendance().catch((error) => {
      console.error("Error in initializeAttendance:", error);
    });
  }, [
    handleSelectGroup,
    loadSettings,
    currentGroup,
    setCurrentGroupWithCache,
    setError,
    setAttendanceGroups,
  ]);

  return {
    currentGroup,
    setCurrentGroup: setCurrentGroupWithCache,
    currentGroupRef,
    memberCacheRef,
    attendanceGroups,
    setAttendanceGroups,
    groupMembers,
    setGroupMembers,
    recentAttendance,
    setRecentAttendance,
    showGroupManagement,
    setShowGroupManagement,
    showDeleteConfirmation,
    setShowDeleteConfirmation,
    groupToDelete,
    setGroupToDelete,
    newGroupName,
    setNewGroupName,
    loadSettings,
    loadAttendanceData,
    loadAttendanceDataRef,
    handleSelectGroup,
    handleCreateGroup,
    handleDeleteGroup,
    confirmDeleteGroup,
    cancelDeleteGroup,
  };
}
