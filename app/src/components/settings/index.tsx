import React from "react";
import { motion } from "framer-motion";
import { useSettings } from "./hooks/useSettings";
import { Sidebar } from "./Sidebar";
import { ContentPanel } from "./ContentPanel";
import type { QuickSettings, AttendanceSettings, AudioSettings } from "./types";
import type { AttendanceGroup } from "@/types/recognition";
import type { GroupSection } from "@/components/group";

export type { QuickSettings, AttendanceSettings };
export type { AudioSettings } from "./types";

interface SettingsProps {
  onBack: () => void;
  isModal?: boolean;
  quickSettings: QuickSettings;
  onQuickSettingsChange: (settings: QuickSettings) => void;
  audioSettings: AudioSettings;
  onAudioSettingsChange: (settings: Partial<AudioSettings>) => void;
  attendanceSettings: AttendanceSettings;
  onAttendanceSettingsChange: (settings: Partial<AttendanceSettings>) => void;
  initialGroupSection?: GroupSection;
  currentGroup?: AttendanceGroup | null;
  onGroupSelect?: (group: AttendanceGroup) => void;
  onGroupsChanged?: () => void;
  initialGroups?: AttendanceGroup[];
  initialSection?: string;
}

export const Settings = React.forwardRef<HTMLDivElement, SettingsProps>(
  (props, ref) => {
    const settings = useSettings({
      ...props,
      initialGroups: props.initialGroups || [],
      currentGroup: props.currentGroup || null,
    });

    const groupSections: Array<{
      id: GroupSection;
      label: string;
      icon: string;
    }> = [
      { id: "overview", label: "Overview", icon: "fa-solid fa-chart-line" },
      { id: "reports", label: "Reports", icon: "fa-solid fa-chart-bar" },
      { id: "members", label: "Members", icon: "fa-solid fa-users" },
      {
        id: "registration",
        label: "Registration",
        icon: "fa-solid fa-id-card",
      },
      { id: "settings", label: "Configuration", icon: "fa-solid fa-sliders" },
    ];

    const sections = [
      { id: "attendance", label: "Attendance", icon: "fa-solid fa-user-check" },
      { id: "display", label: "Display", icon: "fa-solid fa-desktop" },
      { id: "notifications", label: "Notifications", icon: "fa-solid fa-bell" },
      { id: "database", label: "Database", icon: "fa-solid fa-database" },
      { id: "about", label: "About", icon: "fa-solid fa-circle-info" },
    ];

    const mainContent = (
      <div className="h-full flex bg-[#141414] text-white">
        <Sidebar
          activeSection={settings.activeSection}
          setActiveSection={settings.setActiveSection}
          groupInitialSection={settings.groupInitialSection}
          setGroupInitialSection={settings.setGroupInitialSection}
          isGroupExpanded={settings.isGroupExpanded}
          setIsGroupExpanded={settings.setIsGroupExpanded}
          dropdownGroups={settings.dropdownGroups}
          dropdownValue={settings.dropdownValue}
          onGroupSelect={props.onGroupSelect}
          setTriggerCreateGroup={settings.setTriggerCreateGroup}
          setRegistrationState={settings.setRegistrationState}
          onBack={props.onBack}
          sections={sections}
          groupSections={groupSections}
        />

        <ContentPanel
          activeSection={settings.activeSection}
          groupInitialSection={settings.groupInitialSection}
          setGroupInitialSection={settings.setGroupInitialSection}
          validInitialGroup={props.currentGroup || null}
          triggerCreateGroup={settings.triggerCreateGroup}
          registrationSource={settings.registrationSource}
          registrationMode={settings.registrationMode}
          setRegistrationState={settings.setRegistrationState}
          deselectMemberTrigger={settings.deselectMemberTrigger}
          setDeselectMemberTrigger={settings.setDeselectMemberTrigger}
          setHasSelectedMember={settings.setHasSelectedMember}
          hasSelectedMember={settings.hasSelectedMember}
          handleExportHandlersReady={settings.handleExportHandlersReady}
          handleAddMemberHandlerReady={settings.handleAddMemberHandlerReady}
          handleGroupsChanged={settings.handleGroupsChanged}
          handleGroupBack={settings.handleGroupBack}
          quickSettings={props.quickSettings}
          toggleQuickSetting={settings.toggleQuickSetting}
          audioSettings={props.audioSettings}
          updateAudioSetting={settings.updateAudioSetting}
          attendanceSettings={props.attendanceSettings}
          updateAttendanceSetting={settings.updateAttendanceSetting}
          dropdownValue={settings.dropdownValue}
          systemData={settings.systemData}
          groups={settings.groups}
          isLoading={settings.isLoading}
          handleClearDatabase={settings.handleClearDatabase}
          loadSystemData={settings.loadSystemData}
          onGroupsChanged={props.onGroupsChanged}
          members={settings.members}
          reportsExportHandlers={settings.reportsExportHandlers}
          addMemberHandler={settings.addMemberHandler}
        />
      </div>
    );

    if (props.isModal) {
      return (
        <motion.div
          ref={ref}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          style={{ willChange: "opacity" }}
          className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 15 }}
            transition={{
              type: "spring",
              stiffness: 500,
              damping: 30,
              mass: 0.5,
            }}
            style={{ willChange: "transform, opacity" }}
            // Adjusted padding to account for custom window traffic lights
            className="bg-[#0f0f0f] rounded-xl w-full max-w-[95%] lg:h-[89vh] md:h-[80vh] shadow-[0_40px_80px_rgba(0,0,0,0.6)] overflow-hidden mt-6"
          >
            {mainContent}
          </motion.div>
        </motion.div>
      );
    }

    return mainContent;
  },
);

Settings.displayName = "Settings";
