import { useState, useMemo, useEffect, memo, useCallback } from "react";
import { createDisplayNameMap } from "@/utils";
import { Dropdown } from "@/components/shared";
import type {
  AttendanceGroup,
  AttendanceRecord,
} from "@/components/main/types";

import { useAttendanceStore, useUIStore } from "@/components/main/stores";
import { ManualEntryModal } from "./ManualEntryModal";

interface AttendancePanelProps {
  handleSelectGroup: (group: AttendanceGroup) => void;
}

type SortField = "time" | "name";
type SortOrder = "asc" | "desc";

const AttendanceRecordItem = memo(
  ({
    record,
    displayName,
    classStartTime,
    lateThresholdMinutes,
    lateThresholdEnabled,
  }: {
    record: AttendanceRecord;
    displayName: string;
    classStartTime: string;
    lateThresholdMinutes: number;
    lateThresholdEnabled: boolean;
  }) => {
    const calculateTimeStatus = () => {
      try {
        if (!classStartTime) return null;

        const [startHours, startMinutes] = classStartTime
          .split(":")
          .map(Number);

        const startDate = new Date(record.timestamp);
        startDate.setHours(startHours, startMinutes, 0, 0);

        const diffMs = record.timestamp.getTime() - startDate.getTime();
        const diffMinutes = Math.floor(diffMs / 60000);

        const severeLateThreshold = 30;
        const earlyThreshold = -5;

        if (lateThresholdEnabled && diffMinutes > lateThresholdMinutes) {
          const minutesLate = diffMinutes - lateThresholdMinutes;
          return {
            status: minutesLate > severeLateThreshold ? "severe-late" : "late",
            minutes: minutesLate,
            label: `${minutesLate}M LATE`,
            color:
              minutesLate > severeLateThreshold
                ? "text-rose-400"
                : "text-amber-400",
            pillColor:
              minutesLate > severeLateThreshold
                ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
                : "bg-amber-500/15 text-amber-400 border-amber-500/30",
            borderColor:
              minutesLate > severeLateThreshold
                ? "border-l-rose-500"
                : "border-l-amber-500",
            avatarColor:
              minutesLate > severeLateThreshold
                ? "bg-rose-500/20 text-rose-400"
                : "bg-amber-500/20 text-amber-400",
          };
        }

        if (lateThresholdEnabled && diffMinutes < earlyThreshold) {
          const minutesEarly = Math.abs(diffMinutes);
          return {
            status: "early",
            minutes: minutesEarly,
            label: `${minutesEarly}M EARLY`,
            color: "text-emerald-400",
            pillColor:
              "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
            borderColor: "border-l-emerald-500",
            avatarColor: "bg-emerald-500/20 text-emerald-400",
          };
        }

        return {
          status: "on-time",
          minutes: 0,
          label: "ON TIME",
          color: "text-slate-400",
          pillColor: null,
          borderColor: "border-l-transparent",
          avatarColor: "bg-white/10 text-white/60",
        };
      } catch {
        return null;
      }
    };

    const timeStatus = calculateTimeStatus();

    return (
      <div
        className={`border-b border-white/[0.05] px-3 py-2.5 relative group transition-colors hover:bg-white/[0.03] border-l-2 ${timeStatus?.borderColor ?? "border-l-transparent"}`}
        title={
          classStartTime
            ? `Scheduled: ${classStartTime} | Late after: ${lateThresholdMinutes}m`
            : undefined
        }
      >
        <div className="flex items-center gap-2 py-0.5">
          {/* Name */}
          <span className="flex-1 min-w-0 text-[12px] font-medium text-white/90 truncate">
            {displayName}
          </span>

          {/* Status pill + Time — same line */}
          <div className="flex-shrink-0 flex items-center gap-1.5">
            {timeStatus && timeStatus.status !== "on-time" && (
              <span
                className={`px-1.5 py-px text-[9px] font-bold tracking-wider rounded border ${timeStatus.pillColor}`}
              >
                {timeStatus.label}
              </span>
            )}
            <span className="text-[11px] font-mono text-white/40 tabular-nums">
              {record.timestamp.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        </div>
      </div>
    );
  },
);

AttendanceRecordItem.displayName = "AttendanceRecordItem";

export const AttendancePanel = memo(function AttendancePanel({
  handleSelectGroup,
}: AttendancePanelProps) {
  const {
    attendanceGroups,
    currentGroup,
    recentAttendance,
    groupMembers,
    setShowGroupManagement,
  } = useAttendanceStore();

  const { setShowSettings, setGroupInitialSection } = useUIStore();
  const [showManualEntry, setShowManualEntry] = useState(false);

  // Present person IDs for filtering the manual entry list
  const presentPersonIds = useMemo(() => {
    return new Set(recentAttendance.map((r) => r.person_id));
  }, [recentAttendance]);

  // Late tracking settings derived from current group
  // This ensures we match what the Settings modal shows/updates
  const lateTrackingSettings = useMemo(() => {
    if (!currentGroup?.settings) {
      return {
        lateThresholdEnabled: false,
        lateThresholdMinutes: 5,
        classStartTime: new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
      };
    }

    return {
      lateThresholdEnabled:
        currentGroup.settings.late_threshold_enabled ?? false,
      lateThresholdMinutes: currentGroup.settings.late_threshold_minutes ?? 5,
      classStartTime:
        currentGroup.settings.class_start_time ??
        new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
    };
  }, [currentGroup]);

  const handleOpenSettingsForRegistration = useCallback(() => {
    setGroupInitialSection("members");
    setShowSettings(true);
  }, [setGroupInitialSection, setShowSettings]);

  // Hardcoded as it was in Main
  const attendanceEnabled = true;
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("time");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [displayLimit, setDisplayLimit] = useState(20);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
    },
    [],
  );

  const handleSortFieldChange = useCallback((field: SortField | null) => {
    if (field) {
      setSortField(field);
      if (field === "time") {
        setSortOrder("desc");
      } else if (field === "name") {
        setSortOrder("asc");
      }
    }
  }, []);

  const handleLoadMore = useCallback(() => {
    setDisplayLimit((prev) => prev + 20);
  }, []);

  const displayNameMap = useMemo(() => {
    return createDisplayNameMap(groupMembers);
  }, [groupMembers]);

  const processedRecords = useMemo(() => {
    if (!recentAttendance.length) {
      return [];
    }

    let filtered = [...recentAttendance];

    const normalizedQuery = searchQuery.trim().toLowerCase();
    const hasSearchQuery = normalizedQuery.length > 0;

    if (hasSearchQuery) {
      const filteredArray: typeof filtered = [];
      for (let i = 0; i < filtered.length; i++) {
        const record = filtered[i];
        const displayName = (
          displayNameMap.get(record.person_id) || "Unknown"
        ).toLowerCase();
        if (displayName.includes(normalizedQuery)) {
          filteredArray.push(record);
        }
      }
      filtered = filteredArray;
    }

    if (sortField === "time") {
      filtered.sort((a, b) => {
        const timeA = a.timestamp.getTime();
        const timeB = b.timestamp.getTime();
        return sortOrder === "asc" ? timeA - timeB : timeB - timeA;
      });
    } else if (sortField === "name") {
      const nameCache = new Map<string, string>();
      filtered.sort((a, b) => {
        let nameA = nameCache.get(a.person_id);
        if (!nameA) {
          nameA = (displayNameMap.get(a.person_id) || "Unknown").toLowerCase();
          nameCache.set(a.person_id, nameA);
        }
        let nameB = nameCache.get(b.person_id);
        if (!nameB) {
          nameB = (displayNameMap.get(b.person_id) || "Unknown").toLowerCase();
          nameCache.set(b.person_id, nameB);
        }
        const comparison = nameA.localeCompare(nameB);
        return sortOrder === "asc" ? comparison : -comparison;
      });
    }

    return filtered;
  }, [recentAttendance, displayNameMap, searchQuery, sortField, sortOrder]);

  const visibleRecords = useMemo(() => {
    return processedRecords.slice(0, displayLimit);
  }, [processedRecords, displayLimit]);

  const hasMore = processedRecords.length > displayLimit;

  useEffect(() => {
    setDisplayLimit(20);
  }, [searchQuery, sortField, sortOrder]);

  if (!attendanceEnabled) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <h3 className="text-lg font-light px-4 pt-4 flex-shrink-0">
          Recent Logs
        </h3>
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
      {attendanceGroups.length > 0 ? (
        <div className="p-2 pb-1.5 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-[120px]">
              <Dropdown
                options={attendanceGroups.map((group) => ({
                  value: group.id,
                  label: group.name,
                }))}
                value={
                  currentGroup &&
                    attendanceGroups.some((g) => g.id === currentGroup.id)
                    ? currentGroup.id
                    : null
                }
                onChange={(groupId) => {
                  if (groupId) {
                    const group = attendanceGroups.find(
                      (g) => g.id === groupId,
                    );
                    if (group) handleSelectGroup(group);
                  }
                }}
                placeholder="Select group…"
                emptyMessage="No groups available"
                maxHeight={256}
                buttonClassName="text-xs py-1.5"
                allowClear={false}
                showPlaceholderOption={false}
              />
            </div>
            <button
              onClick={() => setShowManualEntry(true)}
              className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-md bg-white/5 hover:bg-white/10 border border-white/10 transition-all text-white/70 hover:text-white"
              title="Members"
              aria-label="Members"
            >
              <i className="fa-solid fa-users text-sm"></i>
            </button>
            <button
              onClick={() => setShowGroupManagement(true)}
              className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-md bg-white/5 hover:bg-white/10 border border-white/10 transition-all text-white/70 hover:text-white"
              title="Create new group"
              aria-label="Create new group"
            >
              <i className="fa-solid fa-plus text-sm"></i>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center min-h-0">
          <div className="flex flex-col items-center justify-center space-y-3">
            <div className="text-white/40 text-xs text-center">
              No groups created yet
            </div>
            <button
              onClick={() => setShowGroupManagement(true)}
              className="px-4 py-2 text-xs bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.1] rounded text-white/70 hover:text-white/90 transition-colors flex items-center gap-2"
            >
              <i className="fa-solid fa-plus text-xs"></i>
              New Group
            </button>
          </div>
        </div>
      )}

      {recentAttendance.length > 0 && (
        <div className="px-2 flex-shrink-0 space-y-1.5">
          {/* Search */}
          <div className="relative">
            <i className="fa-solid fa-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 text-[10px] pointer-events-none" />
            <input
              type="text"
              placeholder="Search name..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="w-full bg-white/[0.05] text-white text-[11px] border border-white/[0.08] rounded-md pl-7 pr-3 py-1.5 placeholder:text-white/25 focus:border-white/20 focus:outline-none transition-colors"
            />
          </div>

          {/* Sort toggle */}
          <div className="flex gap-1">
            <button
              onClick={() => handleSortFieldChange("time")}
              className={`flex-1 py-1 text-[10px] font-medium rounded transition-all ${sortField === "time"
                ? "bg-white/10 text-white border border-white/15"
                : "text-white/40 hover:text-white/60 hover:bg-white/[0.04]"
                }`}
            >
              <i className="fa-regular fa-clock mr-1 text-[9px]" />
              Newest
            </button>
            <button
              onClick={() => handleSortFieldChange("name")}
              className={`flex-1 py-1 text-[10px] font-medium rounded transition-all ${sortField === "name"
                ? "bg-white/10 text-white border border-white/15"
                : "text-white/40 hover:text-white/60 hover:bg-white/[0.04]"
                }`}
            >
              <i className="fa-solid fa-arrow-down-a-z mr-1 text-[9px]" />
              A–Z
            </button>
          </div>
        </div>
      )}

      {attendanceGroups.length > 0 && (
        <div className="flex-1 overflow-y-auto min-h-0 custom-scroll flex flex-col">
          {visibleRecords.length > 0 ? (
            <>
              {visibleRecords.map((record) => {
                const displayName =
                  displayNameMap.get(record.person_id) || "Unknown";
                return (
                  <AttendanceRecordItem
                    key={record.id}
                    record={record}
                    displayName={displayName}
                    classStartTime={lateTrackingSettings.classStartTime}
                    lateThresholdMinutes={
                      lateTrackingSettings.lateThresholdMinutes
                    }
                    lateThresholdEnabled={
                      lateTrackingSettings.lateThresholdEnabled
                    }
                  />
                );
              })}

              {hasMore && (
                <div className="px-2 py-2">
                  <button
                    onClick={handleLoadMore}
                    className="w-full py-2 text-xs bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.1] rounded text-white/70 transition-colors"
                  >
                    Load More ({processedRecords.length - displayLimit}{" "}
                    remaining)
                  </button>
                </div>
              )}
            </>
          ) : searchQuery ? (
            <div className="flex-1 flex items-center justify-center min-h-0">
              <div className="text-white/50 text-sm text-center">
                No results for "{searchQuery}"
              </div>
            </div>
          ) : !currentGroup ? (
            <div className="flex-1 flex items-center justify-center min-h-0">
              <div className="text-white/40 text-xs text-center">
                Choose a group to see today&apos;s attendance logs
              </div>
            </div>
          ) : groupMembers.length === 0 ? (
            <div className="flex-1 flex items-center justify-center min-h-0">
              <div className="flex flex-col items-center justify-center space-y-3">
                <div className="text-white/40 text-xs text-center">
                  No members in this group yet
                </div>
                {handleOpenSettingsForRegistration && (
                  <button
                    onClick={handleOpenSettingsForRegistration}
                    className="px-4 py-2 text-xs bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.1] rounded text-white/70 hover:text-white/90 transition-colors flex items-center gap-2"
                  >
                    <i className="fa-solid fa-user-plus text-xs"></i>
                    Add Member
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center min-h-0">
              <div className="text-white/40 text-xs text-center">
                No attendance logs yet
              </div>
            </div>
          )}
        </div>
      )}
      {showManualEntry && (
        <ManualEntryModal
          onClose={() => setShowManualEntry(false)}
          onSuccess={() => {
            // Optional: refreshed logic handled by store/websocket usually,
            // but we can force refresh if needed.
          }}
          members={groupMembers}
          presentPersonIds={presentPersonIds}
          onAddMember={handleOpenSettingsForRegistration}
        />
      )}
    </div>
  );
});
