import type {
  AttendanceGroup,
  AttendanceMember,
  AttendanceRecord,
  AttendanceSession,
  AttendanceStats,
  AttendanceReport,
  AttendanceSettings,
  AttendanceEvent,
} from "../types/recognition";

import { HttpClient } from "./attendance/HttpClient";
import { GroupManager } from "./attendance/GroupManager";
import { MemberManager } from "./attendance/MemberManager";
import { RecordManager } from "./attendance/RecordManager";
import { BackupManager } from "./attendance/BackupManager";

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

export class AttendanceManager {
  private readonly clockCheckStorageKey = "suri:lastSystemTimeMs";
  private readonly clockBackwardWarnThresholdMs = 60 * 1000; // 60 seconds

  private httpClient: HttpClient;
  private groupManager: GroupManager;
  private memberManager: MemberManager;
  private recordManager: RecordManager;
  private backupManager: BackupManager;

  private settings: AttendanceSettings | null = null;
  private eventQueue: AttendanceEvent[] = [];

  constructor() {
    this.httpClient = new HttpClient(API_BASE_URL);
    this.groupManager = new GroupManager(this.httpClient, API_ENDPOINTS);
    this.memberManager = new MemberManager(this.httpClient, API_ENDPOINTS);

    this.recordManager = new RecordManager(
      this.httpClient,
      API_ENDPOINTS,
      this.toLocalDateTimeParam.bind(this),
      this.warnIfSystemClockWentBackwards.bind(this),
    );

    this.backupManager = new BackupManager(
      this.httpClient,
      API_ENDPOINTS,
      this.getGroups.bind(this),
      this.getRecords.bind(this),
      this.getSessions.bind(this),
      this.getSettings.bind(this),
    );

    this.loadSettingsWhenReady();
  }

  // --- Core Lifecycle ---

  private async loadSettingsWhenReady(): Promise<void> {
    const maxWaitTime = 60000;
    const checkInterval = 500;
    const startTime = Date.now();

    try {
      if (window.electronAPI && "backend_ready" in window.electronAPI) {
        const ready = await window.electronAPI.backend_ready.isReady();
        if (ready) {
          await this.loadSettings();
          return;
        }
      }
    } catch (error) {
      console.debug(
        "[AttendanceManager] Error checking backend readiness:",
        error,
      );
    }

    while (Date.now() - startTime < maxWaitTime) {
      try {
        if (window.electronAPI && "backend_ready" in window.electronAPI) {
          const ready = await window.electronAPI.backend_ready.isReady();
          if (ready) {
            await this.loadSettings();
            return;
          }
        } else {
          await new Promise((resolve) => setTimeout(resolve, checkInterval));
          continue;
        }
        await new Promise((resolve) => setTimeout(resolve, checkInterval));
      } catch (error) {
        console.debug(
          "[AttendanceManager] Error checking backend readiness:",
          error,
        );
        await new Promise((resolve) => setTimeout(resolve, checkInterval));
      }
    }

    console.warn(
      "[AttendanceManager] Backend not ready after timeout, attempting to load anyway...",
    );
    try {
      await this.loadSettings();
    } catch (error) {
      console.warn("[AttendanceManager] Failed to load settings:", error);
    }
  }

  private async loadSettings(): Promise<void> {
    try {
      this.settings = await this.httpClient.get<AttendanceSettings>(
        API_ENDPOINTS.settings,
      );
    } catch (error) {
      console.error("[AttendanceManager] Failed to load settings:", error);
    }
  }

  // --- Group Management (Delegated) ---

  async createGroup(
    name: string,
    description?: string,
  ): Promise<AttendanceGroup> {
    return this.groupManager.createGroup(name, description, this.settings);
  }

  async getGroups(): Promise<AttendanceGroup[]> {
    return this.groupManager.getGroups();
  }

  async getGroup(groupId: string): Promise<AttendanceGroup | undefined> {
    return this.groupManager.getGroup(groupId);
  }

  async updateGroup(
    groupId: string,
    updates: Partial<AttendanceGroup>,
  ): Promise<boolean> {
    return this.groupManager.updateGroup(groupId, updates);
  }

  async deleteGroup(groupId: string): Promise<boolean> {
    return this.groupManager.deleteGroup(groupId);
  }

  async getGroupMembers(groupId: string): Promise<AttendanceMember[]> {
    return this.groupManager.getGroupMembers(groupId);
  }

  // --- Member Management (Delegated) ---

  async addMember(
    groupId: string,
    name: string,
    options?: { personId?: string; role?: string; email?: string },
  ): Promise<AttendanceMember> {
    return this.memberManager.addMember(groupId, name, options);
  }

  async getMember(personId: string): Promise<AttendanceMember | undefined> {
    return this.memberManager.getMember(personId);
  }

  async updateMember(
    personId: string,
    updates: Partial<AttendanceMember>,
  ): Promise<boolean> {
    return this.memberManager.updateMember(personId, updates);
  }

