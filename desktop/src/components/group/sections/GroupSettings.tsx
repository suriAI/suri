import { attendanceManager } from "../../../services/AttendanceManager.js";
import type { AttendanceGroup } from "../../../types/recognition.js";

interface GroupSettingsProps {
  group: AttendanceGroup;
  memberCount: number;
  onEdit: () => void;
  onDelete: () => void;
  onExportData: () => void;
  onRefresh: () => void;
}

const formatDate = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  const month = date.toLocaleDateString("en-US", { month: "long" });
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month} ${day}, ${year}`;
};

const toDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value);

export function GroupSettings({
  group,
  memberCount,
  onEdit,
  onDelete,
  onExportData,
  onRefresh,
}: GroupSettingsProps) {
  const handleCleanupOldData = async () => {
    if (!confirm("Remove attendance records older than 30 days?")) {
      return;
    }

    try {
      await attendanceManager.cleanupOldData(30);
      onRefresh();
    } catch (err) {
      console.error("Error cleaning data:", err);
      alert(err instanceof Error ? err.message : "Failed to clean up old data");
    }
  };

  const groupCreatedAt = toDate(group.created_at);

  return (
    <section className="h-full flex flex-col overflow-hidden space-y-4">
      <div className="flex-1 overflow-y-auto custom-scroll overflow-x-hidden min-h-0 pr-2 space-y-4">
        {/* Group Information Card */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold">{group.name}</h3>
            </div>
            <button
              onClick={onEdit}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 text-white/90 text-xs transition-colors"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
                  strokeWidth={2}
                />
              </svg>
              Edit
            </button>
          </div>

          {group.description && (
            <p className="text-sm text-white/70 mb-4 pb-4 border-b border-white/5">
              {group.description}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-white/5 p-3 border border-white/10">
              <div className="text-xs text-white/50 mb-1">Total Members</div>
              <div className="text-xl font-light text-white">{memberCount}</div>
            </div>
            <div className="rounded-lg bg-white/5 p-3 border border-white/10">
              <div className="text-xs text-white/50 mb-1">Created</div>
              <div className="text-sm font-light text-white">
                {groupCreatedAt ? formatDate(groupCreatedAt) : "—"}
              </div>
            </div>
          </div>
        </div>

        {/* Data Management Tools */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <h3 className="text-sm font-semibold mb-3 text-white/90">
            Data Management
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <button
              onClick={handleCleanupOldData}
              className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 text-white/90 transition-colors text-xs flex items-center justify-center gap-1.5"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                  strokeWidth={2}
                />
              </svg>
              Clean Old Records
            </button>
            <button
              onClick={onExportData}
              className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 text-white/90 transition-colors text-xs flex items-center justify-center gap-1.5"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                  strokeWidth={2}
                />
              </svg>
              Export Data
            </button>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <h3 className="text-sm font-semibold mb-3 text-white/90">
            Danger Zone
          </h3>
          <p className="text-xs text-white/60 mb-3">
            Deleting this group will permanently remove all members and
            attendance records. This action cannot be undone.
          </p>
          <button
            onClick={onDelete}
            className="w-full px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 transition-colors text-xs flex items-center justify-center gap-1.5"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                strokeWidth={2}
              />
            </svg>
            Delete Group
          </button>
        </div>
      </div>
    </section>
  );
}
