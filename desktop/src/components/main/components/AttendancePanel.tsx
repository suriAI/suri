import { useState, useMemo, useEffect, memo, useCallback } from "react";
import { createDisplayNameMap } from "../../../utils";
import { Dropdown } from "../../shared";
import type {
  AttendanceGroup,
  AttendanceMember,
  AttendanceRecord,
} from "../types";

interface AttendancePanelProps {
  attendanceEnabled: boolean;
  attendanceGroups: AttendanceGroup[];
  currentGroup: AttendanceGroup | null;
  recentAttendance: AttendanceRecord[];
  groupMembers: AttendanceMember[];
  handleSelectGroup: (group: AttendanceGroup) => void;
  setShowGroupManagement: (show: boolean) => void;
  onOpenSettingsForRegistration?: () => void;
}

type SortField = "time" | "name";
type SortOrder = "asc" | "desc";

const AttendanceRecordItem = memo(
  ({
    record,
    displayName,
  }: {
    record: AttendanceRecord;
    displayName: string;
  }) => (
    <div className="text-xs bg-white/[0.02] border-b border-white/[0.05] p-2">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-2">
          <span className="font-medium">{displayName}</span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded ${record.is_manual ? "bg-orange-600/20 text-orange-300 border border-orange-500/30" : "bg-cyan-600/20 text-cyan-300 border border-cyan-500/30"}`}
          >
            {record.is_manual ? "Manual" : "Auto"}
          </span>
        </div>
        <span className="text-white/50">
          {record.timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  ),
);

AttendanceRecordItem.displayName = "AttendanceRecordItem";

export const AttendancePanel = memo(function AttendancePanel({
  attendanceEnabled,
  attendanceGroups,
  currentGroup,
  recentAttendance,
  groupMembers,
  handleSelectGroup,
  setShowGroupManagement,
  onOpenSettingsForRegistration,
}: AttendancePanelProps) {
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
        <h3 className="text-lg font-light px-4 pt-4 pb-2 flex-shrink-0">
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
        <div className="p-2 pb-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Dropdown
                options={attendanceGroups.map((group) => ({
                  value: group.id,
                  label: group.name,
                }))}
                value={currentGroup?.id ?? null}
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
              onClick={() => setShowGroupManagement(true)}
              className="text-lg px-2 py-1 flex-shrink-0 border-none bg-none"
              title="Create New Group"
            >
              +
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
        <div className="px-2 pb-2 flex-shrink-0">
          <div className="flex items-center gap-3 text-[8px]">
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="flex-1 bg-white/[0.05] text-white text-xs border border-white/[0.1] rounded px-3 py-1.5 min-w-0 placeholder:text-white/30 focus:border-blue-500 focus:outline-none"
            />

            <div className="flex items-center space-x-2">
              <div className="flex-1">
                <Dropdown
                  options={[
                    { value: "time", label: "Time (Newest)" },
                    { value: "name", label: "Name (A-Z)" },
                  ]}
                  value={sortField}
                  onChange={handleSortFieldChange}
                  placeholder="Sort by..."
                  emptyMessage="No options available"
                  maxHeight={256}
                  buttonClassName="text-[8px] py-1.5"
                  optionClassName="text-[8px]"
                  iconClassName="text-[8px]"
                  allowClear={false}
                  showPlaceholderOption={false}
                />
              </div>
            </div>
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
          ) : groupMembers.length === 0 && currentGroup ? (
            <div className="flex-1 flex items-center justify-center min-h-0">
              <div className="flex flex-col items-center justify-center space-y-3">
                <div className="text-white/40 text-xs text-center">
                  No members in this group yet
                </div>
                {onOpenSettingsForRegistration && (
                  <button
                    onClick={onOpenSettingsForRegistration}
                    className="px-4 py-2 text-xs bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.1] rounded text-white/70 hover:text-white/90 transition-colors flex items-center gap-2"
                  >
                    <i className="fa-solid fa-user-plus text-xs"></i>
                    Add Member
                  </button>
                )}
              </div>
            </div>
          ) : currentGroup ? (
            <div className="flex-1 flex items-center justify-center min-h-0">
              <div className="text-white/40 text-xs text-center">
                NO RECORDS FOUND
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
});
