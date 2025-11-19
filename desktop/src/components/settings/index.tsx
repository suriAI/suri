import { useState, useEffect, useCallback } from "react";
import { backendService, attendanceManager } from "../../services";
import { Display } from "./sections/Display";
import { Database } from "./sections/Database";
import { Attendance } from "./sections/Attendance";
import { GroupPanel, type GroupSection } from "../group";
import { Dropdown } from "../shared";
import type {
  QuickSettings,
  AttendanceSettings,
  SettingsOverview,
} from "./types";
import type {
  AttendanceGroup,
  AttendanceMember,
} from "../../types/recognition";

export type { QuickSettings, AttendanceSettings };

interface SettingsProps {
  onBack: () => void;
  isModal?: boolean;
  isFullScreen?: boolean;
  onToggleFullScreen?: () => void;
  quickSettings: QuickSettings;
  onQuickSettingsChange: (settings: QuickSettings) => void;
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
}

export const Settings: React.FC<SettingsProps> = ({
  onBack,
  isModal = false,
  isFullScreen = false,
  onToggleFullScreen,
  quickSettings,
  onQuickSettingsChange,
  attendanceSettings,
  onAttendanceSettingsChange,
  isStreaming = false,
  initialGroupSection,
  currentGroup,
  onGroupSelect,
  onGroupsChanged,
  initialGroups = [],
}) => {
  const [activeSection, setActiveSection] = useState<string>(
    initialGroupSection ? "group" : "attendance",
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
  const [registrationSource, setRegistrationSource] = useState<
    "upload" | "camera" | null
  >(null);
  const [registrationMode, setRegistrationMode] = useState<
    "single" | "bulk" | "queue" | null
  >(null);
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

  // Fetch members when showing registration or members section
  useEffect(() => {
    const fetchMembers = async () => {
      if (
        activeSection === "group" &&
        (groupInitialSection === "registration" ||
          groupInitialSection === "members") &&
        currentGroup
      ) {
        try {
          const groupMembers = await attendanceManager.getGroupMembers(
            currentGroup.id,
          );
          setMembers(groupMembers);
        } catch (error) {
          console.error("Failed to load members:", error);
          setMembers([]);
        }
      } else {
        setMembers([]);
      }
    };

    fetchMembers();
  }, [activeSection, groupInitialSection, currentGroup]);

  // Reset reports state when switching away from reports section
  useEffect(() => {
    if (activeSection !== "group" || groupInitialSection !== "reports") {
      setReportsExportHandlers(null);
    }
  }, [activeSection, groupInitialSection]);

  // Reset add member handler when switching away from members section
  useEffect(() => {
    if (activeSection !== "group" || groupInitialSection !== "members") {
      setAddMemberHandler(null);
    }
  }, [activeSection, groupInitialSection]);

  const handleClearDatabase = async () => {
    if (
      !window.confirm(
        "⚠️ Clear ALL face recognition data? This will delete all registered faces and embeddings. This cannot be undone.",
      )
    )
      return;
    setIsLoading(true);
    try {
      await backendService.clearDatabase();
      await loadSystemData();
      alert("✓ Database cleared successfully");
    } catch (error) {
      console.error("Failed to clear database:", error);
      alert("❌ Failed to clear database");
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
    { id: "database", label: "Database", icon: "fa-solid fa-database" },
  ];

  const mainContent = (
    <div className="h-full flex bg-[#0f0f0f] text-white">
      {/* Sidebar Navigation */}
      <div className="w-56 flex-shrink-0 border-r border-white/10 flex flex-col">
        {/* Header */}
        <div className="px-4 py-4 border-b border-white/10 flex items-center justify-between">
          <h1 className="text-sm font-semibold uppercase tracking-wider text-white/60">
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
            <div className="flex-1">
              <Dropdown
                options={groups.map((group) => ({
                  value: group.id,
                  label: group.name,
                }))}
                value={currentGroup?.id ?? null}
                onChange={(groupId) => {
                  if (groupId && onGroupSelect) {
                    const group = groups.find((g) => g.id === groupId);
                    if (group) {
                      onGroupSelect(group);
                    }
                  } else if (!groupId && onGroupSelect) {
                    window.dispatchEvent(
                      new CustomEvent("selectGroup", {
                        detail: { group: null },
                      }),
                    );
                  }
                }}
                placeholder="Select group…"
                emptyMessage="No groups available"
                maxHeight={256}
                allowClear={groups.length === 0}
                showPlaceholderOption={groups.length === 0}
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
                className={`fa-solid fa-chevron-down text-xs transition-transform duration-200 ${isGroupExpanded ? "" : "-rotate-90"}`}
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
                    }}
                    className={`w-full text-left px-3 py-2 rounded-md text-xs font-medium transition-all flex items-center gap-2 ${
                      activeSection === "group" &&
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
              className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                activeSection === section.id
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
                    className="btn-success text-xs px-2 py-1 disabled:opacity-50"
                  >
                    Export CSV (current view)
                  </button>
                  <button
                    onClick={reportsExportHandlers.print}
                    className="text-xs px-2 py-1 border border-white/20 rounded hover:bg-white/10"
                  >
                    Print
                  </button>
                </div>
              )}
            {activeSection === "group" &&
              groupInitialSection === "registration" &&
              registrationSource && (
                <button
                  onClick={() => {
                    // If in FaceCapture (single mode) and a member is selected, deselect member first
                    if (registrationMode === "single" && hasSelectedMember) {
                      setDeselectMemberTrigger(Date.now());
                      return;
                    }
                    if (registrationMode) {
                      // If in a mode (Individual/Batch/Queue), go back to mode selection
                      setRegistrationMode(null);
                    } else {
                      // If in mode selection, go back to source selection
                      setRegistrationSource(null);
                    }
                  }}
                  className="flex items-center gap-2 text-white/60 hover:text-white/80 transition-colors text-sm"
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
                      strokeWidth={2}
                      d="M15 19l-7-7 7-7"
                    />
                  </svg>
                  <span>Back</span>
                </button>
              )}
          </div>
        </div>

        {/* Section Content */}
        <div className="flex-1 overflow-y-auto custom-scroll">
          {activeSection === "group" && (
            <div className="h-full w-full">
              <GroupPanel
                onBack={() => setActiveSection("attendance")}
                initialSection={groupInitialSection}
                initialGroup={currentGroup}
                triggerCreateGroup={triggerCreateGroup}
                onRegistrationSourceChange={setRegistrationSource}
                registrationSource={registrationSource}
                onRegistrationModeChange={setRegistrationMode}
                registrationMode={registrationMode}
                deselectMemberTrigger={deselectMemberTrigger}
                onHasSelectedMemberChange={setHasSelectedMember}
                onExportHandlersReady={(handlers) => {
                  setReportsExportHandlers(handlers);
                }}
                onAddMemberHandlerReady={(handler) => {
                  setAddMemberHandler(() => handler);
                }}
                onGroupsChanged={async (newGroup?: AttendanceGroup) => {
                  await loadSystemData();
                  if (onGroupsChanged) onGroupsChanged();
                  // If a new group was created, automatically select it
                  if (newGroup && onGroupSelect) {
                    onGroupSelect(newGroup);
                    // Refresh members if showing registration or members section with the new group
                    if (
                      groupInitialSection === "registration" ||
                      groupInitialSection === "members"
                    ) {
                      try {
                        const groupMembers =
                          await attendanceManager.getGroupMembers(newGroup.id);
                        setMembers(groupMembers);
                      } catch (error) {
                        console.error("Failed to refresh members:", error);
                      }
                    }
                  } else if (
                    (groupInitialSection === "registration" ||
                      groupInitialSection === "members") &&
                    currentGroup
                  ) {
                    // Refresh members if showing registration or members section with current group
                    try {
                      const groupMembers =
                        await attendanceManager.getGroupMembers(
                          currentGroup.id,
                        );
                      setMembers(groupMembers);
                    } catch (error) {
                      console.error("Failed to refresh members:", error);
                    }
                  }
                }}
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
          {activeSection === "attendance" && (
            <Attendance
              attendanceSettings={attendanceSettings}
              onTrackingModeChange={(mode) =>
                updateAttendanceSetting({ trackingMode: mode })
              }
              onLateThresholdChange={(minutes) =>
                updateAttendanceSetting({ lateThresholdMinutes: minutes })
              }
              onLateThresholdToggle={(enabled) =>
                updateAttendanceSetting({ lateThresholdEnabled: enabled })
              }
              onClassStartTimeChange={(time) =>
                updateAttendanceSetting({ classStartTime: time })
              }
              onCooldownChange={(seconds) =>
                updateAttendanceSetting({ attendanceCooldownSeconds: seconds })
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
        </div>
      </div>
    </div>
  );

  if (isModal) {
    if (isFullScreen) {
      return (
        <div className="fixed inset-0 bg-[#0f0f0f] z-50 overflow-hidden pt-9 pb-5">
          {mainContent}
        </div>
      );
    }

    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
        <div className="bg-[#0f0f0f] border border-white/10 rounded-2xl w-full max-w-5xl h-[85vh] shadow-[0_40px_80px_rgba(0,0,0,0.6)] overflow-hidden">
          {mainContent}
        </div>
      </div>
    );
  }

  return mainContent;
};
