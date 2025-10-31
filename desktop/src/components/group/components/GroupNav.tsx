import { useEffect } from 'react';
import type { GroupSection } from '../types';

interface GroupNavProps {
  activeSection: GroupSection;
  onSectionChange: (section: GroupSection) => void;
  selectedGroup: any;
  isCollapsed: boolean;
}

interface SectionConfig {
  id: GroupSection;
  label: string;
  icon: string;
  shortcut: string;
}

const SECTIONS: SectionConfig[] = [
  { 
    id: 'overview', 
    label: 'Overview', 
    icon: '',
    shortcut: '1'
  },
  { 
    id: 'members', 
    label: 'Members', 
    icon: '',
    shortcut: '2'
  },
  { 
    id: 'reports', 
    label: 'Reports', 
    icon: '',
    shortcut: '3'
  },
  { 
    id: 'registration', 
    label: 'Registration', 
    icon: '',
    shortcut: '4'
  },
  { 
    id: 'settings', 
    label: 'Settings', 
    icon: '',
    shortcut: '5'
  },
];

export function GroupNav({ activeSection, onSectionChange, selectedGroup, isCollapsed }: GroupNavProps) {
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Only trigger if Ctrl/Cmd is not pressed (to avoid conflicts)
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      
      // Check if user is typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const section = SECTIONS.find(s => s.shortcut === e.key);
      if (section && selectedGroup) {
        e.preventDefault();
        onSectionChange(section.id);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [onSectionChange, selectedGroup]);

  return (
    <nav className="flex-1 py-2 overflow-y-auto custom-scroll">
      <ul className="space-y-1 px-2">
        {SECTIONS.map((section) => {
          const isActive = activeSection === section.id;
          const isDisabled = !selectedGroup;

          return (
            <li key={section.id}>
              <button
                onClick={() => !isDisabled && onSectionChange(section.id)}
                disabled={isDisabled}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-lg
                  transition-all duration-200 group relative
                  ${isActive
                    ? 'bg-white/10 text-white'
                    : isDisabled
                    ? 'text-white/30 cursor-not-allowed'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                  }
                `}
                title={isCollapsed ? section.label : undefined}
                aria-label={section.label}
                aria-current={isActive ? 'page' : undefined}
              >
                {/* Label (hidden when collapsed) */}
                {!isCollapsed && (
                  <div className="flex-1 min-w-0 text-left">
                    <div className="font-medium text-sm truncate">
                      {section.label}
                    </div>
                  </div>
                )}

                {/* Active indicator */}
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-white rounded-r-full" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}