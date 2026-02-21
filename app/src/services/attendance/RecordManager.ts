import type {
  AttendanceRecord,
  AttendanceSession,
  AttendanceStats,
  AttendanceReport,
  AttendanceEvent,
  AttendanceGroup,
  AttendanceMember,
} from "../../types/recognition";
import { getLocalDateString, parseLocalDate } from "../../utils/index";
import type { HttpClient } from "./HttpClient";

export class RecordManager {
  private httpClient: HttpClient;
  private apiEndpoints: Record<string, string>;
  private toLocalDateTimeParam: (date: Date) => string;
  private warnIfSystemClockWentBackwards: () => void;

  constructor(
    httpClient: HttpClient,
    apiEndpoints: Record<string, string>,
    toLocalDateTimeParam: (date: Date) => string,
    warnIfSystemClockWentBackwards: () => void,
  ) {
    this.httpClient = httpClient;
    this.apiEndpoints = apiEndpoints;
    this.toLocalDateTimeParam = toLocalDateTimeParam;
    this.warnIfSystemClockWentBackwards = warnIfSystemClockWentBackwards;
  }

  async processAttendanceEvent(
    personId: string,
    confidence: number,
    location?: string,
    livenessStatus?: string,
    livenessConfidence?: number,
  ): Promise<AttendanceEvent | null> {
    try {
      this.warnIfSystemClockWentBackwards();

      const eventData: Record<string, unknown> = {
        person_id: personId,
        confidence,
      };

      if (location) eventData.location = location;
      if (livenessStatus) eventData.liveness_status = livenessStatus;
      if (typeof livenessConfidence === "number") {
        eventData.liveness_confidence = livenessConfidence;
      }

      const event = await this.httpClient.post<AttendanceEvent>(
        this.apiEndpoints.events,
        eventData,
      );

      return {
        ...event,
        timestamp: new Date(event.timestamp),
      };
    } catch (error: unknown) {
      console.error("Error processing attendance event:", error);
      throw error;
    }
  }

  async getGroupStats(groupId: string, date?: Date): Promise<AttendanceStats> {
    try {
      const params: Record<string, string> = {};
      if (date) {
        params.date = getLocalDateString(date);
      }

      return await this.httpClient.get<AttendanceStats>(
        `${this.apiEndpoints.groups}/${groupId}/stats`,
        params,
      );
    } catch (error) {
      console.error("Error getting group stats:", error);
      return {
        total_members: 0,
        present_today: 0,
        absent_today: 0,
        late_today: 0,
      };
    }
  }

