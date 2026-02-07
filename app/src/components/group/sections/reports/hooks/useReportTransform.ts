import { useMemo } from "react";
import {
  generateDateRange,
  createDisplayNameMap,
  parseLocalDate,
} from "@/utils";
import type {
  AttendanceSession,
  AttendanceMember,
  AttendanceGroup,
  AttendanceReport,
  AttendanceRecord,
} from "@/types/recognition";
import { getLocalDateString } from "@/utils";
import type {
  RowData,
  GroupByKey,
  ReportStatusFilter,
} from "@/components/group/sections/reports/types";

export function useReportTransform(
  group: AttendanceGroup,
  members: AttendanceMember[],
  sessions: AttendanceSession[],
  records: AttendanceRecord[],
  report: AttendanceReport | null,
  startDateStr: string,
  endDateStr: string,
  groupBy: GroupByKey,
  statusFilter: ReportStatusFilter,
  search: string,
) {
  // Build table rows from sessions + members
  const displayNameMap = useMemo(() => {
    return createDisplayNameMap(members);
  }, [members]);

  // Create a map of sessions by person_id and date for quick lookup
  const sessionsMap = useMemo(() => {
    const map = new Map<string, AttendanceSession>();
    sessions.forEach((s) => {
      const key = `${s.person_id}_${s.date}`;
      map.set(key, s);
    });
    return map;
  }, [sessions]);

  // Aggregate Raw Records for Time Out Calculation
  const recordStatsMap = useMemo(() => {
    // Key: personId_dateString
    // Value: { min: Date, max: Date, durationStr: string }
    const map = new Map<
      string,
      { min: Date; max: Date; durationHrs: number }
    >();

    records.forEach((r) => {
      const dateStr = getLocalDateString(new Date(r.timestamp)); // YYYY-MM-DD
      const key = `${r.person_id}_${dateStr}`;
      const ts = new Date(r.timestamp);

      if (!map.has(key)) {
        map.set(key, { min: ts, max: ts, durationHrs: 0 });
      } else {
        const current = map.get(key)!;
        if (ts < current.min) current.min = ts;
        if (ts > current.max) current.max = ts;
      }
    });

    // Calculate durations
    map.forEach((value) => {
      // Only count duration if gap is > 60 seconds (prevents accidental double scan counting)
      const diffMs = value.max.getTime() - value.min.getTime();
      if (diffMs > 60000) {
        value.durationHrs = diffMs / (1000 * 60 * 60);
      } else {
        value.durationHrs = 0; // Not enough time to count as a "shift"
      }
    });

    return map;
  }, [records]);

  const filteredRows = useMemo(() => {
    const allDates = generateDateRange(startDateStr, endDateStr);
    const rows: RowData[] = [];

    for (const member of members) {
      let memberJoinedAt: Date | null = null;
      if (member.joined_at instanceof Date) {
        memberJoinedAt = member.joined_at;
      } else if (member.joined_at) {
        memberJoinedAt = new Date(member.joined_at);
        if (Number.isNaN(memberJoinedAt.getTime())) {
          memberJoinedAt = null;
        }
      }

      if (memberJoinedAt) {
        memberJoinedAt.setHours(0, 0, 0, 0);
      }

      for (const date of allDates) {
        const dateObj = parseLocalDate(date);
        dateObj.setHours(0, 0, 0, 0);
        const isBeforeJoined = memberJoinedAt && dateObj < memberJoinedAt;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const isFutureEnrollment = memberJoinedAt && memberJoinedAt > today;
        const isFutureDate = dateObj > today;

        const shouldShowNoRecords =
          isBeforeJoined || isFutureEnrollment || isFutureDate;

        const sessionKey = `${member.person_id}_${date}`;
        const session = sessionsMap.get(sessionKey) || null;

        let finalSession: AttendanceSession | null = null;
        if (shouldShowNoRecords) {
          finalSession = null;
        } else if (session) {
          finalSession = session;
        } else {
          finalSession = null;
        }

        let status: ReportStatusFilter;
        if (shouldShowNoRecords) {
          status = "no_records";
        } else if (!finalSession) {
          status = "absent";
        } else {
          // Map session status to ReportStatusFilter.
          status = finalSession.status as ReportStatusFilter;
        }

        const recordStats = recordStatsMap.get(sessionKey);

        let checkOutTime: Date | undefined;
        let totalHours: number | undefined;

        if (recordStats && recordStats.durationHrs > 0) {
          checkOutTime = recordStats.max;
          totalHours = recordStats.durationHrs;
        }

        // --- DYNAMIC LATE LOGIC ---
        // We override the backend's static "is_late" with a dynamic calculation based on current settings.
        // This allows the user to change the Class Start Time and immediately see updated reports.

        let isLate = finalSession?.is_late || false;
        let lateMinutes = finalSession?.late_minutes || 0;

        // If we have a check-in time and group settings are active
        // Check if late tracking is enabled in settings
        const isLateTrackingEnabled =
          group.settings?.late_threshold_enabled ?? false;

        if (!isLateTrackingEnabled) {
          isLate = false;
          lateMinutes = 0;
        } else if (
          finalSession?.check_in_time &&
          group.settings?.class_start_time
        ) {
          const checkIn = new Date(finalSession.check_in_time);
          const [startHour, startMinute] = group.settings.class_start_time
            .split(":")
            .map(Number);

          if (!isNaN(startHour) && !isNaN(startMinute)) {
            // Create "Class Start" date object for this specific day
            const classStart = new Date(checkIn);
            classStart.setHours(startHour, startMinute, 0, 0);

            // Add Threshold (Grace Period)
            const thresholdMinutes = group.settings.late_threshold_minutes || 0;
            const lateThresholdTime = new Date(
              classStart.getTime() + thresholdMinutes * 60000,
            );

            // Compare
            if (checkIn > lateThresholdTime) {
              isLate = true;
              // Calculate raw minutes late (relative to start time, not threshold)
              const diffMs = checkIn.getTime() - classStart.getTime();
              lateMinutes = Math.floor(diffMs / 60000);
            } else {
              // If they are within threshold, they are NOT late (even if backend said so previously)
              isLate = false;
              lateMinutes = 0;
            }
          }
        }

        rows.push({
          person_id: member.person_id,
          name: displayNameMap.get(member.person_id) || "Unknown",
          date: date,
          check_in_time: finalSession?.check_in_time,
          check_out_time: checkOutTime,
          total_hours: totalHours,
          status: status,
          is_late: isLate,
          late_minutes: lateMinutes,
          notes: finalSession?.notes || "",
          session: finalSession,
        });
      }
    }

    return rows.filter((r) => {
      if (statusFilter !== "all") {
        if (statusFilter === "present") {
          // Present includes both plain 'present' and 'late' (since late means they arrived)
          // But technically 'late' status isn't assigned to r.status in the loop above yet unless check?
          // Wait, previous logic assigned r.status = finalSession.status.
          // If session status is 'present', r.is_late might be true.
          // So we check:

          // Note: If backend says status='late', then r.status='late'.
          // If backend says status='present' + is_late=true, then r.status='present'.
          // To be safe:
          if (r.status !== "present" && r.status !== "late" && !r.is_late)
            return false;
        } else if (statusFilter === "late") {
          // Strict LATE filter
          if (!r.is_late && r.status !== "late") return false;
        } else {
          // 'absent' or 'no_records'
          if (r.status !== statusFilter) return false;
        }
      }

      if (search) {
        const q = search.toLowerCase();
        const hay = `${r.name} ${r.status} ${r.notes}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    group,
    sessionsMap,
    recordStatsMap,
    members,
    displayNameMap,
    statusFilter,
    search,
    startDateStr,
    endDateStr,
  ]);

  const groupedRows = useMemo(() => {
    if (groupBy === "none")
      return { __all__: filteredRows } as Record<string, typeof filteredRows>;
    const groups: Record<string, typeof filteredRows> = {};
    for (const r of filteredRows) {
      const key = groupBy === "person" ? `${r.name}` : r.date;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    return groups;
  }, [filteredRows, groupBy]);

  const daysTracked = useMemo(() => {
    if (report?.summary?.total_working_days !== undefined) {
      return report.summary.total_working_days;
    }
    const start = parseLocalDate(startDateStr);
    const end = parseLocalDate(endDateStr);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays;
  }, [report, startDateStr, endDateStr]);

  return {
    filteredRows,
    groupedRows,
    daysTracked,
    allColumns: ALL_COLUMNS,
  };
}

const ALL_COLUMNS = [
  { key: "name", label: "Name", align: "left" },
  { key: "date", label: "Date", align: "left" },
  { key: "status", label: "Status", align: "center" },
  { key: "check_in_time", label: "Time In", align: "center" },
  { key: "check_out_time", label: "Time Out", align: "center" }, // NEW
  { key: "total_hours", label: "Hours", align: "center" }, // NEW
  { key: "is_late", label: "Late", align: "center" },
  { key: "late_minutes", label: "Minutes Late", align: "center" },
  { key: "notes", label: "Notes", align: "left" },
] as const;
