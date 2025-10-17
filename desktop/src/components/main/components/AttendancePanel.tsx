import { useState, useMemo } from 'react';
import type { AttendanceGroup, AttendanceMember, AttendanceRecord } from '../types';
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

type SortField = 'time' | 'name';
type SortOrder = 'asc' | 'desc';

export function AttendancePanel({
  attendanceEnabled,
  attendanceGroups,
  currentGroup,
  recentAttendance,
  groupMembers,
  handleSelectGroup,
  setShowGroupManagement,
}: AttendancePanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('time');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [displayLimit, setDisplayLimit] = useState(10);

  // Filtered and sorted attendance records (memoized for performance)
  const processedRecords = useMemo(() => {
    let filtered = [...recentAttendance];

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(record => {
        const member = groupMembers.find(m => m.person_id === record.person_id);
        const name = member?.name || record.person_id;
        return name.toLowerCase().includes(query);
      });
    }

    // Sort
    filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'time':
          comparison = a.timestamp.getTime() - b.timestamp.getTime();
          break;
        case 'name': {
          const nameA = (groupMembers.find(m => m.person_id === a.person_id)?.name || a.person_id).toLowerCase();
          const nameB = (groupMembers.find(m => m.person_id === b.person_id)?.name || b.person_id).toLowerCase();
          comparison = nameA.localeCompare(nameB);
          break;
        }
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [recentAttendance, groupMembers, searchQuery, sortField, sortOrder]);

  // Visible records based on display limit
  const visibleRecords = useMemo(() => {
    return processedRecords.slice(0, displayLimit);
  }, [processedRecords, displayLimit]);

  const hasMore = processedRecords.length > displayLimit;

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

      {/* Search and Controls */}
      {recentAttendance.length > 0 && (
        <div className="px-4 pb-2 flex-shrink-0">
          {/* Search and Sort Controls - Side by Side */}
          <div className="flex items-center gap-3 text-[10px]">
            {/* Search - Left Side */}
            <input
              type="text"
              placeholder="Search by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-white/[0.05] text-white text-xs border border-white/[0.1] rounded px-3 py-1.5 placeholder:text-white/30 focus:border-blue-500 focus:outline-none"
            />

            {/* Sort Controls and Log Count - Right Side */}
            <div className="flex items-center space-x-2">
              <div className="flex items-center space-x-1">
                <select
                  value={sortField}
                  onChange={(e) => {
                    const field = e.target.value as SortField;
                    setSortField(field);
                    // Set smart defaults based on field type
                    if (field === 'time') {
                      setSortOrder('desc'); // Newest first
                    } else if (field === 'name') {
                      setSortOrder('asc'); // A-Z
                    }
                  }}
                  className="bg-white/[0.05] text-white text-[10px] border border-white/[0.1] rounded px-2 focus:border-blue-500 focus:outline-none"
                >
                  <option value="time" className="bg-black text-white">Time (Newest)</option>
                  <option value="name" className="bg-black text-white">Name (A-Z)</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Scrollable Content Section */}
      <div className="flex-1 overflow-y-auto mx-4 mt-2 mb-4 min-h-0 rounded-md custom-scroll">
        {/* Recent Attendance */}
        {visibleRecords.length > 0 ? (
          <>
            {visibleRecords.map(record => {
              const member = groupMembers.find(m => m.person_id === record.person_id);
              return (
                <div key={record.id} className="text-xs bg-white/[0.02] border border-white/[0.05] p-2">
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
                </div>
              );
            })}

            {/* Load More Button */}
            {hasMore && (
              <button
                onClick={() => setDisplayLimit(prev => prev + 10)}
                className="w-full mt-2 py-2 text-xs bg-white/[0.05] border border-white/[0.1] rounded text-white/70"
              >
                Load More ({processedRecords.length - displayLimit} more)
              </button>
            )}
          </>
        ) : searchQuery ? (
          <div className="text-white/50 text-sm text-center py-8">
            No results for "{searchQuery}"
          </div>
        ) : (
          <div className="text-white/50 text-sm text-center py-8">
            No attendance records yet
          </div>
        )}
      </div>

      {/* No data states - Outside scroll area */}
      {attendanceGroups.length === 0 && (
        <div className="p-4 text-white/50 text-sm text-center flex-shrink-0">
          No groups created yet. <br /> Click "Create Group" to create one.

          <button
            onClick={() => setShowGroupManagement(true)}
            className="btn-primary text-sm w-full px-3 py-2"
          >
            Create Group
          </button>
        </div>
      )}
    </div>
  );
}
