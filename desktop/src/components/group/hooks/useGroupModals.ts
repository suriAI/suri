import { useGroupUIStore } from "../stores";

/**
 * Hook that provides access to modal state from Zustand store
 * All modal operations are handled by the store
 */
export function useGroupModals() {
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
  } = useGroupUIStore();

  return {
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
  };
}
