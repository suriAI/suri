import type { AttendanceGroup, AttendanceMember, AttendanceRecord, GroupType } from '../types';
import { getGroupTypeIcon } from '../utils/overlayRenderer';

interface AttendancePanelProps {
  attendanceEnabled: boolean;
  attendanceGroups: AttendanceGroup[];
  currentGroup: AttendanceGroup | null;
  recentAttendance: AttendanceRecord[];
  groupMembers: AttendanceMember[];
  handleSelectGroup: (group: AttendanceGroup) => void;
  setShowGroupManagement: (show: boolean) => void;
}

export function AttendancePanel({
  attendanceEnabled,
  attendanceGroups,
  currentGroup,
  recentAttendance,
  groupMembers,
  handleSelectGroup,
  setShowGroupManagement,
}: AttendancePanelProps) {
  if (!attendanceEnabled) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <h3 className="text-lg font-light px-4 pt-4 pb-2 flex-shrink-0">Recent Logs</h3>
        <div className="flex-1 px-4 pb-4 overflow-y-auto space-y-2 min-h-0">
          <div className="text-white/50 text-sm text-center py-4">
            No logs yet
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Fixed Header Section - Active Group Selection */}
      {attendanceGroups.length > 0 && (
        <div className="p-4 pb-2 flex-shrink-0">
          <select
            value={currentGroup?.id || ''}
            onChange={(e) => {
              if (e.target.value === 'create-new') {
                setShowGroupManagement(true);
                return;
              }
              const group = attendanceGroups.find(g => g.id === e.target.value);
              if (group) handleSelectGroup(group);
            }}
            className="w-full bg-white/[0.05] text-white text-sm border border-white/[0.1] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
          >
            <option value="create-new" className="bg-black text-white">
              ➕ Create New Group
            </option>
            <option disabled className="bg-black text-gray-500">
            </option>
            {attendanceGroups.map(group => (
              <option key={group.id} value={group.id} className="bg-black text-white">
                {getGroupTypeIcon(group.type)} {group.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Scrollable Content Section */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0 custom-scroll">
        {/* Recent Attendance */}
        {recentAttendance.length > 0 && (
          <div>
            <div className="space-y-1">
              {recentAttendance.slice(0, 10).map(record => {
                const member = groupMembers.find(m => m.person_id === record.person_id);
                return (
                  <div key={record.id} className="text-xs bg-white/[0.02] border border-white/[0.05] rounded p-2">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium">{member?.name || record.person_id}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${record.is_manual ? 'bg-orange-600/20 text-orange-300 border border-orange-500/30' : 'bg-cyan-600/20 text-cyan-300 border border-cyan-500/30'}`}>
                          {record.is_manual ? 'Manual' : 'Auto'}
                        </span>
                      </div>
                      <span className="text-white/50">
                        {record.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-white/40 text-xs">
                        {(record.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* No data states - Outside scroll area */}
      {attendanceGroups.length === 0 && (
        <div className="p-4 text-white/50 text-sm text-center flex-shrink-0">
          No groups created yet. <br /> Click "Create Group" to create one.

          <button
            onClick={() => setShowGroupManagement(true)}
            className="mt-2 px-3 py-1 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 rounded text-xs transition-colors"
          >
            Create Group
          </button>
        </div>
      )}
    </div>
  );
}