  async generateReport(
    groupId: string,
    startDate: Date,
    endDate: Date,
    getGroup: (id: string) => Promise<AttendanceGroup | undefined>,
    getGroupMembers: (id: string) => Promise<AttendanceMember[]>,
  ): Promise<AttendanceReport> {
    try {
      const startDateTime = new Date(startDate);
      startDateTime.setHours(0, 0, 0, 0);
      const endDateTime = new Date(endDate);
      endDateTime.setHours(23, 59, 59, 999);

      const [group, members, , sessions] = await Promise.all([
        getGroup(groupId),
        getGroupMembers(groupId),
        this.getRecords({
          group_id: groupId,
          start_date: this.toLocalDateTimeParam(startDateTime),
          end_date: this.toLocalDateTimeParam(endDateTime),
        }),
        this.getSessions({
          group_id: groupId,
          start_date: getLocalDateString(startDate),
          end_date: getLocalDateString(endDate),
        }),
      ]);

      if (!group) throw new Error("Group not found");

      const timeDiff = Math.abs(endDate.getTime() - startDate.getTime());
      const totalDaysInRange = Math.ceil(timeDiff / (1000 * 60 * 60 * 24)) + 1;

      const memberReports = members.map((member: AttendanceMember) => {
        let memberJoinedAt: Date;
        if (member.joined_at instanceof Date) {
          memberJoinedAt = member.joined_at;
        } else if (member.joined_at) {
          memberJoinedAt = new Date(member.joined_at);
          if (Number.isNaN(memberJoinedAt.getTime())) {
            memberJoinedAt = startDate;
          }
        } else {
          memberJoinedAt = startDate;
        }

        const effectiveStartDate =
          memberJoinedAt > startDate ? memberJoinedAt : startDate;
        const memberTimeDiff = Math.abs(
          endDate.getTime() - effectiveStartDate.getTime(),
        );
        const totalDaysMemberWasInGroup =
          Math.ceil(memberTimeDiff / (1000 * 60 * 60 * 24)) + 1;

        const memberSessions = sessions.filter((s: AttendanceSession) => {
          if (s.person_id !== member.person_id) return false;
          const sessionDate = parseLocalDate(s.date);
          sessionDate.setHours(0, 0, 0, 0);
          const joinedDate = new Date(memberJoinedAt);
          joinedDate.setHours(0, 0, 0, 0);
          return sessionDate >= joinedDate;
        });

        const presentDays = memberSessions.filter(
          (s: AttendanceSession) => s.status !== "absent",
        ).length;
        const absentDays =
          totalDaysMemberWasInGroup > 0
            ? totalDaysMemberWasInGroup - presentDays
            : 0;
        const lateDays = memberSessions.filter(
          (s: AttendanceSession) => s.is_late,
        ).length;
        const attendanceRate =
          totalDaysMemberWasInGroup > 0
            ? (presentDays / totalDaysMemberWasInGroup) * 100
            : 0;

        return {
          person_id: member.person_id,
          name: member.name,
          total_days: totalDaysMemberWasInGroup,
          present_days: presentDays,
          absent_days: absentDays,
          late_days: lateDays,
          attendance_rate: Math.round(attendanceRate * 100) / 100,
        };
      });

      const averageAttendanceRate =
        memberReports.length > 0
          ? memberReports.reduce(
              (sum: number, m) => sum + m.attendance_rate,
              0,
            ) / memberReports.length
          : 0;

      const mostPunctual =
        memberReports.reduce(
          (best, current) =>
            current.late_days < best.late_days ? current : best,
          memberReports[0],
        )?.name || "N/A";

      const mostAbsent =
        memberReports.reduce(
          (worst, current) =>
            current.absent_days > worst.absent_days ? current : worst,
          memberReports[0],
        )?.name || "N/A";

      return {
        group_id: groupId,
        date_range: { start: startDate, end: endDate },
        members: memberReports,
        summary: {
          total_working_days: totalDaysInRange,
          average_attendance_rate:
            Math.round(averageAttendanceRate * 100) / 100,
          most_punctual: mostPunctual,
          most_absent: mostAbsent,
        },
      };
    } catch (error) {
      console.error("Error generating report:", error);
      throw error;
    }
  }

  async addRecord(record: {
    person_id: string;
    timestamp?: Date;
    confidence?: number;
    location?: string;
    notes?: string;
    is_manual?: boolean;
    created_by?: string;
  }): Promise<AttendanceRecord> {
    try {
      const recordData = {
        ...record,
        timestamp: record.timestamp
          ? this.toLocalDateTimeParam(record.timestamp)
          : undefined,
        confidence: record.confidence ?? 1.0,
        is_manual: true,
      };

      const newRecord = await this.httpClient.post<AttendanceRecord>(
        this.apiEndpoints.records,
        recordData,
      );
      return { ...newRecord, timestamp: new Date(newRecord.timestamp) };
    } catch (error) {
      console.error("Error adding record:", error);
      throw error;
    }
  }

  async getRecords(filters?: {
    group_id?: string;
    person_id?: string;
    start_date?: string;
    end_date?: string;
    limit?: number;
  }): Promise<AttendanceRecord[]> {
    try {
      const params: Record<string, string> = {};
      if (filters?.group_id) params.group_id = filters.group_id;
      if (filters?.person_id) params.person_id = filters.person_id;
      if (filters?.start_date) params.start_date = filters.start_date;
      if (filters?.end_date) params.end_date = filters.end_date;
      if (filters?.limit) params.limit = filters.limit.toString();

      const records = await this.httpClient.get<AttendanceRecord[]>(
        this.apiEndpoints.records,
        params,
      );
      return records.map((record) => ({
        ...record,
        timestamp: new Date(record.timestamp),
      }));
    } catch (error) {
      console.error("Error getting records:", error);
      return [];
    }
  }

  async getSessions(filters?: {
    group_id?: string;
    person_id?: string;
    start_date?: string;
    end_date?: string;
  }): Promise<AttendanceSession[]> {
    try {
      const params: Record<string, string> = {};
      if (filters?.group_id) params.group_id = filters.group_id;
      if (filters?.person_id) params.person_id = filters.person_id;
      if (filters?.start_date) params.start_date = filters.start_date;
      if (filters?.end_date) params.end_date = filters.end_date;

      const sessions = await this.httpClient.get<AttendanceSession[]>(
        this.apiEndpoints.sessions,
        params,
      );
      return sessions.map((session) => ({
        ...session,
        check_in_time: session.check_in_time
          ? new Date(session.check_in_time)
          : undefined,
      }));
    } catch (error) {
      console.error("Error getting sessions:", error);
      return [];
    }
  }
}
