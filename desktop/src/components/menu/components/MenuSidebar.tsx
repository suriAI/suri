import type { MenuSection } from '../types';
import type { AttendanceGroup } from '../../../types/recognition';
import { MenuHeader } from './MenuHeader';
import { MenuNav } from './MenuNav';

interface MenuSidebarProps {
  activeSection: MenuSection;
  onSectionChange: (section: MenuSection) => void;
  selectedGroup: AttendanceGroup | null;
  groups: AttendanceGroup[];
  onGroupChange: (group: AttendanceGroup | null) => void;
  onCreateGroup: () => void;
  onBack: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}


export function MenuSidebar({
  activeSection,
  onSectionChange,
  selectedGroup,
  groups,
  onGroupChange,
  onCreateGroup,
  onBack,
  isCollapsed,
  onToggleCollapse,
}: MenuSidebarProps) {

  return (
    <aside
      className={`
        flex flex-col border-r border-white/[0.08] bg-white/[0.02]
        transition-all duration-300 ease-in-out flex-shrink-0
        ${isCollapsed ? 'w-16' : 'w-64'} h-full relative
      `}
    >
      {/* Collapse Button - Center of Right Border */}
      <button
        onClick={onToggleCollapse}
        className="border-none absolute right-3 top-1/2 -translate-y-1/2 translate-x-1/2 flex items-center justify-center z-10 group focus:outline-none"
        aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <svg
          className={`w-5 h-5 text-white/70 group-hover:text-white transition-all duration-200 drop-shadow ${isCollapsed ? 'rotate-180 translate-x-[1px]' : 'rotate-0 -translate-x-[1px]'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
      </button>
      {/* Sidebar Header */}
      <MenuHeader
        selectedGroup={selectedGroup}
        groups={groups}
        onGroupChange={onGroupChange}
        onCreateGroup={onCreateGroup}
        isCollapsed={isCollapsed}
      />

      {/* Navigation Items */}
      <MenuNav
        activeSection={activeSection}
        onSectionChange={onSectionChange}
        selectedGroup={selectedGroup}
        isCollapsed={isCollapsed}
      />

      {/* Close Button at Bottom */}
      <div className="px-4 py-3 border-t border-white/[0.08] mt-auto">
        <button
          onClick={onBack}
          className="w-full px-3 py-2 rounded-md text-sm font-medium text-white/60 hover:bg-white/5 hover:text-white/80 transition-all text-center"
          aria-label="Close"
          title="Close"
        >
          {!isCollapsed && <span className="text-sm">Close</span>}
        </button>
      </div>

    </aside>
  );
}

