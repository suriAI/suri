import type { AttendanceGroup } from "../../../types/recognition";

import { useGroupStore } from "../stores";
import { useGroupModals } from "../hooks";
import { AddMember, CreateGroup, EditGroup, EditMember } from "../modals";

interface GroupModalsProps {
  onMemberSuccess: () => void;
  onGroupSuccess: (group?: AttendanceGroup) => void;
}

export function GroupModals({
  onMemberSuccess,
  onGroupSuccess,
}: GroupModalsProps) {
  // Zustand stores
  const { selectedGroup, fetchGroups, setSelectedGroup, members } =
    useGroupStore();
  const {
    showAddMemberModal,
    showEditMemberModal,
    showCreateGroupModal,
    showEditGroupModal,
    editingMember,
    closeAddMember,
    closeEditMember,
    closeCreateGroup,
    closeEditGroup,
  } = useGroupModals();
  return (
    <>
      {showAddMemberModal && selectedGroup && (
        <AddMember
          group={selectedGroup}
          existingMembers={members}
          onClose={closeAddMember}
          onSuccess={onMemberSuccess}
        />
      )}

      {showEditMemberModal && editingMember && (
        <EditMember
          member={editingMember}
          onClose={closeEditMember}
          onSuccess={onMemberSuccess}
        />
      )}

      {showCreateGroupModal && (
        <CreateGroup
          onClose={closeCreateGroup}
          onSuccess={(newGroup) => {
            fetchGroups();
            if (newGroup) {
              setSelectedGroup(newGroup);
            }
            onGroupSuccess(newGroup);
          }}
        />
      )}

      {showEditGroupModal && selectedGroup && (
        <EditGroup
          group={selectedGroup}
          onClose={closeEditGroup}
          onSuccess={() => {
            fetchGroups();
            onGroupSuccess();
          }}
        />
      )}
    </>
  );
}
