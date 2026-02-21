import { useState, useEffect, useCallback, useMemo } from "react";
import { backendService, attendanceManager } from "@/services";
import { useDialog } from "@/components/shared";
import { useGroupStore, useGroupUIStore } from "@/components/group/stores";
import type { GroupSection } from "@/components/group";
import type {
  QuickSettings,
  AttendanceSettings,
  AudioSettings,
  SettingsOverview,
} from "@/components/settings/types";
import type { AttendanceGroup, AttendanceMember } from "@/types/recognition";

interface UseSettingsProps {
  initialGroupSection?: GroupSection;
  initialSection?: string;
  initialGroups: AttendanceGroup[];
  currentGroup: AttendanceGroup | null;
  onQuickSettingsChange: (settings: QuickSettings) => void;
  onAudioSettingsChange: (settings: Partial<AudioSettings>) => void;
  onAttendanceSettingsChange: (settings: Partial<AttendanceSettings>) => void;
  onGroupSelect?: (group: AttendanceGroup) => void;
  onGroupsChanged?: () => void;
  quickSettings: QuickSettings;
}

export const useSettings = ({
  initialGroupSection,
  initialSection,
  initialGroups,
  currentGroup,
  onQuickSettingsChange,
  onAudioSettingsChange,
  onAttendanceSettingsChange,
  onGroupSelect,
  onGroupsChanged,
  quickSettings,
}: UseSettingsProps) => {
  const dialog = useDialog();
  const [activeSection, setActiveSection] = useState<string>(
    initialSection || (initialGroupSection ? "group" : "attendance"),
  );
  const [groupInitialSection, setGroupInitialSection] = useState<
    GroupSection | undefined
  >(initialGroupSection);
  const [systemData, setSystemData] = useState<SettingsOverview>({
    totalPersons: 0,
    totalMembers: 0,
    lastUpdated: new Date().toISOString(),
  });
  const [groups, setGroups] = useState<AttendanceGroup[]>(initialGroups);
  const [isLoading, setIsLoading] = useState(false);
  const [members, setMembers] = useState<AttendanceMember[]>([]);
  const [triggerCreateGroup, setTriggerCreateGroup] = useState(0);
  const [deselectMemberTrigger, setDeselectMemberTrigger] = useState(0);
  const [hasSelectedMember, setHasSelectedMember] = useState(false);
  const [reportsExportHandlers, setReportsExportHandlers] = useState<{
    exportCSV: () => void;
    print: () => void;
  } | null>(null);
  const [addMemberHandler, setAddMemberHandler] = useState<(() => void) | null>(
    null,
  );
  const [isGroupExpanded, setIsGroupExpanded] = useState(true);

  // Store access
  const storeGroups = useGroupStore((state) => state.groups);
  const storeSelectedGroup = useGroupStore((state) => state.selectedGroup);
  const storeMembers = useGroupStore((state) => state.members);
  const fetchGroups = useGroupStore((state) => state.fetchGroups);
  const fetchGroupDetails = useGroupStore((state) => state.fetchGroupDetails);
  const registrationSource = useGroupUIStore(
    (state) => state.lastRegistrationSource,
  );
  const registrationMode = useGroupUIStore(
    (state) => state.lastRegistrationMode,
  );
  const setRegistrationState = useGroupUIStore(
    (state) => state.setRegistrationState,
  );

  const toggleQuickSetting = (key: keyof QuickSettings) => {
    const newSettings = { ...quickSettings, [key]: !quickSettings[key] };
    onQuickSettingsChange(newSettings);
  };

  const updateAudioSetting = (updates: Partial<AudioSettings>) => {
    onAudioSettingsChange(updates);
  };

  const updateAttendanceSetting = (updates: Partial<AttendanceSettings>) => {
    onAttendanceSettingsChange(updates);
  };

  const loadSystemData = useCallback(async () => {
    try {
      const [faceStats, attendanceStats, groupsData] = await Promise.all([
        backendService.getDatabaseStats(),
        attendanceManager.getAttendanceStats(),
        attendanceManager.getGroups(),
      ]);
      setSystemData({
        totalPersons: faceStats.total_persons,
        totalMembers: attendanceStats.total_members,
        lastUpdated: new Date().toISOString(),
      });
      setGroups(groupsData);
    } catch (error) {
      console.error("Failed to load system data:", error);
    }
  }, []);

  useEffect(() => {
    loadSystemData();
  }, [loadSystemData]);

  useEffect(() => {
    setGroups(initialGroups);
  }, [initialGroups]);

  useEffect(() => {
    if (currentGroup) {
      const groupExists = groups.some((g) => g.id === currentGroup.id);
      if (!groupExists) {
        window.dispatchEvent(
          new CustomEvent("selectGroup", {
            detail: { group: null },
          }),
        );
      }
    }
  }, [currentGroup, groups]);

  useEffect(() => {
    if (currentGroup) {
      if (storeSelectedGroup?.id === currentGroup.id) {
        setMembers(storeMembers);
      } else {
        const fetchMembers = async () => {
          try {
            const groupMembers = await attendanceManager.getGroupMembers(
              currentGroup.id,
            );
            setMembers(groupMembers);
          } catch (error) {
            console.error("Failed to load members:", error);
            setMembers([]);
          }
        };
        fetchMembers();
      }
    } else {
      setMembers([]);
    }
  }, [currentGroup, storeMembers, storeSelectedGroup]);

  useEffect(() => {
    if (
      activeSection === "group" &&
      (groupInitialSection === "registration" ||
        groupInitialSection === "members") &&
      currentGroup
    ) {
      if (storeSelectedGroup?.id === currentGroup.id) {
        fetchGroupDetails(currentGroup.id);
      } else {
        const fetchMembers = async () => {
          try {
            const groupMembers = await attendanceManager.getGroupMembers(
              currentGroup.id,
            );
            setMembers(groupMembers);
          } catch (error) {
            console.error("Failed to load members:", error);
            setMembers([]);
          }
        };
        fetchMembers();
      }
    }
  }, [
    activeSection,
    groupInitialSection,
    currentGroup,
    storeSelectedGroup,
    fetchGroupDetails,
  ]);

  useEffect(() => {
    if (activeSection !== "group" || groupInitialSection !== "reports") {
      setReportsExportHandlers(null);
    }
  }, [activeSection, groupInitialSection]);

  useEffect(() => {
    if (!currentGroup) {
      setAddMemberHandler(null);
    }
  }, [currentGroup]);

  const handleClearDatabase = async () => {
    const ok = await dialog.confirm({
      title: "Clear all face data",
      message:
        "Clear ALL face recognition data? This will delete all registered faces and embeddings. This cannot be undone.",
      confirmText: "Clear data",
      cancelText: "Cancel",
      confirmVariant: "danger",
    });
    if (!ok) return;
    setIsLoading(true);
    try {
      await backendService.clearDatabase();
      await loadSystemData();
      await dialog.alert({
        title: "Database cleared",
        message: "Face recognition data cleared successfully.",
      });
    } catch (error) {
      console.error("Failed to clear database:", error);
      await dialog.alert({
        title: "Clear failed",
        message: "Failed to clear face recognition data. Please try again.",
        variant: "danger",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const storeGroupsIds = useMemo(
    () => new Set(storeGroups.map((g) => g.id)),
    [storeGroups],
  );

  const [storeGroupsLoaded, setStoreGroupsLoaded] = useState(false);

  useEffect(() => {
    if (storeGroups.length === 0 && !storeGroupsLoaded) {
      fetchGroups().then(() => {
        setStoreGroupsLoaded(true);
      });
    } else if (storeGroups.length > 0) {
      setStoreGroupsLoaded(true);
    }
  }, [storeGroups.length, storeGroupsLoaded, fetchGroups]);

  const dropdownGroups = storeGroupsLoaded ? storeGroups : groups;

  const validInitialGroup = useMemo(() => {
    if (!currentGroup) return null;
    const groupsToCheck = storeGroupsLoaded ? storeGroups : groups;
    return groupsToCheck.some((g) => g.id === currentGroup.id)
      ? currentGroup
      : null;
  }, [currentGroup, storeGroups, storeGroupsLoaded, groups]);

  useEffect(() => {
    const groupStore = useGroupStore.getState();
    const currentGroups = groupStore.groups;

    if (validInitialGroup) {
      const stillExists = currentGroups.some(
        (g) => g.id === validInitialGroup.id,
      );
      if (stillExists && storeSelectedGroup?.id !== validInitialGroup.id) {
        groupStore.setSelectedGroup(validInitialGroup);
        fetchGroupDetails(validInitialGroup.id);
      }
    } else if (storeSelectedGroup && storeGroupsLoaded) {
      const exists = currentGroups.some((g) => g.id === storeSelectedGroup.id);
      if (!exists) {
        groupStore.setSelectedGroup(null);
      }
    }
  }, [
    validInitialGroup,
    storeSelectedGroup,
    storeGroupsLoaded,
    fetchGroupDetails,
  ]);

  const handleGroupBack = useCallback(() => {
    setActiveSection("attendance");
  }, []);

  const handleExportHandlersReady = useCallback(
    (handlers: { exportCSV: () => void; print: () => void }) => {
      setReportsExportHandlers(handlers);
    },
    [],
  );

  const handleAddMemberHandlerReady = useCallback((handler: () => void) => {
    setAddMemberHandler(() => handler);
  }, []);

  const handleGroupsChangedInternal = useCallback(
    async (newGroup?: AttendanceGroup) => {
      try {
        const groupStore = useGroupStore.getState();
        await groupStore.fetchGroups();
        const updatedGroups = groupStore.groups;
        setStoreGroupsLoaded(true);
        setGroups(updatedGroups);

        if (
          currentGroup &&
          !updatedGroups.some((g) => g.id === currentGroup.id)
        ) {
          groupStore.setSelectedGroup(null);
          groupStore.setMembers([]);
          window.dispatchEvent(
            new CustomEvent("selectGroup", {
              detail: { group: null },
            }),
          );
        }
      } catch (error) {
        console.error("[Settings] Error updating groups:", error);
      }

      await loadSystemData();

      if (onGroupsChanged) {
        onGroupsChanged();
      }
      if (newGroup && onGroupSelect) {
        onGroupSelect(newGroup);
        if (
          groupInitialSection === "registration" ||
          groupInitialSection === "members"
        ) {
          try {
            await fetchGroupDetails(newGroup.id);
          } catch (error) {
            console.error("Failed to refresh members:", error);
          }
        }
      } else if (
        (groupInitialSection === "registration" ||
          groupInitialSection === "members") &&
        currentGroup
      ) {
        try {
          await fetchGroupDetails(currentGroup.id);
        } catch (error) {
          console.error("Failed to refresh members:", error);
        }
      }
    },
    [
      currentGroup,
      groupInitialSection,
      loadSystemData,
      onGroupsChanged,
      onGroupSelect,
      fetchGroupDetails,
    ],
  );

  const dropdownValue = useMemo(() => {
    if (storeSelectedGroup) {
      const existsInStore =
        storeGroups.length > 0 && storeGroupsIds.has(storeSelectedGroup.id);
      const existsInLocal = groups.some((g) => g.id === storeSelectedGroup.id);

      if (existsInStore || (storeGroups.length === 0 && existsInLocal)) {
        return storeSelectedGroup.id;
      }
    }
    if (validInitialGroup) {
      return validInitialGroup.id;
    }
    return null;
  }, [
    storeSelectedGroup,
    storeGroupsIds,
    storeGroups.length,
    groups,
    validInitialGroup,
  ]);

  return {
    activeSection,
    setActiveSection,
    groupInitialSection,
    setGroupInitialSection,
    systemData,
    groups,
    isLoading,
    members,
    triggerCreateGroup,
    setTriggerCreateGroup,
    deselectMemberTrigger,
    setDeselectMemberTrigger,
    hasSelectedMember,
    setHasSelectedMember,
    reportsExportHandlers,
    addMemberHandler,
    isGroupExpanded,
    setIsGroupExpanded,
    registrationSource,
    registrationMode,
    setRegistrationState,
    toggleQuickSetting,
    updateAudioSetting,
    updateAttendanceSetting,
    handleClearDatabase,
    handleGroupBack,
    handleExportHandlersReady,
    handleAddMemberHandlerReady,
    handleGroupsChanged: handleGroupsChangedInternal,
    dropdownGroups,
    dropdownValue,
    storeGroups,
    loadSystemData,
  };
};
