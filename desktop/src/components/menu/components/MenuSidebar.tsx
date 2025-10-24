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
        flex flex-col border-r border-white/10 bg-black
        transition-all duration-300 ease-in-out flex-shrink-0
        ${isCollapsed ? 'w-16' : 'w-64'} h-full relative
      `}
    >
      {/* Collapse Button - Center of Right Border */}
      <button
        onClick={onToggleCollapse}
        className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-8 h-8 bg-black/90 backdrop-blur-sm border border-white/10 rounded-full hover:bg-white/10 hover:border-white/20 transition-all duration-200 flex items-center justify-center z-10 group"
        aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <div className="relative w-4 h-4">
          <div className={`absolute top-1/2 left-1/2 w-3 h-0.5 bg-white/70 group-hover:bg-white transition-all duration-200 ${isCollapsed ? 'rotate-45 -translate-x-1/2 -translate-y-1/2' : '-rotate-45 -translate-x-1/2 -translate-y-1/2'}`}></div>
          <div className={`absolute top-1/2 left-1/2 w-3 h-0.5 bg-white/70 group-hover:bg-white transition-all duration-200 ${isCollapsed ? '-rotate-45 -translate-x-1/2 -translate-y-1/2' : 'rotate-45 -translate-x-1/2 -translate-y-1/2'}`}></div>
        </div>
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
      <div className="px-4 py-3 border-t border-white/10 mt-auto">
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

