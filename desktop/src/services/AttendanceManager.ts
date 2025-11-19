import type {
  AttendanceGroup,
  AttendanceMember,
  AttendanceRecord,
  AttendanceSession,
  AttendanceStats,
  AttendanceReport,
  AttendanceSettings,
  AttendanceEvent,
} from "../types/recognition.js";
import { getLocalDateString } from "../utils/index.js";

// API Configuration
const API_BASE_URL = "http://127.0.0.1:8700";
const API_ENDPOINTS = {
  groups: "/attendance/groups",
  members: "/attendance/members",
  records: "/attendance/records",
  sessions: "/attendance/sessions",
  events: "/attendance/events",
  settings: "/attendance/settings",
  stats: "/attendance/stats",
};

// HTTP Client utility
class HttpClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const defaultOptions: RequestInit = {
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    };

    const response = await fetch(url, { ...defaultOptions, ...options });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.detail ||
          errorData.error ||
          `HTTP ${response.status}: ${response.statusText}`,
      );
    }

    return response.json();
  }

  async get<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = params
      ? `${endpoint}?${new URLSearchParams(params).toString()}`
      : endpoint;
    return this.request<T>(url);
  }

  async post<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async put<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "PUT",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, {
      method: "DELETE",
    });
  }
}

export class AttendanceManager {
  private httpClient: HttpClient;
  private settings: AttendanceSettings | null = null;
  private eventQueue: AttendanceEvent[] = [];

  constructor() {
    this.httpClient = new HttpClient(API_BASE_URL);
    // Load settings from backend on startup
    this.loadSettingsWhenReady();
  }

  /**
   * Wait for backend to be ready before loading settings
   * This prevents ERR_CONNECTION_REFUSED errors during startup
   */
  private async loadSettingsWhenReady(): Promise<void> {
    // Wait for backend to be ready (check via backend_ready API)
    // Increased timeout to 60 seconds to match WebSocket initialization timeout
    const maxWaitTime = 60000; // 60 seconds max wait (models can take time to load)
    const checkInterval = 500; // Check every 500ms
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      try {
        // Check if backend is ready via the proper API
        if (window.electronAPI && "backend_ready" in window.electronAPI) {
          const ready = await window.electronAPI.backend_ready.isReady();
          if (ready) {
            // Backend is ready, now load settings
            await this.loadSettings();
            return;
          }
        } else {
          // If electronAPI is not available yet, wait a bit and retry
          await new Promise((resolve) => setTimeout(resolve, checkInterval));
          continue;
        }
        // Not ready yet, wait a bit
        await new Promise((resolve) => setTimeout(resolve, checkInterval));
      } catch (error) {
        // Log error for debugging but continue waiting
        console.debug(
          "[AttendanceManager] Error checking backend readiness:",
          error,
        );
        await new Promise((resolve) => setTimeout(resolve, checkInterval));
      }
    }

