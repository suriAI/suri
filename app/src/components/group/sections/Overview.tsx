import { useState, useEffect, useCallback, useMemo } from "react";
import { attendanceManager } from "@/services";
import { createDisplayNameMap } from "@/utils";
import { Tooltip } from "@/components/shared";
import { StatsCard, EmptyState } from "@/components/group/shared";
import type {
  AttendanceGroup,
  AttendanceMember,
  AttendanceStats,
  AttendanceRecord,
} from "@/types/recognition";

interface OverviewProps {
  group: AttendanceGroup;
  members: AttendanceMember[];
  onAddMember?: () => void;
}

const toDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value);

const formatTime = (value: Date | string): string => {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const formatDate = (value: Date | string): string => {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month} ${day}, ${year}`;
};

const getRelativeTime = (value: Date | string): string => {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  const diffInSeconds = Math.floor(
    (new Date().getTime() - date.getTime()) / 1000,
  );
  if (diffInSeconds < 60) return "Just now";
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) return `${diffInDays}d ago`;
  return formatDate(date);
};

export function Overview({ group, members, onAddMember }: OverviewProps) {
  const [stats, setStats] = useState<AttendanceStats | null>(null);
  const [recentRecords, setRecentRecords] = useState<AttendanceRecord[]>([]);
  const [activitySearch, setActivitySearch] = useState("");

  const displayNameMap = useMemo(() => {
    return createDisplayNameMap(members);
  }, [members]);

  const filteredRecords = useMemo(() => {
    let result = recentRecords;

    if (activitySearch.trim()) {
      const query = activitySearch.toLowerCase();
      result = result.filter((record) => {
        const name = (
          displayNameMap.get(record.person_id) || "Unknown"
        ).toLowerCase();
        return (
          name.includes(query) || record.person_id.toLowerCase().includes(query)
        );
      });
    }
    return result;
  }, [recentRecords, activitySearch, displayNameMap]);

  const loadOverviewData = useCallback(async () => {
    if (members.length === 0) {
      return;
    }

    try {
      const [groupStats, records] = await Promise.all([
        attendanceManager.getGroupStats(group.id, new Date()),
        attendanceManager.getRecords({
          group_id: group.id,
          limit: 100,
        }),
      ]);

      setStats(groupStats);
      setRecentRecords(records);
    } catch (err) {
      console.error("Error loading overview data:", err);
    }
  }, [group.id, members.length]);

  useEffect(() => {
    loadOverviewData();
  }, [loadOverviewData]);

  if (members.length === 0) {
    return (
      <EmptyState
        title="No members in this group yet"
        action={
          onAddMember
            ? {
                label: "Add Member",
                onClick: onAddMember,
              }
            : undefined
        }
      />
    );
  }

  if (!stats) {
    return (
      <section className="flex items-center justify-center py-12">
        <div className="text-white/40 text-sm">Loading overview...</div>
      </section>
    );
  }

  return (
    <section className="space-y-6 h-full flex flex-col overflow-hidden p-6 custom-scroll overflow-y-auto">
      <div className="grid grid-cols-1 sm:grid-cols-3 border border-white/5 bg-[#0a0a0b] rounded-lg overflow-hidden divide-x divide-white/5 flex-shrink-0">
        <div className="px-8">
          <StatsCard
            type="present"
            value={stats.present_today}
            total={stats.total_members}
            label="Present Today"
          />
        </div>
        <div className="px-8">
          <StatsCard
            type="absent"
            value={Math.max(
              0,
              (stats.total_members ?? 0) - (stats.present_today ?? 0),
            )}
            total={stats.total_members}
            label="Missing Arrival"
          />
        </div>
        <div className="px-8">
          <StatsCard
            type="late"
            value={stats.late_today}
            label="Late Check-ins"
          />
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] backdrop-blur-sm overflow-hidden flex-shrink-0 flex flex-col min-h-[400px] shadow-2xl">
        <div className="p-4 border-b border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-4 flex-shrink-0 bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
              <i className="fa-solid fa-clock-rotate-left text-cyan-500 text-xs"></i>
              Activity Log
            </h3>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto flex-shrink-0">
            <div className="relative w-full sm:w-56">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="search"
                value={activitySearch}
                onChange={(e) => setActivitySearch(e.target.value)}
                placeholder="Search records..."
                className="w-full rounded-lg border border-white/10 bg-black/40 pl-9 pr-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-cyan-400/50 focus:bg-white/5 focus:outline-none transition-all"
              />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scroll p-4">
          <div className="h-full">
            {recentRecords.length === 0 ? (
              <div className="flex flex-col flex-1 items-center justify-center p-12 h-full min-h-[250px]">
                <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-4">
                  <i className="fa-regular fa-clock text-white/20 text-xl"></i>
                </div>
                <div className="text-sm font-medium text-white/60">
                  No activity yet
                </div>
                <div className="text-xs text-white/30 mt-1 text-center max-w-xs">
                  Check-ins and registrations will appear here.
                </div>
              </div>
            ) : filteredRecords.length === 0 ? (
              <div className="rounded-lg border border-white/5 bg-white/5 px-6 py-8 text-center w-full mt-4">
                <div className="text-xs text-white/40">
                  No results found for "{activitySearch}"
                </div>
              </div>
            ) : (
              <div className="relative ml-1 overflow-visible">
                {filteredRecords.slice(0, 50).map((record, idx) => {
                  const displayName =
                    displayNameMap.get(record.person_id) || "Unknown";
                  const isHighConfidence = record.confidence >= 0.85;
                  const itemsCount = Math.min(filteredRecords.length, 50);
                  const isLast = idx === itemsCount - 1;

                  return (
                    <div
                      key={record.id}
                      className="group relative flex items-center gap-3 hover:bg-white/[0.01] transition-all py-1.5 px-2"
                    >
                      {/* Unbroken Vertical Line Segment */}
                      <div
                        className="absolute w-px bg-white/20 left-[20px]"
                        style={{
                          top: idx === 0 ? "50%" : "0",
                          bottom: isLast ? "50%" : "0",
                        }}
                      />

                      {/* Timeline Dot Column */}
                      <div className="relative z-10 w-6 h-10 flex items-center justify-center flex-shrink-0">
                        <Tooltip
                          content={`${Math.round(record.confidence * 100)}% match`}
                          position="top"
                        >
                          <div
                            className={`w-1.5 h-1.5 rounded-full ring-[3px] ring-black/40 transition-all duration-300 cursor-help ${
                              isHighConfidence
                                ? "bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)]"
                                : "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]"
                            }`}
                          />
                        </Tooltip>
                      </div>

                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <div className="flex items-baseline gap-2">
                          <span className="font-bold text-white text-[13px] tracking-tight group-hover:text-cyan-400 transition-colors">
                            {displayName}
                          </span>
                          <span className="text-[10px] font-medium text-white/20 uppercase tracking-[0.15em]">
                            {getRelativeTime(record.timestamp)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-white/40">
                          <i className="fa-regular fa-clock text-[9px] opacity-40"></i>
                          <span>{formatTime(record.timestamp)}</span>
                        </div>
                      </div>

                      {/* Right-side decorative arrow or status icon */}
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity pr-2 text-white/10">
                        <i className="fa-solid fa-chevron-right text-[10px]"></i>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
