import { useState, useEffect, useCallback, useMemo } from 'react';
import { attendanceManager } from '../../../services/AttendanceManager.js';
import { getLocalDateString } from '../../../utils/dateUtils.js';
import { generateDisplayNames } from '../../../utils/displayNameUtils.js';
import type {
  AttendanceGroup,
  AttendanceMember,
  AttendanceSession
} from '../../../types/recognition.js';

interface MembersProps {
  group: AttendanceGroup;
  members: AttendanceMember[];
  onMembersChange: () => void;
  onEdit: (member: AttendanceMember) => void;
  onAdd: () => void;
}

export function Members({ group, members, onMembersChange, onEdit, onAdd }: MembersProps) {
  const [todaySessions, setTodaySessions] = useState<AttendanceSession[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);

  // Generate display names with auto-differentiation for duplicates
  const membersWithDisplayNames = useMemo(() => {
    return generateDisplayNames(members);
  }, [members]);

  const loadSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const todayStr = getLocalDateString();
      const sessions = await attendanceManager.getSessions({
        group_id: group.id,
        start_date: todayStr,
        end_date: todayStr
      });
      setTodaySessions(sessions);
    } catch (err) {
      console.error('Error loading sessions:', err);
    } finally {
      setIsLoadingSessions(false);
    }
  }, [group.id]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleRemoveMember = async (personId: string) => {
    if (!confirm('Remove this member from the group?')) {
      return;
    }

    try {
      await attendanceManager.removeMember(personId);
      onMembersChange();
    } catch (err) {
      console.error('Error removing member:', err);
      alert(err instanceof Error ? err.message : 'Failed to remove member');
    }
  };

  return (
    <section className="h-full flex flex-col overflow-hidden space-y-4">
      <div className="flex items-center justify-between flex-shrink-0">
        <h2 className="text-lg font-semibold">Members</h2>
        <button
          onClick={onAdd}
          className="btn-success text-xs px-2 py-1"
        >
          Add member
        </button>
      </div>

      {members.length > 0 && (
        <div className="flex-1 overflow-y-auto custom-scroll overflow-x-hidden min-h-0">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 pr-2">
            {membersWithDisplayNames.map(member => {
            const session = todaySessions.find(item => item.person_id === member.person_id);

            // While loading, show loading state
            const statusLabel = isLoadingSessions
              ? '...'
              : session?.status === 'present' && session?.is_late
                ? `Late (${session.late_minutes ?? 0}m)`
                : session?.status === 'present'
                  ? 'Present'
                  : session?.status === 'absent'
                    ? 'Absent'
                    : 'No record';

            const statusClass = isLoadingSessions
              ? 'bg-white/5 text-white/30 border border-white/10'
              : session?.status === 'present' && session?.is_late
                ? 'bg-amber-500/20 text-amber-200 border border-amber-400/40'
                : session?.status === 'present'
                  ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/40'
                  : 'bg-rose-500/20 text-rose-200 border border-rose-400/40';

            return (
              <div key={member.person_id} className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-semibold truncate">{member.displayName}</div>
                    {member.role && (
                      <div className="text-xs text-white/50 mt-0.5">
                        {member.role}
                      </div>
                    )}
                    {member.email && (
                      <div className="text-xs text-white/40 mt-0.5">
                        {member.email}
                      </div>
                    )}
                  </div>
                  <div className={`px-2 py-1 rounded-lg text-xs font-medium whitespace-nowrap ${statusClass}`}>
                    {statusLabel}
                  </div>
                </div>

                <div className="flex gap-2 text-xs">
                  <button
                    onClick={() => onEdit(member)}
                    className="btn-secondary text-xs flex-1 px-2 py-1"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleRemoveMember(member.person_id)}
                    className="btn-error text-xs flex-1 px-2 py-1"
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
          </div>
        </div>
      )}
    </section>
  );
}

