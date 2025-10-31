import type { AttendanceGroup, AttendanceMember } from '../../../types/recognition';
import type { GroupSection } from '../types';

import { Overview } from '../sections/Overview';
import { Members } from '../sections/Members';
import { Reports } from '../sections/Reports';
import { Registration } from '../sections/Registration';
import { GroupSettings } from '../sections/GroupSettings';
import { EmptyState } from '../shared/EmptyState';

interface GroupContentProps {
  selectedGroup: AttendanceGroup | null;
  groups: AttendanceGroup[];
  members: AttendanceMember[];
  activeSection: GroupSection;
  onMembersChange: () => void;
  onEditMember: (member: AttendanceMember) => void;
  onAddMember: () => void;
  onEditGroup: () => void;
  onDeleteGroup: () => void;
  onExportData: () => void;
  onCreateGroup: () => void;
}

export function GroupContent({
  selectedGroup,
  groups,
  members,
  activeSection,
  onMembersChange,
  onEditMember,
  onAddMember,
  onEditGroup,
  onDeleteGroup,
  onExportData,
  onCreateGroup,
}: GroupContentProps) {
  if (!selectedGroup) {
    return (
      <div className="h-full px-6 py-6">
        <EmptyState onCreateGroup={onCreateGroup} hasGroups={(groups?.length ?? 0) > 0} />
      </div>
    );
  }

  return (
    <div className="h-full px-6 py-6">
      {activeSection === 'overview' && (
        <Overview group={selectedGroup} members={members} />
      )}

      {activeSection === 'members' && (
        <Members
          group={selectedGroup}
          members={members}
          onMembersChange={onMembersChange}
          onEdit={onEditMember}
          onAdd={onAddMember}
        />
      )}

      {activeSection === 'reports' && <Reports group={selectedGroup} />}

      {activeSection === 'registration' && (
        <Registration
          group={selectedGroup}
          members={members}
          onRefresh={onMembersChange}
        />
      )}

      {activeSection === 'settings' && (
        <GroupSettings
          group={selectedGroup}
          memberCount={members.length}
          onEdit={onEditGroup}
          onDelete={onDeleteGroup}
          onExportData={onExportData}
          onRefresh={onMembersChange}
        />
      )}
    </div>
  );
}

