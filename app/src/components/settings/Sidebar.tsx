import React from "react";
import { Dropdown } from "@/components/shared";
import type { AttendanceGroup } from "@/types/recognition";
import { useGroupStore } from "@/components/group/stores";
import type { GroupSection } from "@/components/group/types";

interface SidebarProps {
  activeSection: string;
  setActiveSection: (section: string) => void;
  groupInitialSection: GroupSection | undefined;
  setGroupInitialSection: (section: GroupSection) => void;
  isGroupExpanded: boolean;
  setIsGroupExpanded: (expanded: boolean) => void;
  dropdownGroups: AttendanceGroup[];
  dropdownValue: string | null;
  onGroupSelect?: (group: AttendanceGroup) => void;
  setTriggerCreateGroup: (trigger: number) => void;
  setRegistrationState: (
    source: "upload" | "camera" | null,
    mode: "single" | "bulk" | "queue" | null,
  ) => void;
  onBack: () => void;
  sections: Array<{ id: string; label: string; icon: string }>;
  groupSections: Array<{ id: GroupSection; label: string; icon: string }>;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  setActiveSection,
  groupInitialSection,
  setGroupInitialSection,
  isGroupExpanded,
  setIsGroupExpanded,
  dropdownGroups,
  dropdownValue,
  onGroupSelect,
  setTriggerCreateGroup,
  setRegistrationState,
  onBack,
  sections,
  groupSections,
}) => {
  const storeGroups = useGroupStore((state) => state.groups);

  return (
    <div className="w-64 flex-shrink-0 flex flex-col bg-[#0f0f0f]">
      {/* Header */}
      <div className="px-4 py-4 border-b border-white/10 flex items-center justify-between">
        <h1 className="text-sm font-semibold uppercase tracking-wider text-white">
          Settings
        </h1>
      </div>

      {/* Group Selector */}
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
                const groupStore = useGroupStore.getState();
                if (groupId) {
                  const group = dropdownGroups.find((g) => g.id === groupId);
                  if (group) {
                    groupStore.setSelectedGroup(group);
                    if (onGroupSelect) onGroupSelect(group);
                  }
                } else {
                  groupStore.setSelectedGroup(null);
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
              allowClear={dropdownGroups.length === 0}
              showPlaceholderOption={dropdownGroups.length === 0}
            />
          </div>
          <button
            onClick={() => {
              setActiveSection("group");
              if (activeSection !== "group") {
                setGroupInitialSection("overview");
              }
              setIsGroupExpanded(true);
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
              className={`fa-solid fa-chevron-down text-xs transition-transform duration-200 ${
                isGroupExpanded ? "" : "-rotate-90"
              }`}
            ></i>
          </button>

          {isGroupExpanded && (
            <div className="mt-1 ml-3 pl-3 border-l-2 border-white/[0.06] space-y-0.5">
              {groupSections.map((subsection) => (
                <button
                  key={subsection.id}
                  onClick={() => {
                    setActiveSection("group");
                    setGroupInitialSection(subsection.id);
                    setTriggerCreateGroup(0);
                    if (subsection.id === "registration") {
                      setRegistrationState(null, null);
                    }
                  }}
                  className={`w-full text-left px-3 py-2 rounded-md text-md font-medium transition-all flex items-center gap-2 ${
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

        {sections.map((section) => (
          <button
            key={section.id}
            onClick={() => setActiveSection(section.id)}
            className={`w-full text-left px-3 py-2 rounded-md text-md font-medium transition-all flex items-center gap-2 ${
              activeSection === section.id
                ? "bg-white/10 text-white"
                : "text-white/60 hover:bg-white/5 hover:text-white/80"
            }`}
          >
            <i className={`${section.icon} text-sm w-4`}></i>
            {section.label}
          </button>
        ))}
      </div>

      {/* Close Button */}
      <div className="p-2 border-t border-white/10">
        <button
          onClick={onBack}
          className="w-full px-3 py-2 rounded-md text-sm font-medium text-white/60 hover:bg-white/5 hover:text-white/80 transition-all text-center flex items-center justify-center gap-2"
        >
          Close
        </button>
      </div>
    </div>
  );
};
