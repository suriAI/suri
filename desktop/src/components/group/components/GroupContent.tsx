import { useGroupStore, useGroupUIStore } from "../stores";
import { useGroupModals } from "../hooks";
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

export function GroupContent({
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
  // Zustand stores
  const { selectedGroup, groups, members, fetchGroupDetails, exportData } =
    useGroupStore();
  const { activeSection } = useGroupUIStore();
  const { openAddMember, openEditMember, openEditGroup, openCreateGroup } =
    useGroupModals();
  // Handlers that use store actions
  const handleMembersChange = () => {
    if (selectedGroup) {
      fetchGroupDetails(selectedGroup.id);
    }
    onMembersChange();
  };

  if (!selectedGroup) {
    return (
      <div className="h-full px-6 pt-6">
        <EmptyState
          onCreateGroup={openCreateGroup}
          hasGroups={(groups?.length ?? 0) > 0}
        />
      </div>
    );
  }

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
            await useGroupStore.getState().deleteGroup(selectedGroup.id);
            handleMembersChange();
          }}
          onExportData={exportData}
          onRefresh={handleMembersChange}
        />
      )}
    </>
  );
}
