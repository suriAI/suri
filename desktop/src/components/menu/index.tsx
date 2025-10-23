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
    loading,
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
    <div className="pt-9 pb-5 h-screen bg-black text-white flex overflow-hidden">
      {/* Error Banner */}
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      {/* Desktop Sidebar - Hidden on mobile */}
      <div className="hidden lg:block">
        <MenuSidebar
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          selectedGroup={selectedGroup}
          groups={groups}
          loading={loading}
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