  async getMembers(): Promise<AttendanceMember[]> {
    return this.memberManager.getMembers();
  }

  async removeMember(personId: string): Promise<boolean> {
    return this.memberManager.removeMember(personId);
  }

  async getGroupPersons(groupId: string): Promise<AttendanceMember[]> {
    return this.groupManager.getGroupMembers(groupId);
  }

  // Re-adding missed face methods in facade
  async registerFaceForGroupPerson(
    groupId: string,
    personId: string,
    imageData: string,
    bbox: number[],
    landmarks_5: number[][],
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.memberManager.registerFaceForGroupPerson(
      groupId,
      personId,
      imageData,
      bbox,
      landmarks_5,
    );
  }

  async removeFaceDataForGroupPerson(
    groupId: string,
    personId: string,
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.memberManager.removeFaceDataForGroupPerson(groupId, personId);
  }

  // --- Record & Session Management (Delegated) ---

  async processAttendanceEvent(
    personId: string,
    confidence: number,
    location?: string,
    livenessStatus?: string,
    livenessConfidence?: number,
  ): Promise<AttendanceEvent | null> {
    const event = await this.recordManager.processAttendanceEvent(
      personId,
      confidence,
      location,
      livenessStatus,
      livenessConfidence,
    );
    if (event) this.eventQueue.push(event);
    return event;
  }

  async getGroupStats(groupId: string, date?: Date): Promise<AttendanceStats> {
    return this.recordManager.getGroupStats(groupId, date);
  }

  async generateReport(
    groupId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<AttendanceReport> {
    return this.recordManager.generateReport(
      groupId,
      startDate,
      endDate,
      this.getGroup.bind(this),
      this.getGroupMembers.bind(this),
    );
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
    return this.recordManager.addRecord(record);
  }

  async getRecords(filters?: {
    group_id?: string;
    person_id?: string;
    start_date?: string;
    end_date?: string;
    limit?: number;
  }): Promise<AttendanceRecord[]> {
    return this.recordManager.getRecords(filters);
  }

  async getSessions(filters?: {
    group_id?: string;
    person_id?: string;
    start_date?: string;
    end_date?: string;
  }): Promise<AttendanceSession[]> {
    return this.recordManager.getSessions(filters);
  }

  // --- Settings (Internal to Facade for now) ---

  async getSettings(): Promise<AttendanceSettings> {
    if (!this.settings) await this.loadSettings();
    return { ...this.settings! };
  }

  async updateSettings(
    newSettings: Partial<AttendanceSettings>,
  ): Promise<void> {
    try {
      const updated = await this.httpClient.put<AttendanceSettings>(
        API_ENDPOINTS.settings,
        newSettings,
      );
      this.settings = updated;
    } catch (error) {
      console.error("Error updating settings:", error);
      throw error;
    }
  }

  // --- Maintenance & Backup (Delegated) ---

  async exportData(): Promise<string> {
    return this.backupManager.exportData();
  }

  async importData(jsonData: string): Promise<boolean> {
    return this.backupManager.importData(jsonData);
  }

  async cleanupOldData(daysToKeep: number = 90): Promise<void> {
    return this.backupManager.cleanupOldData(daysToKeep);
  }

  async isBackendAvailable(): Promise<boolean> {
    try {
      await this.httpClient.get("/");
      return true;
    } catch {
      return false;
    }
  }

  async getBackendStats(): Promise<Record<string, unknown>> {
    try {
      return await this.httpClient.get<Record<string, unknown>>(
        API_ENDPOINTS.stats,
      );
    } catch {
      return {};
    }
  }

  async getAttendanceStats(): Promise<AttendanceStats> {
    try {
      return await this.httpClient.get<AttendanceStats>("/attendance/stats");
    } catch {
      return {
        total_members: 0,
        present_today: 0,
        absent_today: 0,
        late_today: 0,
      };
    }
  }

  // --- Helpers ---

  private warnIfSystemClockWentBackwards(): void {
    try {
      const now = Date.now();
      const lastRaw = localStorage.getItem(this.clockCheckStorageKey);
      const last = lastRaw ? Number(lastRaw) : NaN;

      if (
        Number.isFinite(last) &&
        now + this.clockBackwardWarnThresholdMs < last
      ) {
        const diffMs = last - now;
        const diffMinutes = Math.max(1, Math.round(diffMs / 60000));
        window.dispatchEvent(
          new CustomEvent("suri:clock-warning", {
            detail: {
              message: `System clock appears to have moved backwards by more than 1 minute (~${diffMinutes} minute(s)).`,
            },
          }),
        );
      }
      localStorage.setItem(this.clockCheckStorageKey, String(now));
    } catch {
      /* ignore */
    }
  }

  private toLocalDateTimeParam(date: Date): string {
    const pad = (n: number, len: number = 2) => String(n).padStart(len, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
  }
}

export const attendanceManager = new AttendanceManager();
