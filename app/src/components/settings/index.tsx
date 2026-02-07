import { useState, useEffect, useCallback, useMemo } from "react";
import { backendService, attendanceManager } from "@/services";
import { Display } from "@/components/settings/sections/Display";
import { Notifications } from "@/components/settings/sections/Notifications";
import { Database } from "@/components/settings/sections/Database";
import { Attendance } from "@/components/settings/sections/Attendance";
import { About } from "@/components/settings/sections/About";
import { GroupPanel, type GroupSection } from "@/components/group";
import { Dropdown } from "@/components/shared";
import { useDialog } from "@/components/shared";
import { useGroupStore, useGroupUIStore } from "@/components/group/stores";
import type {
  QuickSettings,
  AttendanceSettings,
  AudioSettings,
  SettingsOverview,
} from "@/components/settings/types";
import type { AttendanceGroup, AttendanceMember } from "@/types/recognition";

export type { QuickSettings, AttendanceSettings };
export type { AudioSettings } from "@/components/settings/types";

interface SettingsProps {
  onBack: () => void;
  isModal?: boolean;
  isFullScreen?: boolean;
  onToggleFullScreen?: () => void;
  quickSettings: QuickSettings;
  onQuickSettingsChange: (settings: QuickSettings) => void;
  audioSettings: AudioSettings;
  onAudioSettingsChange: (settings: Partial<AudioSettings>) => void;
  attendanceSettings: AttendanceSettings;
  onAttendanceSettingsChange: (settings: Partial<AttendanceSettings>) => void;
  isStreaming?: boolean;
  // Group Panel props
  initialGroupSection?: GroupSection;
  currentGroup?: AttendanceGroup | null;
  onGroupSelect?: (group: AttendanceGroup) => void;
  onGroupsChanged?: () => void;
  // Pre-loaded data to avoid refetching
  initialGroups?: AttendanceGroup[];
  // Initial main section (e.g., 'about', 'attendance', 'display', 'database')
  initialSection?: string;
}

