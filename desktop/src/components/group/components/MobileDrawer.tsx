import { useEffect } from 'react';
import type { GroupSection } from '../types';
import type { AttendanceGroup } from '../../../types/recognition';
// import { MobileHeader } from './MobileHeader';
import { MobileNav } from './MobileNav';

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeSection: GroupSection;
  onSectionChange: (section: GroupSection) => void;
  selectedGroup: AttendanceGroup | null;
  groups: AttendanceGroup[];
  onGroupChange: (group: AttendanceGroup | null) => void;
  onCreateGroup: () => void;
}


export function MobileDrawer({
  isOpen,
  onClose,
  activeSection,
  onSectionChange,
  selectedGroup,
  groups,
  onGroupChange,
  onCreateGroup,
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
          fixed inset-y-0 left-0 w-80 max-w-[85vw] bg-white/[0.02]
          border-r border-white/[0.08] z-50 lg:hidden backdrop-blur-sm
          transform transition-transform duration-300 ease-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        <div className="h-full flex flex-col pt-12 pb-5">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 border border-white/10"
            aria-label="Close menu"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Menu Header */}
          <div className="px-4 pt-1 pb-3 border-b border-white/[0.08]">
            <div className="flex items-center gap-2">
              <img src="/suri_icon.png" alt="Suri" className="w-6 h-6" />
              <h1 className="text-lg font-semibold text-white">Menu</h1>
            </div>
          </div>

          {/* Group Selector & Actions - Above Navigation */}
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
                  <option value="" className="bg-black text-white">Select group…</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id} className="bg-black text-white">{group.name}</option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                  <svg className="w-3 h-3 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              <button
                onClick={onCreateGroup}
                className="h-10 px-3 rounded-lg text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors border border-white/10 flex-shrink-0"
                aria-label="New Group"
                title="New Group"
              >
                Add
              </button>
            </div>
          </div>

          {/* Navigation */}
          <div className="flex-1 min-h-0">
            <MobileNav
              activeSection={activeSection}
              onSectionChange={onSectionChange}
              selectedGroup={selectedGroup}
              onClose={onClose}
            />
          </div>
        </div>
      </div>
    </>
  );
}

