import type { GroupSection } from '../types';
import type { AttendanceGroup } from '../../../types/recognition';
import { GroupHeader } from './GroupHeader';
import { GroupNav } from './GroupNav';

interface GroupSidebarProps {
  activeSection: GroupSection;
  onSectionChange: (section: GroupSection) => void;
  selectedGroup: AttendanceGroup | null;
  groups: AttendanceGroup[];
  onGroupChange: (group: AttendanceGroup | null) => void;
  onCreateGroup: () => void;
  onBack: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}


export function GroupSidebar({
  activeSection,
  onSectionChange,
  selectedGroup,
  groups,
  onGroupChange,
  onCreateGroup,
  onBack,
  isCollapsed,
  onToggleCollapse,
}: GroupSidebarProps) {

  return (
    <aside
      className={`
        flex flex-col border-r border-white/[0.08] bg-white/[0.02]
        transition-all duration-300 ease-in-out flex-shrink-0
        ${isCollapsed ? 'w-16' : 'w-64'} h-full
      `}
    >
      {/* Sidebar Header - Group + Collapse Button */}
      <GroupHeader isCollapsed={isCollapsed} onToggleCollapse={onToggleCollapse} />

      {/* Group Selector Section - Above Navigation */}
      {!isCollapsed && (
        <div className="px-4 py-3 border-b border-white/[0.08]">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <select
                value={selectedGroup?.id ?? ''}
                onChange={(event) => {
                  const group = groups.find((item) => item.id === event.target.value) ?? null;
                  onGroupChange(group);
                }}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 pr-8 text-sm text-white focus:outline-none focus:border-white/20 transition-all cursor-pointer h-10 appearance-none"
                style={{ colorScheme: 'dark' }}
              >
                <option value="" className="bg-black text-white">
                  Select group…
                </option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id} className="bg-black text-white">
                    {group.name}
                  </option>
                ))}
              </select>
              {/* Custom dropdown arrow */}
              <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                <svg
                  className="w-3 h-3 text-white/50 transition-colors duration-200"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
            {/* New Group Button */}
            <button
              onClick={onCreateGroup}
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
        onSectionChange={onSectionChange}
        selectedGroup={selectedGroup}
        isCollapsed={isCollapsed}
      />

      {/* Close Button at Bottom */}
      <div className={`py-3 border-t border-white/[0.08] mt-auto ${isCollapsed ? 'px-2' : 'px-4'}`}>
        <button
          onClick={onBack}
          className={`w-full rounded-md text-sm font-medium text-white/60 hover:bg-white/5 hover:text-white/80 transition-all text-center ${isCollapsed ? 'px-2 py-2' : 'px-3 py-2'}`}
          aria-label="Close"
          title="Close"
        >
          {!isCollapsed ? <span className="text-sm">Close</span> : (
            <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
        </button>
      </div>

    </aside>
  );
}

