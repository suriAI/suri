import { Dropdown } from "../../shared";

import { useGroupStore, useGroupUIStore } from "../stores";
import { useGroupModals } from "../hooks";
import { GroupHeader } from "./GroupHeader";
import { GroupNav } from "./GroupNav";

interface GroupSidebarProps {
  onBack: () => void;
}

export function GroupSidebar({ onBack }: GroupSidebarProps) {
  // Zustand stores
  const { selectedGroup, groups, setSelectedGroup } = useGroupStore();
  const { activeSection, isSidebarCollapsed, setActiveSection, toggleSidebar } =
    useGroupUIStore();
  const { openCreateGroup } = useGroupModals();
  return (
    <aside
      className={`
        flex flex-col border-r border-white/[0.08] bg-white/[0.02]
        transition-all duration-300 ease-in-out flex-shrink-0
        ${isSidebarCollapsed ? "w-16" : "w-64"} h-full
      `}
    >
      {/* Sidebar Header - Group + Collapse Button */}
      <GroupHeader
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={toggleSidebar}
      />

      {/* Group Selector Section - Above Navigation */}
      {!isSidebarCollapsed && (
        <div className="px-4 py-3 border-b border-white/[0.08]">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Dropdown
                options={groups.map((group) => ({
                  value: group.id,
                  label: group.name,
                }))}
                value={selectedGroup?.id ?? null}
                onChange={(groupId: string | null) => {
                  if (groupId) {
                    const group = groups.find((g) => g.id === groupId);
                    setSelectedGroup(group ?? null);
                  } else {
                    setSelectedGroup(null);
                  }
                }}
                placeholder="Select group…"
                emptyMessage="No groups available"
                maxHeight={256}
                buttonClassName="h-10"
                allowClear={true}
              />
            </div>
            {/* New Group Button */}
            <button
              onClick={openCreateGroup}
              className="w-10 h-10 hover:bg-white/10 rounded-lg transition-colors flex items-center justify-center flex-shrink-0"
              aria-label="New Group"
              title="New Group"
            >
              <span className="text-lg">+</span>
            </button>
          </div>
        </div>
      )}

      {/* Navigation Items */}
      <GroupNav
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        selectedGroup={selectedGroup}
        isCollapsed={isSidebarCollapsed}
      />

      {/* Close Button at Bottom */}
      <div
        className={`py-3 border-t border-white/[0.08] mt-auto ${isSidebarCollapsed ? "px-2" : "px-4"}`}
      >
        <button
          onClick={onBack}
          className={`w-full rounded-md text-sm font-medium text-white/60 hover:bg-white/5 hover:text-white/80 transition-all text-center ${isSidebarCollapsed ? "px-2 py-2" : "px-3 py-2"}`}
          aria-label="Close"
          title="Close"
        >
          {!isSidebarCollapsed ? (
            <span className="text-sm">Close</span>
          ) : (
            <svg
              className="w-5 h-5 mx-auto"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          )}
        </button>
      </div>
    </aside>
  );
}
