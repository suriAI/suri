import { useDialog } from "@/components/shared";
import { useMemo, memo } from "react";
import { useGroupStore, useGroupUIStore } from "@/components/group/stores";
import {
  GroupSettings,
  Members,
  Overview,
  Registration,
  Reports,
} from "@/components/group/sections";
import { EmptyState } from "@/components/group/shared";

interface GroupContentProps {
  onMembersChange: () => void;
  deselectMemberTrigger?: number;
  onHasSelectedMemberChange?: (hasSelectedMember: boolean) => void;
  onDaysTrackedChange?: (daysTracked: number, loading: boolean) => void;
  onExportHandlersReady?: (handlers: {
    exportCSV: () => void;
    print: () => void;
  }) => void;
  // Controlled registration props
  onRegistrationSourceChange?: (source: "upload" | "camera" | null) => void;
  registrationSource?: "upload" | "camera" | null;
  onRegistrationModeChange?: (mode: "single" | "bulk" | "queue" | null) => void;
  registrationMode?: "single" | "bulk" | "queue" | null;
}

function GroupContentComponent({
  onMembersChange,
  deselectMemberTrigger,
  onHasSelectedMemberChange,
  onDaysTrackedChange,
  onExportHandlersReady,
  onRegistrationSourceChange,
  registrationSource,
  onRegistrationModeChange,
  registrationMode,
}: GroupContentProps) {
  const dialog = useDialog();
  const selectedGroup = useGroupStore((state) => state.selectedGroup);
  const groupsLength = useGroupStore((state) => state.groups.length);
  const members = useGroupStore((state) => state.members);
  const fetchGroupDetails = useGroupStore((state) => state.fetchGroupDetails);
  const exportData = useGroupStore((state) => state.exportData);
  const activeSection = useGroupUIStore((state) => state.activeSection);
  const openAddMember = useGroupUIStore((state) => state.openAddMember);
  const openEditMember = useGroupUIStore((state) => state.openEditMember);
  const openEditGroup = useGroupUIStore((state) => state.openEditGroup);
  const openCreateGroup = useGroupUIStore((state) => state.openCreateGroup);

  const handleMembersChange = () => {
    if (selectedGroup) {
      fetchGroupDetails(selectedGroup.id);
    }
    onMembersChange();
  };

  const selectedGroupId = selectedGroup?.id;
  const hasSelectedGroup = useMemo(() => {
    if (!selectedGroup || !selectedGroupId) return false;
    const currentGroups = useGroupStore.getState().groups;
    return currentGroups.some((g) => g.id === selectedGroupId);
  }, [selectedGroup, selectedGroupId]);
  const hasGroups = groupsLength > 0;

  if (!hasSelectedGroup || !selectedGroup) {
    return (
      <div className="h-full px-6 pt-6">
        <EmptyState
          title={hasGroups ? "Select a group to continue" : "No groups yet"}
          action={{
            label: hasGroups ? "Create new group" : "Create your first group",
            onClick: openCreateGroup,
          }}
          className="h-full"
        />
      </div>
    );
  }

  return (
    <>
      {activeSection === "overview" && (
        <Overview
          group={selectedGroup}
          members={members}
          onAddMember={openAddMember}
        />
      )}

      {activeSection === "reports" && (
        <Reports
          group={selectedGroup}
          onDaysTrackedChange={onDaysTrackedChange}
          onExportHandlersReady={onExportHandlersReady}
          onAddMember={openAddMember}
        />
      )}

      {activeSection === "members" && (
        <Members
          members={members}
          onMembersChange={handleMembersChange}
          onEdit={openEditMember}
          onAdd={openAddMember}
        />
      )}

      {activeSection === "registration" && (
        <Registration
          group={selectedGroup}
          members={members}
          onRefresh={handleMembersChange}
          deselectMemberTrigger={deselectMemberTrigger}
          onHasSelectedMemberChange={onHasSelectedMemberChange}
          onAddMember={openAddMember}
          // Pass controlled props
          registrationSource={registrationSource}
          onRegistrationSourceChange={onRegistrationSourceChange}
          registrationMode={registrationMode}
          onRegistrationModeChange={onRegistrationModeChange}
        />
      )}

      {activeSection === "settings" && (
        <GroupSettings
          group={selectedGroup}
          memberCount={members.length}
          onEdit={openEditGroup}
          onDelete={async () => {
            if (!selectedGroup) return;
            const ok = await dialog.confirm({
              title: "Delete group",
              message: `Delete group "${selectedGroup.name}"? This will remove all members and attendance records.`,
              confirmText: "Delete group",
              cancelText: "Cancel",
              confirmVariant: "danger",
            });
            if (!ok) return;
            const groupId = selectedGroup.id;
            await useGroupStore.getState().deleteGroup(groupId);
          }}
          onExportData={exportData}
          onRefresh={handleMembersChange}
        />
      )}
    </>
  );
}

export const GroupContent = memo(GroupContentComponent);
