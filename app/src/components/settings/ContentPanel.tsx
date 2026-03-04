import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Display } from "@/components/settings/sections/Display";
import { Notifications } from "@/components/settings/sections/Notifications";
import { Database } from "@/components/settings/sections/Database";
import { Attendance } from "@/components/settings/sections/Attendance";
import { About } from "@/components/settings/sections/About";
import { CloudSync } from "@/components/settings/sections/CloudSync";
import { GroupPanel, type GroupSection } from "@/components/group";
import { useGroupModals } from "@/components/group/hooks";
import type {
  QuickSettings,
  AttendanceSettings,
  AudioSettings,
  SettingsOverview,
} from "@/components/settings/types";
import type { AttendanceGroup, AttendanceMember } from "@/types/recognition";

interface ContentPanelProps {
  activeSection: string;
  groupInitialSection: GroupSection | undefined;
  setGroupInitialSection: (section: GroupSection) => void;
  validInitialGroup: AttendanceGroup | null;
  triggerCreateGroup: number;
  registrationSource: "upload" | "camera" | null;
  registrationMode: "single" | "bulk" | "queue" | null;
  setRegistrationState: (
    source: "upload" | "camera" | null,
    mode: "single" | "bulk" | "queue" | null,
  ) => void;
  deselectMemberTrigger: number;
  setDeselectMemberTrigger: (trigger: number) => void;
  setHasSelectedMember: (hasSelected: boolean) => void;
  handleExportHandlersReady: (handlers: {
    exportCSV: () => void;
    print: () => void;
  }) => void;
  handleAddMemberHandlerReady: (handler: () => void) => void;
  handleGroupsChanged: (newGroup?: AttendanceGroup) => void;
  handleGroupBack: () => void;
  quickSettings: QuickSettings;
  toggleQuickSetting: (key: keyof QuickSettings) => void;
  audioSettings: AudioSettings;
  updateAudioSetting: (updates: Partial<AudioSettings>) => void;
  attendanceSettings: AttendanceSettings;
  updateAttendanceSetting: (updates: Partial<AttendanceSettings>) => void;
  dropdownValue: string | null;
  systemData: SettingsOverview;
  groups: AttendanceGroup[];
  isLoading: boolean;
  handleClearDatabase: () => void;
  loadSystemData: () => void;
  onGroupsChanged?: () => void;
  members: AttendanceMember[];
  reportsExportHandlers: {
    exportCSV: () => void;
    print: () => void;
  } | null;
  addMemberHandler: (() => void) | null;
  hasSelectedMember: boolean;
  dropdownGroups: AttendanceGroup[];
  groupSections: Array<{ id: GroupSection; label: string; icon: string }>;
}

export const ContentPanel: React.FC<ContentPanelProps> = ({
  activeSection,
  groupInitialSection,
  setGroupInitialSection,
  validInitialGroup,
  triggerCreateGroup,
  registrationSource,
  registrationMode,
  setRegistrationState,
  deselectMemberTrigger,
  setDeselectMemberTrigger,
  setHasSelectedMember,
  handleExportHandlersReady,
  handleAddMemberHandlerReady,
  handleGroupsChanged,
  handleGroupBack,
  quickSettings,
  toggleQuickSetting,
  audioSettings,
  updateAudioSetting,
  attendanceSettings,
  updateAttendanceSetting,
  dropdownValue,
  systemData,
  groups,
  isLoading,
  handleClearDatabase,
  loadSystemData,
  onGroupsChanged,
  members,
  reportsExportHandlers,
  addMemberHandler,
  hasSelectedMember,
  dropdownGroups,
  groupSections,
}) => {
  const { openEditGroup } = useGroupModals();
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#090909]">
      {/* Section Header */}
      <div className="px-10 pt-10 pb-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold flex items-center">
            {activeSection === "group" ? (
              <div className="flex flex-col">
                <span className="text-xs font-bold text-cyan-400/80 uppercase tracking-widest mb-0.5">
                  {dropdownValue
                    ? dropdownGroups.find((g) => g.id === dropdownValue)?.name
                    : "Group Management"}
                </span>
                <span className="text-xl font-semibold text-white">
                  {groupInitialSection
                    ? groupSections.find((s) => s.id === groupInitialSection)
                        ?.label
                    : "Overview"}
                </span>
              </div>
            ) : (
              <div className="flex flex-col">
                <span className="text-xs font-bold text-white/30 uppercase tracking-widest mb-0.5">
                  General
                </span>
                <span className="text-xl font-semibold text-white">
                  {activeSection.charAt(0).toUpperCase() +
                    activeSection.slice(1)}
                </span>
              </div>
            )}
          </h2>

          <div className="flex items-center gap-4">
            {activeSection === "group" &&
              groupInitialSection === "members" &&
              validInitialGroup &&
              addMemberHandler &&
              members.length > 0 && (
                <button
                  onClick={addMemberHandler}
                  className="px-4 py-2 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/50 hover:text-white transition-all flex items-center gap-2 font-bold uppercase tracking-wider"
                >
                  <i className="fa-solid fa-user-plus text-xs"></i>
                  Add Member
                </button>
              )}
            {activeSection === "group" &&
              groupInitialSection === "overview" &&
              validInitialGroup && (
                <button
                  onClick={openEditGroup}
                  className="px-4 py-2 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/50 hover:text-white transition-all flex items-center gap-2 font-bold uppercase tracking-wider"
                >
                  <svg
                    className="w-3.5 h-3.5 mb-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
                      strokeWidth={2}
                    />
                  </svg>
                  Edit Group
                </button>
              )}
            {activeSection === "group" &&
              groupInitialSection === "reports" &&
              reportsExportHandlers && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={reportsExportHandlers.exportCSV}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/50 hover:bg-white/10 hover:text-white transition-all text-[11px] font-bold uppercase tracking-wider"
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
                    if (registrationMode === "single" && hasSelectedMember) {
                      setDeselectMemberTrigger(Date.now());
                      return;
                    }
                    if (registrationMode) {
                      setRegistrationState(registrationSource, null);
                    } else if (registrationSource) {
                      setRegistrationState(null, null);
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
      </div>

      {/* Section Content */}
      <div className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden custom-scroll relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeSection}
            initial={{ opacity: 0, scale: 0.995 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.995 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            style={{ willChange: "opacity, transform" }}
            className="flex-1 flex flex-col w-full relative"
          >
            {activeSection === "group" && (
              <div className="flex-1 w-full relative flex flex-col">
                <GroupPanel
                  onBack={handleGroupBack}
                  initialSection={groupInitialSection}
                  initialGroup={validInitialGroup}
                  triggerCreateGroup={triggerCreateGroup}
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
                hasSelectedGroup={!!dropdownValue}
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
            {activeSection === "cloudsync" && <CloudSync />}
            {activeSection === "about" && <About />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};
