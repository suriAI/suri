import type { GroupSection } from '../types';

interface MobileNavProps {
  activeSection: GroupSection;
  onSectionChange: (section: GroupSection) => void;
  selectedGroup: any;
  onClose: () => void;
}

interface SectionConfig {
  id: GroupSection;
  label: string;
  icon: string;
  description: string;
}

const SECTIONS: SectionConfig[] = [
  { id: 'overview', label: 'Overview', icon: '', description: 'Statistics & activity' },
  { id: 'members', label: 'Members', icon: '', description: 'Manage members' },
  { id: 'reports', label: 'Reports', icon: '', description: 'View reports' },
  { id: 'registration', label: 'Registration', icon: '', description: 'Register faces' },
  { id: 'settings', label: 'Settings', icon: '', description: 'Configuration' },
];

export function MobileNav({ activeSection, onSectionChange, selectedGroup, onClose }: MobileNavProps) {
  const handleSectionClick = (section: GroupSection) => {
    if (selectedGroup) {
      onSectionChange(section);
      onClose();
    }
  };

  return (
    <nav className="px-4 pt-3 pb-4 overflow-y-auto custom-scroll h-full">
      <ul className="space-y-2">
        {SECTIONS.map((section) => {
          const isActive = activeSection === section.id;
          const isDisabled = !selectedGroup;

          return (
            <li key={section.id}>
              <button
                onClick={() => handleSectionClick(section.id)}
                disabled={isDisabled}
                className={`
                  w-full flex items-center gap-4 px-4 py-3 rounded-lg
                  transition-all duration-200 relative
                  ${isActive
                    ? 'bg-white/10 text-white'
                    : isDisabled
                    ? 'text-white/30 cursor-not-allowed'
                    : 'text-white/70 hover:text-white hover:bg-white/5 active:bg-white/10'
                  }
                `}
              >
                {/* Content */}
                <div className="flex-1 text-left">
                  <div className="font-medium text-base">{section.label}</div>
                  <div className="text-xs text-white/50 mt-0.5">{section.description}</div>
                </div>

                {/* Active indicator */}
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-10 bg-white rounded-r-full" />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Footer Hint */}
      {selectedGroup && (
        <div className="mt-6 px-4 py-3 bg-white/5 rounded-xl border border-white/10">
          <div className="text-xs text-white/60">
            <div className="font-semibold mb-1">Quick Tip</div>
            <div>Swipe from left edge to open this menu</div>
          </div>
        </div>
      )}
    </nav>
  );
}
