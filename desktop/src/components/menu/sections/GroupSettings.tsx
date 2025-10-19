import { attendanceManager } from '../../../services/AttendanceManager.js';
import type {
  AttendanceGroup,
  GroupType
} from '../../../types/recognition.js';

interface GroupSettingsProps {
  group: AttendanceGroup;
  groups: AttendanceGroup[];
  memberCount: number;
  onEdit: () => void;
  onDelete: () => void;
  onGroupSelect: (group: AttendanceGroup) => void;
  onExportData: () => void;
  onRefresh: () => void;
}

const getGroupTypeIcon = (type: GroupType): string => {
  switch (type) {
    case 'employee':
      return '👔';
    case 'student':
      return '🎓';
    case 'visitor':
      return '👤';
    case 'general':
    default:
      return '';
  }
};

const formatDate = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  const month = date.toLocaleDateString('en-US', { month: 'long' });
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month} ${day}, ${year}`;
};

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

export function GroupSettings({ 
  group, 
  groups, 
  memberCount, 
  onEdit, 
  onDelete, 
  onGroupSelect,
  onExportData,
  onRefresh
}: GroupSettingsProps) {
  const handleCleanupOldData = async () => {
    if (!confirm('Remove attendance records older than 30 days?')) {
      return;
    }

    try {
      await attendanceManager.cleanupOldData(30);
      onRefresh();
    } catch (err) {
      console.error('Error cleaning data:', err);
      alert(err instanceof Error ? err.message : 'Failed to clean up old data');
    }
  };

  const groupCreatedAt = toDate(group.created_at);

  return (
    <section className="h-full flex flex-col overflow-hidden space-y-4">
      <h2 className="text-lg font-semibold flex-shrink-0">Group Settings</h2>

      <div className="flex-1 overflow-y-auto custom-scroll overflow-x-hidden min-h-0 pr-2 space-y-4">
        {/* Group Information Card */}
        <div className="rounded-xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center text-2xl">
              {getGroupTypeIcon(group.type)}
            </div>
            <div>
              <h3 className="text-lg font-semibold">{group.name}</h3>
              <p className="text-xs text-white/50 capitalize">{group.type}</p>
            </div>
          </div>
          <button
            onClick={onEdit}
            className="btn-secondary text-xs px-2 py-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" strokeWidth={2}/>
            </svg>
            Edit
          </button>
        </div>

        {group.description && (
          <p className="text-sm text-white/70 mb-4 pb-4 border-b border-white/5">{group.description}</p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-white/5 p-3 border border-white/10">
            <div className="text-xs text-white/50 mb-1">Total Members</div>
            <div className="text-xl font-light text-white">{memberCount}</div>
          </div>
          <div className="rounded-lg bg-white/5 p-3 border border-white/10">
            <div className="text-xs text-white/50 mb-1">Created</div>
            <div className="text-sm font-light text-white">
              {groupCreatedAt ? formatDate(groupCreatedAt) : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* All Groups List */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" strokeWidth={2}/>
          </svg>
          All Groups
        </h3>
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {groups.map(g => {
            const isSelected = group.id === g.id;
            return (
              <div
                key={g.id}
                className={`rounded-lg p-3 border transition-all cursor-pointer ${
                  isSelected
                    ? 'border-blue-500/40 bg-blue-500/10'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
                onClick={() => onGroupSelect(g)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-lg">{getGroupTypeIcon(g.type)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{g.name}</div>
                      <div className="text-xs text-white/40 capitalize">{g.type}</div>
                    </div>
                  </div>
                  {isSelected && (
                    <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Data Management Tools */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" strokeWidth={2}/>
          </svg>
          Data Management
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <button
            onClick={handleCleanupOldData}
            className="px-3 py-2 rounded-lg bg-amber-500/20 border border-amber-400/40 text-amber-100 hover:bg-amber-500/30 transition-colors text-xs flex items-center justify-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" strokeWidth={2}/>
            </svg>
            Clean Old Records
          </button>
          <button
            onClick={onExportData}
            className="btn-error text-xs px-2 py-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" strokeWidth={2}/>
            </svg>
            Export Data
          </button>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="rounded-xl border border-rose-500/30 bg-gradient-to-br from-rose-500/10 to-transparent p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-rose-200">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" strokeWidth={2}/>
          </svg>
          Danger Zone
        </h3>
        <p className="text-xs text-rose-200/60 mb-3">
          Deleting this group will permanently remove all members and attendance records. This action cannot be undone.
        </p>
        <button
          onClick={onDelete}
          className="w-full px-3 py-2 rounded-lg bg-rose-500/20 border border-rose-400/40 text-rose-100 hover:bg-rose-500/30 transition-colors text-xs flex items-center justify-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" strokeWidth={2}/>
          </svg>
          Delete Group
        </button>
      </div>
      </div>
    </section>
  );
}