export const Settings: React.FC<SettingsProps> = ({
  onBack,
  isModal = false,
  isFullScreen = false,
  onToggleFullScreen,
  quickSettings,
  onQuickSettingsChange,
  audioSettings,
  onAudioSettingsChange,
  attendanceSettings,
  onAttendanceSettingsChange,
  isStreaming = false,
  initialGroupSection,
  currentGroup,
  onGroupSelect,
  onGroupsChanged,
  initialGroups = [],
  initialSection,
}) => {
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
  const registrationSource = useGroupUIStore(
    (state) => state.lastRegistrationSource,
  );
  const registrationMode = useGroupUIStore(
    (state) => state.lastRegistrationMode,
  );
  const setRegistrationState = useGroupUIStore(
    (state) => state.setRegistrationState,
  );
  const [deselectMemberTrigger, setDeselectMemberTrigger] = useState(0);
  const [hasSelectedMember, setHasSelectedMember] = useState(false);
  const [reportsExportHandlers, setReportsExportHandlers] = useState<{
    exportCSV: () => void;
    print: () => void;
  } | null>(null);
  const [addMemberHandler, setAddMemberHandler] = useState<(() => void) | null>(
    null,
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
    // Load stats in the background without blocking UI
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
      // Always update groups to reflect current state
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

  // Clear currentGroup if it no longer exists in groups list (e.g., after deletion)
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

  // Get groups and members from store to ensure we have the latest state
  const storeGroups = useGroupStore((state) => state.groups);
  const storeSelectedGroup = useGroupStore((state) => state.selectedGroup);
  const storeMembers = useGroupStore((state) => state.members);
  const fetchGroups = useGroupStore((state) => state.fetchGroups);
  const fetchGroupDetails = useGroupStore((state) => state.fetchGroupDetails);

  // Sync members from store when currentGroup changes or store members update
  useEffect(() => {
    if (currentGroup) {
      // If store's selected group matches currentGroup, use store members
      // This ensures we get updates when members are added/removed via the store
      if (storeSelectedGroup?.id === currentGroup.id) {
        setMembers(storeMembers);
      } else {
        // Fetch members directly if store doesn't have them for this group
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

  // Also fetch members when showing registration or members section to ensure fresh data
  useEffect(() => {
    if (
      activeSection === "group" &&
      (groupInitialSection === "registration" ||
        groupInitialSection === "members") &&
      currentGroup
    ) {
      // Refresh members from store or fetch if needed
      if (storeSelectedGroup?.id === currentGroup.id) {
        // If store has the group selected, refresh from store
        fetchGroupDetails(currentGroup.id);
      } else {
        // Otherwise fetch directly
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

  // Reset reports state when switching away from reports section
  useEffect(() => {
    if (activeSection !== "group" || groupInitialSection !== "reports") {
      setReportsExportHandlers(null);
    }
  }, [activeSection, groupInitialSection]);

  // Keep add member handler available as long as there's a currentGroup
  // Only clear it when there's no group (not based on members count)
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

  // Group subsections state
  const [isGroupExpanded, setIsGroupExpanded] = useState(true);

  const groupSections = [
    { id: "overview", label: "Overview", icon: "fa-solid fa-chart-line" },
    { id: "reports", label: "Reports", icon: "fa-solid fa-chart-bar" },
    { id: "members", label: "Members", icon: "fa-solid fa-users" },
    { id: "registration", label: "Registration", icon: "fa-solid fa-id-card" },
    { id: "settings", label: "Configuration", icon: "fa-solid fa-sliders" },
  ];

  const sections = [
    { id: "attendance", label: "Attendance", icon: "fa-solid fa-user-check" },
    { id: "display", label: "Display", icon: "fa-solid fa-desktop" },
    { id: "notifications", label: "Notifications", icon: "fa-solid fa-bell" },
    { id: "database", label: "Database", icon: "fa-solid fa-database" },
    { id: "about", label: "About", icon: "fa-solid fa-circle-info" },
  ];

  // Use a selector that only updates when the groups list actually changes (by IDs)
  const storeGroupsIds = useMemo(
    () => new Set(storeGroups.map((g) => g.id)),
    [storeGroups],
  );

  // Track if store groups have been loaded at least once
  const [storeGroupsLoaded, setStoreGroupsLoaded] = useState(false);

  // Ensure store has groups loaded when Settings opens
  useEffect(() => {
    // If store groups are empty and haven't been loaded yet, fetch them
    if (storeGroups.length === 0 && !storeGroupsLoaded) {
      fetchGroups().then(() => {
        setStoreGroupsLoaded(true);
      });
    } else if (storeGroups.length > 0) {
      // Mark as loaded once we have groups
      setStoreGroupsLoaded(true);
    }
  }, [storeGroups.length, storeGroupsLoaded, fetchGroups]);

  // Use storeGroups as source of truth if loaded, otherwise fallback to local groups state
  // This ensures deleted groups are immediately removed from dropdown
  const dropdownGroups = storeGroupsLoaded ? storeGroups : groups;

  // Only pass currentGroup if it exists in groups (prevents passing deleted groups)
  const validInitialGroup = useMemo(() => {
    if (!currentGroup) return null;

    // Use store groups if loaded, otherwise fallback to local groups
    const groupsToCheck = storeGroupsLoaded ? storeGroups : groups;
    return groupsToCheck.some((g) => g.id === currentGroup.id)
      ? currentGroup
      : null;
  }, [currentGroup, storeGroups, storeGroupsLoaded, groups]);

  // Sync store's selectedGroup with currentGroup when Settings opens
  useEffect(() => {
    const groupStore = useGroupStore.getState();
    const currentGroups = groupStore.groups;

    if (validInitialGroup) {
      // Sync if group exists and is different from store's selection
      const stillExists = currentGroups.some(
        (g) => g.id === validInitialGroup.id,
      );
      if (stillExists && storeSelectedGroup?.id !== validInitialGroup.id) {
        groupStore.setSelectedGroup(validInitialGroup);
        // Also fetch members for the synced group
        fetchGroupDetails(validInitialGroup.id);
      }
    } else if (storeSelectedGroup && storeGroupsLoaded) {
      // Clear selection if group was deleted
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

  // Memoize callbacks to prevent unnecessary re-renders of GroupPanel
  const handleGroupBack = useCallback(() => {
    setActiveSection("attendance");
  }, [setActiveSection]);

  const handleExportHandlersReady = useCallback(
    (handlers: { exportCSV: () => void; print: () => void }) => {
      setReportsExportHandlers(handlers);
    },
    [],
  );

  const handleAddMemberHandlerReady = useCallback((handler: () => void) => {
    setAddMemberHandler(() => handler);
  }, []);

  const handleGroupsChanged = useCallback(
    async (newGroup?: AttendanceGroup) => {
      // Update group store FIRST (this is the source of truth)
      try {
        const groupStore = useGroupStore.getState();
        await groupStore.fetchGroups();
        const updatedGroups = groupStore.groups;

        // Mark store as loaded (so dropdown uses store groups)
        setStoreGroupsLoaded(true);

        // Sync local groups state with store (for fallback scenarios)
        setGroups(updatedGroups);

        // Check if currentGroup was deleted and clear it IMMEDIATELY
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

      // Then reload system data
      await loadSystemData();

      if (onGroupsChanged) {
        onGroupsChanged();
      }
      // If a new group was created, automatically select it
      if (newGroup && onGroupSelect) {
        onGroupSelect(newGroup);
        // Refresh members from store if showing registration or members section with the new group
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
        // Refresh members from store if showing registration or members section with current group
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

  // Use store's selectedGroup as the dropdown value (most up-to-date)
  // This ensures the dropdown updates immediately when a group is selected
  const dropdownValue = useMemo(() => {
    // Priority 1: If store has a selectedGroup and it exists in groups, use it
    if (storeSelectedGroup) {
      // Check if it exists in store groups (if available) or local groups (fallback)
      const existsInStore =
        storeGroups.length > 0 && storeGroupsIds.has(storeSelectedGroup.id);
      const existsInLocal = groups.some((g) => g.id === storeSelectedGroup.id);

      if (existsInStore || (storeGroups.length === 0 && existsInLocal)) {
        return storeSelectedGroup.id;
      }
    }
    // Priority 2: If currentGroup (from parent) exists and is valid, use it
    // This handles the case when a group is created from main and Settings is opened
    // validInitialGroup already validates that currentGroup exists in groups
    if (validInitialGroup) {
      return validInitialGroup.id;
    }
    // Otherwise, return null (show placeholder)
    return null;
  }, [
    storeSelectedGroup,
    storeGroupsIds,
    storeGroups.length,
    groups,
    validInitialGroup,
  ]);

  const mainContent = (
    <div className="h-full flex bg-[#0f0f0f] text-white">
      {/* Sidebar Navigation */}
      <div className="w-56 flex-shrink-0 border-r border-white/10 flex flex-col">
        {/* Header */}
        <div className="px-4 py-4 border-b border-white/10 flex items-center justify-between">
          <h1 className="text-sm font-semibold uppercase tracking-wider text-white">
            Settings
          </h1>
          {onToggleFullScreen && (
            <button
              onClick={onToggleFullScreen}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/5 text-white/60 hover:text-white/80 transition-all"
              title={isFullScreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              <i
                className={`fa-solid ${isFullScreen ? "fa-compress" : "fa-expand"} text-xs`}
              ></i>
            </button>
          )}
        </div>

        {/* Group Selector - Top Context Switcher (Discord/Slack Pattern) */}
        <div className="px-3 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0" key={storeGroups.length}>
              <Dropdown
                options={dropdownGroups.map((group) => ({
                  value: group.id,
                  label: group.name,
                }))}
                value={dropdownValue}
                onChange={(groupId) => {
                  // Update store immediately for visual feedback
                  const groupStore = useGroupStore.getState();

                  if (groupId) {
                    const group = dropdownGroups.find((g) => g.id === groupId);
                    if (group) {
                      // Update store immediately
                      groupStore.setSelectedGroup(group);
                      // Then notify parent
                      if (onGroupSelect) {
                        onGroupSelect(group);
                      }
                    }
                  } else {
                    // Clear store immediately
                    groupStore.setSelectedGroup(null);
                    // Then notify parent
                    if (onGroupSelect) {
                      window.dispatchEvent(
                        new CustomEvent("selectGroup", {
                          detail: { group: null },
                        }),
                      );
                    }
                  }
                }}
                placeholder="Select group…"
                emptyMessage="No groups available"
                maxHeight={256}
                allowClear={dropdownGroups.length === 0}
                showPlaceholderOption={dropdownGroups.length === 0}
              />
            </div>
            {/* Create Group Button - Opens Group section with create modal */}
            <button
              onClick={() => {
                setActiveSection("group");
                // Preserve current section if already in group section, otherwise default to overview
                if (activeSection !== "group" || !groupInitialSection) {
                  setGroupInitialSection("overview");
                }
                setIsGroupExpanded(true);
                // Use timestamp to ensure trigger always changes
                setTriggerCreateGroup(Date.now());
              }}
              className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-md bg-white/5 hover:bg-white/10 border border-white/10 transition-all text-white/70 hover:text-white"
              title="Create new group"
              aria-label="Create new group"
            >
              <i className="fa-solid fa-plus text-sm"></i>
            </button>
          </div>
        </div>

        {/* Navigation Items */}
        <div className="flex-1 p-2 space-y-0.5 overflow-y-auto custom-scroll">
          {/* Group Section - Expandable with Subsections */}
          <div className="mb-1">
            <button
              onClick={() => setIsGroupExpanded(!isGroupExpanded)}
              className="w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-all flex items-center justify-between text-white/60 hover:bg-white/5 hover:text-white/80"
            >
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-users-rectangle text-sm w-4"></i>
                <span>Group</span>
              </div>
              <i
                className={`fa-solid fa-chevron-down text-xs transition-transform duration-200 ${isGroupExpanded ? "" : "-rotate-90"
                  }`}
              ></i>
            </button>

            {/* Group Subsections */}
            {isGroupExpanded && (
              <div className="mt-1 ml-3 pl-3 border-l-2 border-white/[0.06] space-y-0.5">
                {groupSections.map((subsection) => (
                  <button
                    key={subsection.id}
                    onClick={() => {
                      setActiveSection("group");
                      setGroupInitialSection(subsection.id as GroupSection);
                      // Reset trigger when switching subsections to prevent accidental modal opening
                      setTriggerCreateGroup(0);
                      // Reset registration state when navigating to registration via sidebar
                      // This ensures we start at the root (source selection) without Back button
                      if (subsection.id === "registration") {
                        setRegistrationState(null, null);
                        useGroupUIStore.setState({ preSelectedMemberId: null });
                      }
                    }}
                    className={`w-full text-left px-3 py-2 rounded-md text-xs font-medium transition-all flex items-center gap-2 ${activeSection === "group" &&
                      groupInitialSection === subsection.id
                      ? "bg-white/10 text-white"
                      : "text-white/50 hover:bg-white/5 hover:text-white/70"
                      }`}
                  >
                    <i className={`${subsection.icon} text-xs w-4`}></i>
                    {subsection.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Other Sections */}
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${activeSection === section.id
                ? "bg-white/10 text-white"
                : "text-white/60 hover:bg-white/5 hover:text-white/80"
                }`}
            >
              {section.icon && (
                <i className={`${section.icon} text-sm w-4`}></i>
              )}
              {section.label}
            </button>
          ))}
        </div>

        {/* Close Button at Bottom */}
        <div className="p-2 border-t border-white/10">
          <button
            onClick={onBack}
            className="w-full px-3 py-2 rounded-md text-sm font-medium text-white/60 hover:bg-white/5 hover:text-white/80 transition-all text-center flex items-center justify-center gap-2"
          >
            Close
          </button>
        </div>
      </div>

      {/* Content Panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Section Header */}
        <div className="px-8 py-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center">
              {activeSection === "group" ? (
                <>
                  Group{" "}
                  <span className="text-sm text-white/60 ml-1">
                    (
                    {groupSections.find((s) => s.id === groupInitialSection)
                      ?.label || "Overview"}
                    )
                  </span>
                </>
              ) : (
                sections.find((s) => s.id === activeSection)?.label
              )}
            </h2>
            {activeSection === "group" &&
              groupInitialSection === "members" &&
              currentGroup &&
              addMemberHandler &&
              members.length > 0 && (
                <button
                  onClick={addMemberHandler}
                  className="px-4 py-2 text-xs bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.1] rounded text-white/70 hover:text-white/90 transition-colors flex items-center gap-2"
                >
                  <i className="fa-solid fa-user-plus text-xs"></i>
                  Add Member
                </button>
              )}
            {activeSection === "group" &&
              groupInitialSection === "reports" &&
              reportsExportHandlers && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={reportsExportHandlers.exportCSV}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 hover:text-cyan-300 transition-all text-[11px] font-bold uppercase tracking-wider"
                  >
                    <i className="fa-solid fa-file-csv text-[10px]"></i>
                    Export CSV
                  </button>
                  <button
                    onClick={reportsExportHandlers.print}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/50 hover:bg-white/10 hover:text-white transition-all text-[11px] font-bold uppercase tracking-wider"
                  >
                    <i className="fa-solid fa-print text-[10px]"></i>
                    Print
                  </button>
                </div>
              )}
            {activeSection === "group" &&
              groupInitialSection === "registration" &&
              (registrationSource || registrationMode) && (
                <button
                  onClick={() => {
                    // If in FaceCapture (single mode) and a member is selected, deselect member first
                    if (registrationMode === "single" && hasSelectedMember) {
                      setDeselectMemberTrigger(Date.now());
                      return;
                    }

                    if (registrationMode) {
                      // If in a mode (Individual/Batch/Queue), go back to mode selection
                      setRegistrationState(registrationSource, null);
                    } else if (registrationSource) {
                      // If in mode selection, go back to source selection
                      // Also clear preSelectedMemberId to prevent Registration from re-setting source/mode
                      setRegistrationState(null, null);
                      useGroupUIStore.setState({ preSelectedMemberId: null });
                    }
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/50 hover:bg-white/10 hover:text-white transition-all text-[11px] font-bold uppercase tracking-wider"
                >
                  <i className="fa-solid fa-arrow-left text-[10px]"></i>
                  Back
                </button>
              )}
          </div>
        </div>

        {/* Section Content */}
        <div className="flex-1 overflow-y-auto custom-scroll">
          {activeSection === "group" && (
            <div className="h-full w-full">
              <GroupPanel
                onBack={handleGroupBack}
                initialSection={groupInitialSection}
                initialGroup={validInitialGroup}
                triggerCreateGroup={triggerCreateGroup}
                // Store integration for registration source and mode
                onRegistrationSourceChange={(source) =>
                  setRegistrationState(source, null)
                }
                registrationSource={registrationSource}
                onRegistrationModeChange={(mode) =>
                  setRegistrationState(registrationSource, mode)
                }
                registrationMode={registrationMode}
                deselectMemberTrigger={deselectMemberTrigger}
                onHasSelectedMemberChange={setHasSelectedMember}
                onExportHandlersReady={handleExportHandlersReady}
                onAddMemberHandlerReady={handleAddMemberHandlerReady}
                onGroupsChanged={handleGroupsChanged}
                onSectionChange={setGroupInitialSection}
                isEmbedded={true}
              />
            </div>
          )}
          {activeSection === "display" && (
            <Display
              quickSettings={quickSettings}
              toggleQuickSetting={toggleQuickSetting}
            />
          )}
          {activeSection === "notifications" && (
            <Notifications
              audioSettings={audioSettings}
              onAudioSettingsChange={updateAudioSetting}
            />
          )}
          {activeSection === "attendance" && (
            <Attendance
              attendanceSettings={attendanceSettings}
              onLateThresholdChange={(minutes) =>
                updateAttendanceSetting({ lateThresholdMinutes: minutes })
              }
              onLateThresholdToggle={(enabled) =>
                updateAttendanceSetting({ lateThresholdEnabled: enabled })
              }
              onReLogCooldownChange={(seconds) =>
                updateAttendanceSetting({ reLogCooldownSeconds: seconds })
              }
              onSpoofDetectionToggle={(enabled) =>
                updateAttendanceSetting({ enableSpoofDetection: enabled })
              }
              isStreaming={isStreaming}
            />
          )}
          {activeSection === "database" && (
            <Database
              systemData={systemData}
              groups={groups}
              isLoading={isLoading}
              onClearDatabase={handleClearDatabase}
              onGroupsChanged={() => {
                loadSystemData();
                if (onGroupsChanged) onGroupsChanged();
              }}
            />
          )}
          {activeSection === "about" && <About />}
        </div>
      </div>
    </div>
  );

  if (isModal) {
    // Header height: 46px, Footer height: 28px (h-7)
    // We position the settings modal/fullscreen container between header and footer
    // to prevent overflow and ensure window controls remain accessible.
    // z-[60] ensures it sits above the Sidebar (z-50) but allows interaction with window controls
    const safeAreaClass =
      "fixed top-[46px] bottom-[28px] left-0 right-0 z-[60]";

    if (isFullScreen) {
      return (
        <div className={`${safeAreaClass} bg-[#0f0f0f] overflow-hidden`}>
          {mainContent}
        </div>
      );
    }

    return (
      <div
        className={`${safeAreaClass} bg-black/70 flex items-center justify-center`}
      >
        <div className="bg-[#0f0f0f] border border-white/10 rounded-2xl w-full max-w-5xl h-[90%] shadow-[0_40px_80px_rgba(0,0,0,0.6)] overflow-hidden">
          {mainContent}
        </div>
      </div>
    );
  }

  return mainContent;
};
