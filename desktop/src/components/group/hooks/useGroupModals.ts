import { useState, useCallback } from 'react';
import type { AttendanceMember } from '../../../types/recognition';

interface UseGroupModalsReturn {
  // Modal visibility states
  showAddMemberModal: boolean;
  showEditMemberModal: boolean;
  showCreateGroupModal: boolean;
  showEditGroupModal: boolean;
  
  // Modal data
  editingMember: AttendanceMember | null;
  
  // Modal actions
  openAddMember: () => void;
  openEditMember: (member: AttendanceMember) => void;
  openCreateGroup: () => void;
  openEditGroup: () => void;
  closeAddMember: () => void;
  closeEditMember: () => void;
  closeCreateGroup: () => void;
  closeEditGroup: () => void;
}

export function useGroupModals(): UseGroupModalsReturn {
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showEditMemberModal, setShowEditMemberModal] = useState(false);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [showEditGroupModal, setShowEditGroupModal] = useState(false);
  const [editingMember, setEditingMember] = useState<AttendanceMember | null>(null);

  const openAddMember = useCallback(() => {
    setShowAddMemberModal(true);
  }, []);

  const openEditMember = useCallback((member: AttendanceMember) => {
    setEditingMember(member);
    setShowEditMemberModal(true);
  }, []);

  const openCreateGroup = useCallback(() => {
    setShowCreateGroupModal(true);
  }, []);

  const openEditGroup = useCallback(() => {
    setShowEditGroupModal(true);
  }, []);

  const closeAddMember = useCallback(() => {
    setShowAddMemberModal(false);
  }, []);

  const closeEditMember = useCallback(() => {
    setEditingMember(null);
    setShowEditMemberModal(false);
  }, []);

  const closeCreateGroup = useCallback(() => {
    setShowCreateGroupModal(false);
  }, []);

  const closeEditGroup = useCallback(() => {
    setShowEditGroupModal(false);
  }, []);

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

