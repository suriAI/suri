import type {
  AttendanceMember,
  AttendanceGroup,
  AttendanceRecord,
  AttendanceSession,
  AttendanceSettings,
} from "../../types/recognition";
import type { HttpClient } from "./HttpClient";

export class BackupManager {
  private httpClient: HttpClient;
  private apiEndpoints: Record<string, string>;
  private getGroups: () => Promise<AttendanceGroup[]>;
  private getRecords: () => Promise<AttendanceRecord[]>;
  private getSessions: () => Promise<AttendanceSession[]>;
  private getSettings: () => Promise<AttendanceSettings>;

  constructor(
    httpClient: HttpClient,
    apiEndpoints: Record<string, string>,
    getGroups: () => Promise<AttendanceGroup[]>,
    getRecords: () => Promise<AttendanceRecord[]>,
    getSessions: () => Promise<AttendanceSession[]>,
    getSettings: () => Promise<AttendanceSettings>,
  ) {
    this.httpClient = httpClient;
    this.apiEndpoints = apiEndpoints;
    this.getGroups = getGroups;
    this.getRecords = getRecords;
    this.getSessions = getSessions;
    this.getSettings = getSettings;
  }

  async exportData(): Promise<string> {
    try {
      const [groups, members, records, sessions, settings] = await Promise.all([
        this.getGroups(),
        this.httpClient.get<AttendanceMember[]>(this.apiEndpoints.members),
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

  async importData(jsonData: string): Promise<boolean> {
    try {
      const parsed = JSON.parse(jsonData);
      const result = await this.httpClient.post<{
        success: boolean;
        message: string;
      }>("/attendance/import", { data: parsed, overwrite_existing: false });

      console.info("[BackupManager] Import result:", result.message);
      return true;
    } catch (err) {
      console.error(
        "[BackupManager] Error importing data:",
        err instanceof Error ? err.message : "Unknown error",
      );
      return false;
    }
  }

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
}
