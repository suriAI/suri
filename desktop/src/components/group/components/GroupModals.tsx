import type { AttendanceGroup, AttendanceMember } from '../../../types/recognition';

import { AddMember } from '../modals/AddMember';
import { EditMember } from '../modals/EditMember';
import { CreateGroup } from '../modals/CreateGroup';
import { EditGroup } from '../modals/EditGroup';

interface GroupModalsProps {
  selectedGroup: AttendanceGroup | null;
  showAddMemberModal: boolean;
  showEditMemberModal: boolean;
  showCreateGroupModal: boolean;
  showEditGroupModal: boolean;
  editingMember: AttendanceMember | null;
  onCloseAddMember: () => void;
  onCloseEditMember: () => void;
  onCloseCreateGroup: () => void;
  onCloseEditGroup: () => void;
  onMemberSuccess: () => void;
  onGroupSuccess: (group?: AttendanceGroup) => void;
}

export function GroupModals({
  selectedGroup,
  showAddMemberModal,
  showEditMemberModal,
  showCreateGroupModal,
  showEditGroupModal,
  editingMember,
  onCloseAddMember,
  onCloseEditMember,
  onCloseCreateGroup,
  onCloseEditGroup,
  onMemberSuccess,
  onGroupSuccess,
}: GroupModalsProps) {
  return (
    <>
      {showAddMemberModal && selectedGroup && (
        <AddMember
          group={selectedGroup}
          onClose={onCloseAddMember}
          onSuccess={onMemberSuccess}
        />
      )}

      {showEditMemberModal && editingMember && (
        <EditMember
          member={editingMember}
          onClose={onCloseEditMember}
          onSuccess={onMemberSuccess}
        />
      )}

      {showCreateGroupModal && (
        <CreateGroup
          onClose={onCloseCreateGroup}
          onSuccess={(newGroup) => onGroupSuccess(newGroup)}
        />
      )}

      {showEditGroupModal && selectedGroup && (
        <EditGroup
          group={selectedGroup}
          onClose={onCloseEditGroup}
          onSuccess={() => onGroupSuccess()}
        />
      )}
    </>
  );
}

