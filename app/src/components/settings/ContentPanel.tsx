import React from "react";
import { Display } from "@/components/settings/sections/Display";
import { Notifications } from "@/components/settings/sections/Notifications";
import { Database } from "@/components/settings/sections/Database";
import { Attendance } from "@/components/settings/sections/Attendance";
import { About } from "@/components/settings/sections/About";
import { CloudSync } from "@/components/settings/sections/CloudSync";
import { GroupPanel, type GroupSection } from "@/components/group";
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
}) => {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Section Header */}
      <div className="px-8 py-6 border-b border-white/10">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold flex items-center">
            {activeSection === "group" ? (
              <>
                Group{" "}
                <span className="text-sm text-white/60 ml-1">
                  ({groupInitialSection || "Overview"})
                </span>
              </>
            ) : (
              activeSection.charAt(0).toUpperCase() + activeSection.slice(1)
            )}
          </h2>
          {activeSection === "group" &&
            groupInitialSection === "members" &&
            validInitialGroup &&
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

      {/* Section Content */}
      <div className="flex-1 overflow-y-auto custom-scroll">
        {activeSection === "group" && (
          <div className="h-full w-full">
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
      </div>
    </div>
  );
};
