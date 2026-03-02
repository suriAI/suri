import { useState, useMemo, useEffect, memo, useCallback } from "react";
import { createDisplayNameMap } from "@/utils";
import { Dropdown, Tooltip } from "@/components/shared";
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
    hasCheckedInEarlier,
  }: {
    record: AttendanceRecord;
    displayName: string;
    classStartTime: string;
    lateThresholdMinutes: number;
    lateThresholdEnabled: boolean;
    hasCheckedInEarlier: boolean;
  }) => {
    const calculateTimeStatus = () => {
      try {
        if (!classStartTime) return null;

        // If the user already has a check-in earlier today, this is a check-out scan
        if (hasCheckedInEarlier) {
          return {
            status: "check-out",
            minutes: 0,
            label: "TIME OUT",
            color: "text-cyan-400",
            pillColor: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
            borderColor: "border-l-cyan-500",
            avatarColor: "bg-cyan-500/20 text-cyan-400",
          };
        }

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
          const minutesLate = diffMinutes;
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
          label: "TIME IN",
          color: "text-slate-400",
          pillColor: "bg-white/10 text-white/60 border-white/20",
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
        className={`border-b border-white/5 px-3 py-2.5 relative group transition-colors hover:bg-white/5 border-l-2 ${timeStatus?.borderColor ?? "border-l-transparent"}`}
        title={
          classStartTime && !hasCheckedInEarlier
            ? `Scheduled: ${classStartTime} | Late after: ${lateThresholdMinutes}m`
            : undefined
        }
      >
        <div className="flex items-center gap-2 py-0.5">
          <span className="flex-1 min-w-0 text-[12px] font-medium text-white/90 truncate">
            {displayName}
          </span>

          <div className="flex-shrink-0 flex items-center gap-1.5">
            <span
              className={`text-[10px] font-bold tracking-widest ${timeStatus?.color || "text-white/60"}`}
            >
              {timeStatus?.label || "SCANNED"}
            </span>
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

  const presentPersonIds = useMemo(() => {
    return new Set(recentAttendance.map((r) => r.person_id));
  }, [recentAttendance]);

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
            <Tooltip content="Members" position="top">
              <button
                onClick={() => setShowManualEntry(true)}
                className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-all text-white/70 hover:text-white"
                aria-label="Members"
              >
                <i className="fa-solid fa-users text-sm"></i>
              </button>
            </Tooltip>
            <Tooltip content="Create new group" position="top">
              <button
                onClick={() => setShowGroupManagement(true)}
                className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-all text-white/70 hover:text-white"
                aria-label="Create new group"
              >
                <i className="fa-solid fa-plus text-sm"></i>
              </button>
            </Tooltip>
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
              className="px-4 py-2 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/70 hover:text-white transition-colors flex items-center gap-2"
            >
              <i className="fa-solid fa-plus text-xs"></i>
              New Group
            </button>
          </div>
        </div>
      )}

      {recentAttendance.length > 0 && (
        <div className="px-2 pb-3 flex-shrink-0">
          <div className="flex items-center">
            {/* Joined Search and Sort Container */}
            <div className="relative flex-1 group/search">
              <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-white/20 text-[10px] pointer-events-none group-focus-within/search:text-cyan-400/60 transition-colors" />
              <input
                type="text"
                placeholder="Search name..."
                value={searchQuery}
                onChange={handleSearchChange}
                className="w-full h-9 bg-white/[0.03] text-white text-[11px] border border-r-0 border-white/10 rounded-l-lg rounded-r-none pl-10 pr-3 placeholder:text-white/20 focus:border-white/20 focus:bg-white/[0.06] focus:outline-none transition-all"
              />
            </div>

            <div className="flex-shrink-0">
              <Tooltip
                content={`Sort: ${sortField === "time" ? "Newest" : "A-Z"}`}
                position="top"
              >
                <Dropdown
                  className="w-11"
                  options={[
                    { value: "time", label: "Newest" },
                    { value: "name", label: "A-Z" },
                  ]}
                  value={sortField}
                  onChange={(val) => handleSortFieldChange(val as SortField)}
                  trigger={
                    <i
                      className={`${
                        sortField === "time"
                          ? "fa-regular fa-clock"
                          : "fa-solid fa-arrow-down-a-z"
                      } text-xs text-white/30 hover:!text-cyan-400 transition-colors pointer-events-auto`}
                    />
                  }
                  menuWidth={110}
                  buttonClassName="h-9 w-full bg-white/[0.03] border border-l-0 border-white/10 rounded-r-lg rounded-l-none flex items-center justify-center hover:bg-white/[0.07] transition-all"
                  showPlaceholderOption={false}
                  allowClear={false}
                />
              </Tooltip>
            </div>
          </div>
        </div>
      )}

      {attendanceGroups.length > 0 && (
        <div className="flex-1 overflow-y-auto min-h-0 custom-scroll flex flex-col">
          {visibleRecords.length > 0 ? (
            <>
              {(() => {
                // Keep track of who has a valid "Time In" scan
                const checkedInSet = new Set<string>();

                // We iterate from oldest to newest to chronologically track check-ins
                // But we still want to render them in the original sorted order (which might be newest first)
                // First, determine check-in status chronologically
                const chronologicalRecords = [...processedRecords].sort(
                  (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
                );

                const recordCheckInStatus = new Map<string, boolean>();

                chronologicalRecords.forEach((record) => {
                  const personId = record.person_id;
                  const dateString = record.timestamp.toDateString();
                  const key = `${personId}_${dateString}`;

                  if (!checkedInSet.has(key)) {
                    // First scan of the day!
                    checkedInSet.add(key);
                    recordCheckInStatus.set(record.id, false); // false = "not checked in earlier"
                  } else {
                    // Subsequent scan of the day!
                    // Add 60-second grace period protection here if needed,
                    // but simple existence in set is enough for "checked in earlier" flag
                    recordCheckInStatus.set(record.id, true); // true = "has checked in earlier"
                  }
                });

                return visibleRecords.map((record) => {
                  const displayName =
                    displayNameMap.get(record.person_id) || "Unknown";

                  // Default to false (Time In) if somehow missing from map
                  const hasCheckedInEarlier =
                    recordCheckInStatus.get(record.id) ?? false;

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
                      hasCheckedInEarlier={hasCheckedInEarlier}
                    />
                  );
                });
              })()}

              {hasMore && (
                <div className="px-2 py-2">
                  <button
                    onClick={handleLoadMore}
                    className="w-full py-2 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/70 transition-colors"
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
                    className="px-4 py-2 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/70 hover:text-white transition-colors flex items-center gap-2"
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
          currentGroup={currentGroup}
        />
      )}
    </div>
  );
});
