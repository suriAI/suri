import React from "react";
import { motion } from "framer-motion";
import { Dropdown, Tooltip } from "@/components/shared";
import type { AttendanceGroup } from "@/types/recognition";
import { useGroupStore } from "@/components/group/stores";
import type { GroupSection } from "@/components/group/types";

interface SidebarProps {
  activeSection: string;
  setActiveSection: (section: string) => void;
  groupInitialSection: GroupSection | undefined;
  setGroupInitialSection: (section: GroupSection) => void;
  dropdownGroups: AttendanceGroup[];
  dropdownValue: string | null;
  onGroupSelect?: (group: AttendanceGroup) => void;
  setTriggerCreateGroup: (trigger: number) => void;
  setRegistrationState: (
    source: "upload" | "camera" | null,
    mode: "single" | "bulk" | "queue" | null,
  ) => void;
  sections: { id: string; label: string; icon: string }[];
  groupSections: { id: GroupSection; label: string; icon: string }[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  setActiveSection,
  groupInitialSection,
  setGroupInitialSection,
  dropdownGroups,
  dropdownValue,
  onGroupSelect,
  setTriggerCreateGroup,
  setRegistrationState,
  sections,
  groupSections,
}) => {
  const storeGroups = useGroupStore((state) => state.groups);

  return (
    <div className="w-[200px] sm:w-[240px] lg:w-[280px] shrink-0 flex flex-col bg-[#0b0b0b] border-r border-white/5">
      <div className="px-6 py-8 flex items-center justify-between">
        <h1 className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/50">
          Settings
        </h1>
      </div>

      <div className="flex-1 pl-3 pr-0.5 space-y-10 overflow-y-auto settings-sidebar-scroll pb-6">
        <section>
          <div className="px-3 mb-4 flex items-center justify-between">
            <h2 className="text-[10px] font-bold text-white/50 uppercase tracking-widest">
              Group Management
            </h2>
          </div>

          <div className="space-y-6">
            <div className="flex items-center gap-2 px-1">
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
                      const group = dropdownGroups.find(
                        (g) => g.id === groupId,
                      );
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
                  className="bg-white/5 border-white/10 hover:bg-white/5"
                  emptyMessage="No groups available"
                  maxHeight={256}
                />
              </div>
              <Tooltip content="Create Group" position="top">
                <button
                  onClick={() => {
                    setActiveSection("group");
                    if (activeSection !== "group") {
                      setGroupInitialSection("overview");
                    }
                    setTriggerCreateGroup(Date.now());
                  }}
                  className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 transition-all text-white/50 hover:text-cyan-400 group/btn"
                >
                  <i className="fa-solid fa-plus text-xs group-hover/btn:scale-110 transition-transform"></i>
                </button>
              </Tooltip>
            </div>

            <div
              className={`space-y-0.5 ${!dropdownValue ? "opacity-40 pointer-events-none grayscale" : ""}`}
            >
              {groupSections.map((subsection) => {
                const isActive =
                  activeSection === "group" &&
                  groupInitialSection === subsection.id;
                return (
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
                    className={`w-full relative group/item text-left px-4 py-2.5 rounded-lg text-[14px] font-medium transition-all flex items-center gap-3 ${isActive
                      ? "bg-white/6 text-white"
                      : "text-white/60 hover:bg-white/5 hover:text-white"
                      }`}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="active-indicator-group"
                        className="absolute left-[-8px] top-1/2 -translate-y-1/2 w-1 h-6 bg-cyan-500 rounded-r-full shadow-[0_0_10px_rgba(6,182,212,0.4)]"
                      />
                    )}
                    <i
                      className={`${subsection.icon} text-xs w-4 transition-transform group-hover/item:scale-105 ${isActive ? "text-cyan-400" : "text-white/50"}`}
                    ></i>
                    {subsection.label}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section>
          <div className="px-3 mb-4">
            <h2 className="text-[10px] font-bold text-white/50 uppercase tracking-widest">
              General
            </h2>
          </div>

          <div className="space-y-0.5">
            {sections.map((section) => {
              const isActive = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full relative group/item text-left px-4 py-2.5 rounded-lg text-[14px] font-medium transition-all flex items-center gap-3 ${isActive
                    ? "bg-white/6 text-white"
                    : "text-white/60 hover:bg-white/5 hover:text-white"
                    }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="active-indicator-general"
                      className="absolute left-[-8px] top-1/2 -translate-y-1/2 w-1 h-6 bg-white rounded-r-full shadow-[0_0_10px_rgba(255,255,255,0.2)]"
                    />
                  )}
                  <i
                    className={`${section.icon} text-xs w-4 transition-transform group-hover/item:scale-105 ${isActive ? "text-white" : "text-white/50"}`}
                  ></i>
                  {section.label}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
};
