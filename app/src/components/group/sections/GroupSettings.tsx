import type { AttendanceGroup } from "@/types/recognition";

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
}: GroupSettingsProps) {
  const groupCreatedAt = toDate(group.created_at);

  return (
    <section className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto custom-scroll overflow-x-hidden min-h-0 p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-start justify-between mb-6">
            <div className="flex-1 min-w-0">
              <h2 className="text-2xl font-semibold text-white mb-2 truncate">
                {group.name}
              </h2>
              {group.description && (
                <p className="text-sm text-white/60 leading-relaxed max-w-2xl">
                  {group.description}
                </p>
              )}
            </div>
            <button
              onClick={onEdit}
              className="ml-4 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 hover:border-white/20 text-white/90 text-sm font-medium transition-all duration-200 flex items-center gap-2 flex-shrink-0"
            >
              <svg
                className="w-4 h-4"
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
              Edit Group
            </button>
          </div>

          {/* Stats Grid - Enhanced */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
            <div className="rounded-xl bg-white/5 border border-white/10 p-5 hover:bg-white/[0.07] transition-colors duration-200">
              <div className="flex items-center gap-3 mb-2">
                <svg
                  className="w-5 h-5 text-white/70"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
                    strokeWidth={2}
                  />
                </svg>

                <div>
                  <div className="text-xs font-medium text-white/50 uppercase tracking-wider">
                    Total Members
                  </div>
                  <div className="text-3xl font-light text-white mt-1">
                    {memberCount}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-white/5 border border-white/10 p-5 hover:bg-white/[0.07] transition-colors duration-200">
              <div className="flex items-center gap-3 mb-2">
                <svg
                  className="w-5 h-5 text-white/70"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
                    strokeWidth={2}
                  />
                </svg>

                <div>
                  <div className="text-xs font-medium text-white/50 uppercase tracking-wider">
                    Created
                  </div>
                  <div className="text-sm font-medium text-white/90 mt-1">
                    {groupCreatedAt ? formatDate(groupCreatedAt) : "—"}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Danger Zone - Enhanced */}
          <div className="rounded-2xl border border-red-500/20 bg-gradient-to-br from-red-500/[0.05] to-red-500/[0.02] p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
                <svg
                  className="w-5 h-5 text-red-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                    strokeWidth={2}
                  />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-white mb-2">
                  Danger Zone
                </h3>
                <p className="text-xs text-white/70 leading-relaxed mb-4">
                  Deleting this group will permanently remove all members and
                  attendance records. This action cannot be undone.
                </p>
                <button
                  onClick={onDelete}
                  className="px-5 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 hover:border-red-500/40 text-red-400 hover:text-red-300 transition-all duration-200 text-sm font-medium flex items-center gap-2"
                >
                  <svg
                    className="w-4 h-4"
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
          </div>
        </div>
      </div>
    </section>
  );
}
