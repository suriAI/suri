import { useState, useMemo, useEffect, memo, useCallback } from 'react';
import { createDisplayNameMap } from '../../../utils/displayNameUtils.js';
import type { AttendanceGroup, AttendanceMember, AttendanceRecord } from '../types';

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

// Memoized attendance record item to prevent unnecessary re-renders
const AttendanceRecordItem = memo(({ 
  record, 
  displayName 
}: { 
  record: AttendanceRecord; 
  displayName: string;
}) => (
  <div className="text-xs bg-white/[0.02] border-b border-white/[0.05] p-2">
    <div className="flex justify-between items-center">
      <div className="flex items-center space-x-2">
        <span className="font-medium">{displayName}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${record.is_manual ? 'bg-orange-600/20 text-orange-300 border border-orange-500/30' : 'bg-cyan-600/20 text-cyan-300 border border-cyan-500/30'}`}>
          {record.is_manual ? 'Manual' : 'Auto'}
        </span>
      </div>
      <span className="text-white/50">
        {record.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  </div>
));

AttendanceRecordItem.displayName = 'AttendanceRecordItem';

export const AttendancePanel = memo(function AttendancePanel({
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
  const [displayLimit, setDisplayLimit] = useState(20);

  // Memoize handlers to prevent recreation
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  const handleSortFieldChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const field = e.target.value as SortField;
    setSortField(field);
    // Set smart defaults based on field type
    if (field === 'time') {
      setSortOrder('desc'); // Newest first
    } else if (field === 'name') {
      setSortOrder('asc'); // A-Z
    }
  }, []);

  const handleLoadMore = useCallback(() => {
    setDisplayLimit(prev => prev + 20);
  }, []);
  
  // Create display name map for members
  const displayNameMap = useMemo(() => {
    return createDisplayNameMap(groupMembers);
  }, [groupMembers]);

  // Filtered and sorted attendance records (memoized for performance)
  const processedRecords = useMemo(() => {
    let filtered = [...recentAttendance];

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(record => {
        const displayName = displayNameMap.get(record.person_id) || 'Unknown';
        return displayName.toLowerCase().includes(query);
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
          const nameA = (displayNameMap.get(a.person_id) || 'Unknown').toLowerCase();
          const nameB = (displayNameMap.get(b.person_id) || 'Unknown').toLowerCase();
          comparison = nameA.localeCompare(nameB);
          break;
        }
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [recentAttendance, displayNameMap, searchQuery, sortField, sortOrder]);

  // Visible records with pagination for performance
  const visibleRecords = useMemo(() => {
    return processedRecords.slice(0, displayLimit);
  }, [processedRecords, displayLimit]);

  const hasMore = processedRecords.length > displayLimit;

  // Reset display limit when search query or sort changes
  useEffect(() => {
    setDisplayLimit(20);
  }, [searchQuery, sortField, sortOrder]);

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
      {attendanceGroups.length > 0 ? (
        <div className="p-2 pb-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <select
                value={currentGroup?.id || ''}
                onChange={(e) => {
                  const group = attendanceGroups.find(g => g.id === e.target.value);
                  if (group) handleSelectGroup(group);
                }}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 pr-8 text-xs text-white focus:outline-none focus:border-white/20 transition-colors appearance-none cursor-pointer"
                style={{ colorScheme: 'dark' }}
              >
                {attendanceGroups.map(group => (
                  <option key={group.id} value={group.id} className="bg-black text-white">
                    {group.name}
                  </option>
                ))}
              </select>
              {/* Custom dropdown arrow */}
              <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                <svg
                  className="w-3 h-3 text-white/50 transition-colors duration-200"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
            <button
              onClick={() => setShowGroupManagement(true)}
              className="text-lg px-2 py-1 flex-shrink-0 border-none bg-none"
              title="Create New Group"
            >
              +
            </button>
          </div>
        </div>
      ) : (
        <div className="p-4 text-center flex-shrink-0">
          <div className="text-white/50 text-sm mb-3">
            No groups created yet
          </div>
          <button
            onClick={() => setShowGroupManagement(true)}
            className="btn-success text-xs px-2 py-1"
          >
            New Group
          </button>
        </div>
      )}

      {/* Search and Controls */}
      {recentAttendance.length > 0 && (
        <div className="px-2 pb-2 flex-shrink-0">
          {/* Search and Sort Controls - Side by Side */}
          <div className="flex items-center gap-3 text-[8px]">
            {/* Search - Left Side */}
            <input
              type="text"
              placeholder="Search by name..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="flex-1 bg-white/[0.05] text-white text-xs border border-white/[0.1] rounded px-3 py-1.5 placeholder:text-white/30 focus:border-blue-500 focus:outline-none"
            />

            {/* Sort Controls and Log Count - Right Side */}
            <div className="flex items-center space-x-2">
              <div className="flex items-center space-x-1">
                <select
                  value={sortField}
                  onChange={handleSortFieldChange}
                  className="bg-white/[0.05] text-white text-[8px] border border-white/[0.1] rounded px-2 focus:border-blue-500 focus:outline-none"
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
      <div className="flex-1 overflow-y-auto min-h-0 custom-scroll">
        {/* Recent Attendance */}
        {visibleRecords.length > 0 ? (
          <>
            {visibleRecords.map(record => {
              const displayName = displayNameMap.get(record.person_id) || 'Unknown';
              return (
                <AttendanceRecordItem 
                  key={record.id} 
                  record={record} 
                  displayName={displayName} 
                />
              );
            })}

            {/* Load More Button */}
            {hasMore && (
              <div className="px-2 py-2">
                <button
                  onClick={handleLoadMore}
                  className="w-full py-2 text-xs bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.1] rounded text-white/70 transition-colors"
                >
                  Load More ({processedRecords.length - displayLimit} remaining)
                </button>
              </div>
            )}
            
          </>
        ) : searchQuery ? (
          <div className="text-white/50 text-sm text-center py-8">
            No results for "{searchQuery}"
          </div>
        ) : groupMembers.length === 0 && currentGroup ? (
          <div className="flex flex-col items-center justify-center py-8 px-4 space-y-3">
            <div className="text-white/40 text-xs text-center">
              <div className="mb-1">No members in this group yet</div>
            </div>
          </div>
        ) : (
          <div className="text-white/50 text-xs text-center py-8">
            NO RECORDS FOUND
          </div>
        )}
      </div>
    </div>
  );
});
