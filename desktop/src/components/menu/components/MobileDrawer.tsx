import { useEffect } from 'react';
import type { MenuSection } from '../types';
import type { AttendanceGroup } from '../../../types/recognition';

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeSection: MenuSection;
  onSectionChange: (section: MenuSection) => void;
  selectedGroup: AttendanceGroup | null;
}

interface SectionConfig {
  id: MenuSection;
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

export function MobileDrawer({
  isOpen,
  onClose,
  activeSection,
  onSectionChange,
  selectedGroup,
}: MobileDrawerProps) {
  // Lock body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const handleSectionClick = (section: MenuSection) => {
    if (selectedGroup) {
      onSectionChange(section);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40 lg:hidden animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className={`
          fixed inset-y-0 left-0 w-80 max-w-[85vw] bg-black
          border-r border-white/10 z-50 lg:hidden
          transform transition-transform duration-300 ease-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        {/* Header */}
        <div className="h-16 border-b border-white/10 flex items-center justify-between px-6">
          <h2 className="text-lg font-semibold text-white">Menu</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors group"
            aria-label="Close menu"
          >
            <div className="relative w-4 h-4">
              <div className="absolute top-1/2 left-1/2 w-3 h-0.5 bg-white/70 group-hover:bg-white transition-all duration-200 rotate-45 -translate-x-1/2 -translate-y-1/2"></div>
              <div className="absolute top-1/2 left-1/2 w-3 h-0.5 bg-white/70 group-hover:bg-white transition-all duration-200 -rotate-45 -translate-x-1/2 -translate-y-1/2"></div>
            </div>
          </button>
        </div>

        {/* Navigation */}
        <nav className="py-4 px-4 overflow-y-auto h-[calc(100vh-4rem)]">
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
      </div>
    </>
  );
}

