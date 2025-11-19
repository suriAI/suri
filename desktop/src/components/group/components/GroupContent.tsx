import { useMemo, memo } from "react";
import { useGroupStore, useGroupUIStore } from "../stores";
import {
  GroupSettings,
  Members,
  Overview,
  Registration,
  Reports,
} from "../sections";
import { EmptyState } from "../shared";

interface GroupContentProps {
  onMembersChange: () => void;
  onRegistrationSourceChange?: (source: "upload" | "camera" | null) => void;
  registrationSource?: "upload" | "camera" | null;
  onRegistrationModeChange?: (mode: "single" | "bulk" | "queue" | null) => void;
  registrationMode?: "single" | "bulk" | "queue" | null;
  deselectMemberTrigger?: number;
  onHasSelectedMemberChange?: (hasSelectedMember: boolean) => void;
  onDaysTrackedChange?: (daysTracked: number, loading: boolean) => void;
  onExportHandlersReady?: (handlers: {
    exportCSV: () => void;
    print: () => void;
  }) => void;
}

function GroupContentComponent({
  onMembersChange,
  onRegistrationSourceChange,
  registrationSource,
  onRegistrationModeChange,
  registrationMode,
  deselectMemberTrigger,
  onHasSelectedMemberChange,
  onDaysTrackedChange,
  onExportHandlersReady,
}: GroupContentProps) {
  // Zustand stores - use selectors to prevent unnecessary re-renders
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
  
  // Handlers that use store actions
  const handleMembersChange = () => {
    if (selectedGroup) {
      fetchGroupDetails(selectedGroup.id);
    }
    onMembersChange();
  };

  // Show EmptyState if no selectedGroup OR if selectedGroup doesn't exist in groups list (was deleted)
  // Get groups from store only when needed to check existence
  const selectedGroupId = selectedGroup?.id;
  const hasSelectedGroup = useMemo(() => {
    if (!selectedGroup || !selectedGroupId) return false;
    // Get fresh groups from store to check existence
    const currentGroups = useGroupStore.getState().groups;
    return currentGroups.some((g) => g.id === selectedGroupId);
  }, [selectedGroup, selectedGroupId]);
  const hasGroups = groupsLength > 0;
  
  if (!hasSelectedGroup || !selectedGroup) {
    return (
      <div className="h-full px-6 pt-6">
        <EmptyState
          onCreateGroup={openCreateGroup}
          hasGroups={hasGroups}
        />
      </div>
    );
  }

  // At this point, selectedGroup is guaranteed to be non-null and exist in groups
  return (
    <>
      {activeSection === "overview" && (
        <Overview group={selectedGroup} members={members} />
      )}

      {activeSection === "reports" && (
        <Reports
          group={selectedGroup}
          onDaysTrackedChange={onDaysTrackedChange}
          onExportHandlersReady={onExportHandlersReady}
        />
      )}

      {activeSection === "members" && (
        <Members
          group={selectedGroup}
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
          onSourceChange={onRegistrationSourceChange}
          registrationSource={registrationSource}
          onModeChange={onRegistrationModeChange}
          registrationMode={registrationMode}
          deselectMemberTrigger={deselectMemberTrigger}
          onHasSelectedMemberChange={onHasSelectedMemberChange}
        />
      )}

      {activeSection === "settings" && (
        <GroupSettings
          group={selectedGroup}
          memberCount={members.length}
          onEdit={openEditGroup}
          onDelete={async () => {
            if (!selectedGroup) return;
            if (
              !confirm(
                `Delete group "${selectedGroup.name}"? This will remove all members and attendance records.`,
              )
            ) {
              return;
            }
            const groupId = selectedGroup.id;
            await useGroupStore.getState().deleteGroup(groupId);
            // After deletion, selectedGroup should be null and EmptyState will show
            // No need to call handleMembersChange as store is already updated
          }}
          onExportData={exportData}
          onRefresh={handleMembersChange}
        />
      )}
    </>
  );
}

export const GroupContent = memo(GroupContentComponent);
