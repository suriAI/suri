import { useState, useEffect } from 'react';

// Types
export type { MenuSection } from './types';
import type { MenuProps } from './types';

// Custom Hooks
import { useMenuData } from './hooks/useMenuData';
import { useMenuModals } from './hooks/useMenuModals';

// Components
import { MenuSidebar } from './components/MenuSidebar';
import { MobileDrawer } from './components/MobileDrawer';
import { ErrorBanner } from './components/ErrorBanner';
import { MenuContent } from './components/MenuContent';
import { MenuModals } from './components/MenuModals';

export function Menu({ onBack, initialSection }: MenuProps) {
  const [activeSection, setActiveSection] = useState(initialSection ?? 'overview');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  // Custom hooks for clean separation of concerns
  const {
    selectedGroup,
    groups,
    members,
    error,
    setSelectedGroup,
    setError,
    fetchGroups,
    fetchGroupDetails,
    deleteGroup,
    exportData,
  } = useMenuData();

  const {
    showAddMemberModal,
    showEditMemberModal,
    showCreateGroupModal,
    showEditGroupModal,
    editingMember,
    openAddMember,
    openEditMember,
    openCreateGroup,
    openEditGroup,
    closeAddMember,
    closeEditMember,
    closeCreateGroup,
    closeEditGroup,
  } = useMenuModals();

  // Handlers
  const handleDeleteGroup = async () => {
    if (!selectedGroup) return;

    if (!confirm(`Delete group "${selectedGroup.name}"? This will remove all members and attendance records.`)) {
      return;
    }

    await deleteGroup(selectedGroup.id);
  };

  const handleMemberSuccess = () => {
    if (selectedGroup) {
      fetchGroupDetails(selectedGroup.id);
    }
  };

  const handleGroupSuccess = (newGroup?: any) => {
    fetchGroups();
    if (newGroup) {
      setSelectedGroup(newGroup);
    }
  };

  // Sync initial section
  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection);
    }
  }, [initialSection]);

  // Restore sidebar state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('suri_menu_sidebar_collapsed');
    if (saved !== null) {
      setIsSidebarCollapsed(saved === 'true');
    }
  }, []);

  // Save sidebar state to localStorage
  const handleToggleSidebar = () => {
    setIsSidebarCollapsed(prev => {
      const newValue = !prev;
      localStorage.setItem('suri_menu_sidebar_collapsed', String(newValue));
      return newValue;
    });
  };

  return (
    <div className="pt-12 lg:pt-9 pb-5 h-screen bg-black text-white flex overflow-hidden">
      {/* Error Banner */}
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      {/* Mobile Top Bar */}
      <div className="fixed inset-x-0 top-9 lg:hidden z-30">
        <div className="h-12 px-3 flex items-center justify-between bg-white/[0.02] border-b border-white/[0.08] backdrop-blur-sm">
          <button
            onClick={() => setIsMobileDrawerOpen(true)}
            className="px-3 py-1.5 rounded-md text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Open menu"
            title="Open menu"
          >
            Menu
          </button>
          <div className="flex-1 min-w-0 text-right">
            <div className="text-xs text-white/50 truncate">
              {selectedGroup ? selectedGroup.name : 'No group selected'}
            </div>
          </div>
        </div>
      </div>

      {/* Desktop Sidebar - Hidden on mobile */}
      <div className="hidden lg:block">
        <MenuSidebar
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          selectedGroup={selectedGroup}
          groups={groups}
          onGroupChange={setSelectedGroup}
          onCreateGroup={openCreateGroup}
          onBack={onBack}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={handleToggleSidebar}
        />
      </div>

      {/* Mobile Drawer */}
      <MobileDrawer
        isOpen={isMobileDrawerOpen}
        onClose={() => setIsMobileDrawerOpen(false)}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        selectedGroup={selectedGroup}
        groups={groups}
        onGroupChange={setSelectedGroup}
        onCreateGroup={openCreateGroup}
      />

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden bg-black">
        <MenuContent
          selectedGroup={selectedGroup}
          groups={groups}
          members={members}
          activeSection={activeSection}
          onMembersChange={() => selectedGroup && fetchGroupDetails(selectedGroup.id)}
          onEditMember={openEditMember}
          onAddMember={openAddMember}
          onEditGroup={openEditGroup}
          onDeleteGroup={handleDeleteGroup}
          onExportData={exportData}
          onCreateGroup={openCreateGroup}
        />
      </main>

      {/* Modals */}
      <MenuModals
        selectedGroup={selectedGroup}
        showAddMemberModal={showAddMemberModal}
        showEditMemberModal={showEditMemberModal}
        showCreateGroupModal={showCreateGroupModal}
        showEditGroupModal={showEditGroupModal}
        editingMember={editingMember}
        onCloseAddMember={closeAddMember}
        onCloseEditMember={closeEditMember}
        onCloseCreateGroup={closeCreateGroup}
        onCloseEditGroup={closeEditGroup}
        onMemberSuccess={handleMemberSuccess}
        onGroupSuccess={handleGroupSuccess}
      />
    </div>
  );
}

