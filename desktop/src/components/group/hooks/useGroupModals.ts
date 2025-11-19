import { useMemo } from "react";
import { useGroupUIStore } from "../stores";

/**
 * Hook that provides access to modal state from Zustand store
 * All modal operations are handled by the store
 * Uses selectors to prevent unnecessary re-renders
 */
export function useGroupModals() {
  // Use selectors to prevent re-renders when unrelated store parts change
  const showAddMemberModal = useGroupUIStore((state) => state.showAddMemberModal);
  const showEditMemberModal = useGroupUIStore((state) => state.showEditMemberModal);
  const showCreateGroupModal = useGroupUIStore((state) => state.showCreateGroupModal);
  const showEditGroupModal = useGroupUIStore((state) => state.showEditGroupModal);
  const editingMember = useGroupUIStore((state) => state.editingMember);
  const openAddMember = useGroupUIStore((state) => state.openAddMember);
  const openEditMember = useGroupUIStore((state) => state.openEditMember);
  const openCreateGroup = useGroupUIStore((state) => state.openCreateGroup);
  const openEditGroup = useGroupUIStore((state) => state.openEditGroup);
  const closeAddMember = useGroupUIStore((state) => state.closeAddMember);
  const closeEditMember = useGroupUIStore((state) => state.closeEditMember);
  const closeCreateGroup = useGroupUIStore((state) => state.closeCreateGroup);
  const closeEditGroup = useGroupUIStore((state) => state.closeEditGroup);

  // Memoize the return object to prevent unnecessary re-renders
  return useMemo(
    () => ({
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
    }),
    [
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
    ],
  );
}