    // Timeout - try to load settings anyway (backend might be ready but API check failed)
    console.warn(
      "[AttendanceManager] Backend not ready after timeout, attempting to load settings anyway...",
    );
    try {
      await this.loadSettings();
    } catch (error) {
      console.warn(
        "[AttendanceManager] Failed to load settings after timeout, using default settings:",
        error,
      );
    }
  }

  private async loadSettings(): Promise<void> {
    try {
      this.settings = await this.httpClient.get<AttendanceSettings>(
        API_ENDPOINTS.settings,
      );
      console.log("[AttendanceManager] Settings loaded successfully");
    } catch (error) {
      console.error(
        "[AttendanceManager] Failed to load settings, using defaults:",
        error,
      );
      // Keep default settings if backend is not available
    }
  }

  // Group Management
  async createGroup(
    name: string,
    description?: string,
  ): Promise<AttendanceGroup> {
    try {
      const groupData = {
        name,
        description,
        settings: {
          late_threshold_minutes: this.settings?.late_threshold_minutes ?? 15,
          late_threshold_enabled: false,
        },
      };

      const group = await this.httpClient.post<AttendanceGroup>(
        API_ENDPOINTS.groups,
        groupData,
      );
      return {
        ...group,
        created_at: new Date(group.created_at),
      };
    } catch (error) {
      console.error("Error creating group:", error);
      throw error;
    }
  }

  async getGroups(): Promise<AttendanceGroup[]> {
    try {
      const groups = await this.httpClient.get<AttendanceGroup[]>(
        API_ENDPOINTS.groups,
        { active_only: "true" },
      );
      return groups.map((group) => ({
        ...group,
        created_at: new Date(group.created_at),
      }));
    } catch (error) {
      console.error("Error getting groups:", error);
      return [];
    }
  }

  async getGroup(groupId: string): Promise<AttendanceGroup | undefined> {
    try {
      const group = await this.httpClient.get<AttendanceGroup>(
        `${API_ENDPOINTS.groups}/${groupId}`,
      );
      return {
        ...group,
        created_at: new Date(group.created_at),
      };
    } catch (error) {
      console.error("Error getting group:", error);
      return undefined;
    }
  }

  async updateGroup(
    groupId: string,
    updates: Partial<AttendanceGroup>,
  ): Promise<boolean> {
    try {
      await this.httpClient.put<AttendanceGroup>(
        `${API_ENDPOINTS.groups}/${groupId}`,
        updates,
      );
      return true;
    } catch (error) {
      console.error("Error updating group:", error);
      return false;
    }
  }

  async deleteGroup(groupId: string): Promise<boolean> {
    try {
      await this.httpClient.delete(`${API_ENDPOINTS.groups}/${groupId}`);
      return true;
    } catch (error) {
      console.error("Error deleting group:", error);
      return false;
    }
  }

  // Member Management
  async addMember(
    groupId: string,
    name: string,
    options?: {
      personId?: string;
      role?: string;
      email?: string;
    },
  ): Promise<AttendanceMember> {
    try {
      const memberData: {
        group_id: string;
        name: string;
        role?: string;
        email?: string;
        person_id?: string;
      } = {
        group_id: groupId,
        name,
        role: options?.role,
        email: options?.email,
      };

      // Only include person_id if explicitly provided
      if (options?.personId) {
        memberData.person_id = options.personId;
      }

      const member = await this.httpClient.post<AttendanceMember>(
        API_ENDPOINTS.members,
        memberData,
      );
      return {
        ...member,
        joined_at: new Date(member.joined_at),
      };
    } catch (error) {
      console.error("Error adding member:", error);
      throw error;
    }
  }

  async getMember(personId: string): Promise<AttendanceMember | undefined> {
    try {
      const member = await this.httpClient.get<AttendanceMember>(
        `${API_ENDPOINTS.members}/${personId}`,
      );
      return {
        ...member,
        joined_at: new Date(member.joined_at),
      };
    } catch {
      // Silently return undefined if member not found (person_id exists in face DB but not in attendance)
      // This is normal when someone is recognized but not enrolled in the current group
      return undefined;
    }
  }

  async getGroupMembers(groupId: string): Promise<AttendanceMember[]> {
    try {
      // Use the persons endpoint which includes face data status
      const members = await this.httpClient.get<
        Array<{
          person_id: string;
          name: string;
          role?: string;
          email?: string;
          has_face_data: boolean;
          joined_at: string;
          is_active: boolean;
          group_id: string;
        }>
      >(`${API_ENDPOINTS.groups}/${groupId}/persons`);

      return members.map((member) => ({
        person_id: member.person_id,
        group_id: member.group_id,
        name: member.name,
        role: member.role,
        email: member.email,
        joined_at: new Date(member.joined_at),
        is_active: member.is_active,
        has_face_data: member.has_face_data,
      }));
    } catch (error) {
      console.error("Error getting group members:", error);
      return [];
    }
  }

  async updateMember(
    personId: string,
    updates: Partial<AttendanceMember>,
  ): Promise<boolean> {
    try {
      await this.httpClient.put<AttendanceMember>(
        `${API_ENDPOINTS.members}/${personId}`,
        updates,
      );
      return true;
    } catch (error) {
      console.error("Error updating member:", error);
      return false;
    }
  }

  async removeMember(personId: string): Promise<boolean> {
    try {
      await this.httpClient.delete(`${API_ENDPOINTS.members}/${personId}`);
      return true;
    } catch (error) {
      console.error("Error removing member:", error);
      return false;
    }
  }

  // Attendance Tracking
  async processAttendanceEvent(
    personId: string,
    confidence: number,
    location?: string,
    livenessStatus?: string,
    livenessConfidence?: number,
  ): Promise<AttendanceEvent | null> {
    try {
      const eventData = {
        person_id: personId,
        confidence,
        location,
        liveness_status: livenessStatus,
        liveness_confidence: livenessConfidence,
      };

      const event = await this.httpClient.post<AttendanceEvent>(
        API_ENDPOINTS.events,
        eventData,
      );

      // Convert timestamp to Date object
      const processedEvent: AttendanceEvent = {
        ...event,
        timestamp: new Date(event.timestamp),
      };

      this.eventQueue.push(processedEvent);
      return processedEvent;
    } catch (error: unknown) {
      console.error("Error processing attendance event:", error);
      throw error;
    }
  }

  // Statistics and Reports
  async getGroupStats(groupId: string, date?: Date): Promise<AttendanceStats> {
    try {
      const params: Record<string, string> = {};
      if (date) {
        params.date = getLocalDateString(date);
      }

      return await this.httpClient.get<AttendanceStats>(
        `${API_ENDPOINTS.groups}/${groupId}/stats`,
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
  ): Promise<AttendanceReport> {
    try {
      // For now, we'll implement a basic report generation
      // This would typically be a dedicated backend endpoint
      const [group, members, , sessions] = await Promise.all([
        this.getGroup(groupId),
        this.getGroupMembers(groupId),
        this.getRecords({
          group_id: groupId,
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
        }),
        this.getSessions({
          group_id: groupId,
          start_date: getLocalDateString(startDate),
          end_date: getLocalDateString(endDate),
        }),
      ]);

      if (!group) {
        throw new Error("Group not found");
      }

      // Calculate the total number of days in the selected range (inclusive)
      const timeDiff = Math.abs(endDate.getTime() - startDate.getTime());
      const totalDaysInRange = Math.ceil(timeDiff / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end

      const memberReports = members.map((member) => {
        // Handle joined_at date - convert to Date if needed and validate
        let memberJoinedAt: Date;
        if (member.joined_at instanceof Date) {
          memberJoinedAt = member.joined_at;
        } else if (member.joined_at) {
          memberJoinedAt = new Date(member.joined_at);
          if (Number.isNaN(memberJoinedAt.getTime())) {
            // Invalid date, use report start date as fallback
            memberJoinedAt = startDate;
          }
        } else {
          // No joined_at date, use report start date as fallback
          memberJoinedAt = startDate;
        }

        // Calculate effective date range (start from member's join date or report start date, whichever is later)
        const effectiveStartDate =
          memberJoinedAt > startDate ? memberJoinedAt : startDate;
        const effectiveEndDate = endDate;

        // Calculate total days the member was actually in the group during the report period
        const memberTimeDiff = Math.abs(
          effectiveEndDate.getTime() - effectiveStartDate.getTime(),
        );
        const totalDaysMemberWasInGroup =
          Math.ceil(memberTimeDiff / (1000 * 60 * 60 * 24)) + 1;

        // Only count sessions after the member joined (including the join date itself)
        // Filter out any old sessions that might exist for dates before joined_at
        const memberSessions = sessions.filter((s) => {
          if (s.person_id !== member.person_id) return false;
          const sessionDate = new Date(s.date);
          sessionDate.setHours(0, 0, 0, 0);
          const joinedDate = new Date(memberJoinedAt);
          joinedDate.setHours(0, 0, 0, 0);
          // Include sessions on or after the join date
          return sessionDate >= joinedDate;
        });

        const presentDays = memberSessions.filter(
          (s) => s.status !== "absent",
        ).length;

        // Only count absent days for the period when member was actually in the group
        const absentDays =
          totalDaysMemberWasInGroup > 0
            ? totalDaysMemberWasInGroup - presentDays
            : 0;
        const lateDays = memberSessions.filter((s) => s.is_late).length;
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
          ? memberReports.reduce((sum, m) => sum + m.attendance_rate, 0) /
            memberReports.length
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
          total_working_days: totalDaysInRange, // Use the total days in the selected range
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

  // Data Access Methods
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
        API_ENDPOINTS.records,
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
        API_ENDPOINTS.sessions,
        params,
      );

      // Convert check_in_time strings to Date objects
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

  // Settings
  async getSettings(): Promise<AttendanceSettings> {
    // If settings not loaded yet, load them now
    if (!this.settings) {
      await this.loadSettings();
    }
    return { ...this.settings! };
  }

  async updateSettings(
    newSettings: Partial<AttendanceSettings>,
  ): Promise<void> {
    try {
      const updatedSettings = await this.httpClient.put<AttendanceSettings>(
        API_ENDPOINTS.settings,
        newSettings,
      );
      this.settings = updatedSettings;
    } catch (error) {
      console.error("Error updating settings:", error);
      throw error;
    }
  }

  // Export/Import
  async exportData(): Promise<string> {
    try {
      const [groups, members, records, sessions, settings] = await Promise.all([
        this.getGroups(),
        this.httpClient.get<AttendanceMember[]>(API_ENDPOINTS.members),
        this.getRecords(),
        this.getSessions(),
        this.getSettings(),
      ]);

      return JSON.stringify(
        {
          groups,
          members: members.map((m) => ({
            ...m,
            joined_at: new Date(m.joined_at),
          })),
          records,
          sessions,
          settings,
          exported_at: new Date().toISOString(),
        },
        null,
        2,
      );
    } catch (error) {
      console.error("Error exporting data:", error);
      throw error;
    }
  }

  async importData(): Promise<boolean> {
    try {
      // This would require a dedicated import endpoint on the backend
      // For now, we'll throw an error indicating this needs backend support
      throw new Error("Import functionality requires backend implementation");
    } catch (err) {
      console.error(
        "Error importing data:",
        err instanceof Error ? err.message : "Unknown error",
      );
      return false;
    }
  }

  // Cleanup old data
  async cleanupOldData(daysToKeep: number = 90): Promise<void> {
    try {
      await this.httpClient.post("/attendance/cleanup", {
        days_to_keep: daysToKeep,
      });
    } catch (err) {
      console.error("Error cleaning up old data:", err);
      throw err;
    }
  }

  // Health check
  async isBackendAvailable(): Promise<boolean> {
    try {
      await this.httpClient.get("/");
      return true;
    } catch {
      return false;
    }
  }

  // Get backend statistics
  async getBackendStats(): Promise<Record<string, unknown>> {
    try {
      return await this.httpClient.get<Record<string, unknown>>(
        API_ENDPOINTS.stats,
      );
    } catch (error) {
      console.error("Error getting backend stats:", error);
      return {};
    }
  }

  // Group-Specific Person Management
  async getGroupPersons(groupId: string): Promise<
    Array<{
      person_id: string;
      name: string;
      role?: string;
      email?: string;
      has_face_data: boolean;
      joined_at: Date;
    }>
  > {
    try {
      const persons = await this.httpClient.get<
        Array<{
          person_id: string;
          name: string;
          role?: string;
          email?: string;
          has_face_data: boolean;
          joined_at: string;
        }>
      >(`${API_ENDPOINTS.groups}/${groupId}/persons`);
      return persons.map((person) => ({
        ...person,
        joined_at: new Date(person.joined_at),
      }));
    } catch (error) {
      console.error("Error getting group persons:", error);
      return [];
    }
  }

  async registerFaceForGroupPerson(
    groupId: string,
    personId: string,
    imageData: string,
    bbox: number[],
    landmarks_5?: number[][],
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const result = await this.httpClient.post<{
        success: boolean;
        message: string;
        person_id: string;
        group_id: string;
        total_persons: number;
      }>(
        `${API_ENDPOINTS.groups}/${groupId}/persons/${personId}/register-face`,
        {
          image: imageData,
          bbox: bbox,
          landmarks_5: landmarks_5,
        },
      );
      return { success: true, message: result.message };
    } catch (error) {
      console.error("Error registering face for group person:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to register face",
      };
    }
  }

  async removeFaceDataForGroupPerson(
    groupId: string,
    personId: string,
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const result = await this.httpClient.delete<{
        success: boolean;
        message: string;
        person_id: string;
        group_id: string;
      }>(`${API_ENDPOINTS.groups}/${groupId}/persons/${personId}/face-data`);
      return { success: true, message: result.message };
    } catch (error) {
      console.error("Error removing face data for group person:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to remove face data",
      };
    }
  }

  async getAttendanceStats(): Promise<AttendanceStats> {
    try {
      const response =
        await this.httpClient.get<AttendanceStats>("/attendance/stats");
      return response;
    } catch (error) {
      console.error("Error getting attendance stats:", error);
      return {
        total_members: 0,
        present_today: 0,
        absent_today: 0,
        late_today: 0,
      };
    }
  }
}

// Singleton instance
export const attendanceManager = new AttendanceManager();
