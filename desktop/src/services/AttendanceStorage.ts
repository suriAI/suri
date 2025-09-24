import type {
  AttendanceGroup,
  AttendanceMember,
  AttendanceRecord,
  AttendanceSession,
  AttendanceSettings
} from '../types/recognition.js';

export interface AttendanceData {
  groups: AttendanceGroup[];
  members: AttendanceMember[];
  records: AttendanceRecord[];
  sessions: AttendanceSession[];
  settings: AttendanceSettings;
  version: string;
  exported_at: string;
}

export class AttendanceStorage {
  private readonly STORAGE_KEYS = {
    GROUPS: 'attendance_groups',
    MEMBERS: 'attendance_members',
    RECORDS: 'attendance_records',
    SESSIONS: 'attendance_sessions',
    SETTINGS: 'attendance_settings',
    VERSION: 'attendance_version'
  };

  private readonly CURRENT_VERSION = '1.0.0';

  // Save operations
  saveGroups(groups: AttendanceGroup[]): void {
    try {
      localStorage.setItem(this.STORAGE_KEYS.GROUPS, JSON.stringify(groups));
    } catch (error) {
      console.error('Error saving attendance groups:', error);
      throw new Error('Failed to save attendance groups');
    }
  }

  saveMembers(members: AttendanceMember[]): void {
    try {
      localStorage.setItem(this.STORAGE_KEYS.MEMBERS, JSON.stringify(members));
    } catch (error) {
      console.error('Error saving attendance members:', error);
      throw new Error('Failed to save attendance members');
    }
  }

  saveRecords(records: AttendanceRecord[]): void {
    try {
      // Only keep recent records to prevent storage overflow
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const recentRecords = records.filter(record => 
        record.timestamp >= thirtyDaysAgo
      );
      
      localStorage.setItem(this.STORAGE_KEYS.RECORDS, JSON.stringify(recentRecords));
    } catch (error) {
      console.error('Error saving attendance records:', error);
      throw new Error('Failed to save attendance records');
    }
  }

  saveSessions(sessions: AttendanceSession[]): void {
    try {
      // Only keep recent sessions to prevent storage overflow
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const cutoffDateStr = thirtyDaysAgo.toISOString().split('T')[0];
      
      const recentSessions = sessions.filter(session => 
        session.date >= cutoffDateStr
      );
      
      localStorage.setItem(this.STORAGE_KEYS.SESSIONS, JSON.stringify(recentSessions));
    } catch (error) {
      console.error('Error saving attendance sessions:', error);
      throw new Error('Failed to save attendance sessions');
    }
  }

  saveSettings(settings: AttendanceSettings): void {
    try {
      localStorage.setItem(this.STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch (error) {
      console.error('Error saving attendance settings:', error);
      throw new Error('Failed to save attendance settings');
    }
  }

  // Load operations
  loadGroups(): AttendanceGroup[] {
    try {
      const data = localStorage.getItem(this.STORAGE_KEYS.GROUPS);
      if (!data) return [];
      
      const groups = JSON.parse(data);
      return groups.map((group: AttendanceGroup) => ({
        ...group,
        created_at: new Date(group.created_at)
      }));
    } catch (error) {
      console.error('Error loading attendance groups:', error);
      return [];
    }
  }

  loadMembers(): AttendanceMember[] {
    try {
      const data = localStorage.getItem(this.STORAGE_KEYS.MEMBERS);
      if (!data) return [];
      
      const members = JSON.parse(data);
      return members.map((member: AttendanceMember) => ({
        ...member,
        joined_at: new Date(member.joined_at)
      }));
    } catch (error) {
      console.error('Error loading attendance members:', error);
      return [];
    }
  }

  loadRecords(): AttendanceRecord[] {
    try {
      const data = localStorage.getItem(this.STORAGE_KEYS.RECORDS);
      if (!data) return [];
      
      const records = JSON.parse(data);
      return records.map((record: AttendanceRecord) => ({
        ...record,
        timestamp: new Date(record.timestamp)
      }));
    } catch (error) {
      console.error('Error loading attendance records:', error);
      return [];
    }
  }

  loadSessions(): AttendanceSession[] {
    try {
      const data = localStorage.getItem(this.STORAGE_KEYS.SESSIONS);
      if (!data) return [];
      
      const sessions = JSON.parse(data);
      return sessions.map((session: AttendanceSession) => ({
        ...session,
        check_in: session.check_in ? new Date(session.check_in) : undefined,
        check_out: session.check_out ? new Date(session.check_out) : undefined,
        break_start: session.break_start ? new Date(session.break_start) : undefined,
        break_end: session.break_end ? new Date(session.break_end) : undefined
      }));
    } catch (error) {
      console.error('Error loading attendance sessions:', error);
      return [];
    }
  }

  loadSettings(): AttendanceSettings | null {
    try {
      const data = localStorage.getItem(this.STORAGE_KEYS.SETTINGS);
      if (!data) return null;
      
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading attendance settings:', error);
      return null;
    }
  }

  // Bulk operations
  saveAll(data: {
    groups: AttendanceGroup[];
    members: AttendanceMember[];
    records: AttendanceRecord[];
    sessions: AttendanceSession[];
    settings: AttendanceSettings;
  }): void {
    try {
      this.saveGroups(data.groups);
      this.saveMembers(data.members);
      this.saveRecords(data.records);
      this.saveSessions(data.sessions);
      this.saveSettings(data.settings);
      localStorage.setItem(this.STORAGE_KEYS.VERSION, this.CURRENT_VERSION);
    } catch (error) {
      console.error('Error saving all attendance data:', error);
      throw new Error('Failed to save attendance data');
    }
  }

  loadAll(): {
    groups: AttendanceGroup[];
    members: AttendanceMember[];
    records: AttendanceRecord[];
    sessions: AttendanceSession[];
    settings: AttendanceSettings | null;
  } {
    return {
      groups: this.loadGroups(),
      members: this.loadMembers(),
      records: this.loadRecords(),
      sessions: this.loadSessions(),
      settings: this.loadSettings()
    };
  }

  // Export/Import operations
  exportToJSON(): string {
    const data = this.loadAll();
    const exportData: AttendanceData = {
      groups: data.groups,
      members: data.members,
      records: data.records,
      sessions: data.sessions,
      settings: data.settings || this.getDefaultSettings(),
      version: this.CURRENT_VERSION,
      exported_at: new Date().toISOString()
    };

    return JSON.stringify(exportData, null, 2);
  }

  importFromJSON(jsonData: string): boolean {
    try {
      const data: AttendanceData = JSON.parse(jsonData);
      
      // Validate data structure
      if (!this.validateImportData(data)) {
        throw new Error('Invalid data format');
      }

      // Convert date strings back to Date objects
      const processedData = {
        groups: data.groups.map(group => ({
          ...group,
          created_at: new Date(group.created_at)
        })),
        members: data.members.map(member => ({
          ...member,
          joined_at: new Date(member.joined_at)
        })),
        records: data.records.map(record => ({
          ...record,
          timestamp: new Date(record.timestamp)
        })),
        sessions: data.sessions.map(session => ({
          ...session,
          check_in: session.check_in ? new Date(session.check_in) : undefined,
          check_out: session.check_out ? new Date(session.check_out) : undefined,
          break_start: session.break_start ? new Date(session.break_start) : undefined,
          break_end: session.break_end ? new Date(session.break_end) : undefined
        })),
        settings: data.settings
      };

      this.saveAll(processedData);
      return true;
    } catch (error) {
      console.error('Error importing attendance data:', error);
      return false;
    }
  }

  private validateImportData(data: AttendanceData): boolean {
    return (
      Array.isArray(data.groups) &&
      Array.isArray(data.members) &&
      Array.isArray(data.records) &&
      Array.isArray(data.sessions) &&
      typeof data.settings === 'object' &&
      typeof data.version === 'string'
    );
  }

  // Backup operations
  createBackup(): Blob {
    const jsonData = this.exportToJSON();
    return new Blob([jsonData], { type: 'application/json' });
  }

  async restoreFromBackup(file: File): Promise<boolean> {
    try {
      const text = await file.text();
      return this.importFromJSON(text);
    } catch (error) {
      console.error('Error restoring from backup:', error);
      return false;
    }
  }

  // CSV Export operations
  exportGroupMembersToCSV(groupId: string): string {
    const members = this.loadMembers().filter(m => m.group_id === groupId && m.is_active);
    
    const headers = ['Person ID', 'Name', 'Role', 'Employee ID', 'Student ID', 'Email', 'Joined Date'];
    const rows = members.map(member => [
      member.person_id,
      member.name,
      member.role || '',
      member.employee_id || '',
      member.student_id || '',
      member.email || '',
      member.joined_at.toISOString().split('T')[0]
    ]);

    return [headers, ...rows].map(row => 
      row.map(cell => `"${cell}"`).join(',')
    ).join('\n');
  }

  exportAttendanceRecordsToCSV(groupId: string, startDate: Date, endDate: Date): string {
    const records = this.loadRecords().filter(record => 
      record.group_id === groupId &&
      record.timestamp >= startDate &&
      record.timestamp <= endDate
    );

    const members = this.loadMembers();
    const memberMap = new Map(members.map(m => [m.person_id, m.name]));

    const headers = ['Date', 'Time', 'Person ID', 'Name', 'Type', 'Confidence', 'Manual', 'Notes'];
    const rows = records.map(record => [
      record.timestamp.toISOString().split('T')[0],
      record.timestamp.toTimeString().split(' ')[0],
      record.person_id,
      memberMap.get(record.person_id) || 'Unknown',
      record.type,
      record.confidence.toFixed(2),
      record.is_manual ? 'Yes' : 'No',
      record.notes || ''
    ]);

    return [headers, ...rows].map(row => 
      row.map(cell => `"${cell}"`).join(',')
    ).join('\n');
  }

  // Cleanup operations
  clearAllData(): void {
    Object.values(this.STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
  }

  cleanupOldData(daysToKeep: number = 30): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    // Clean old records
    const records = this.loadRecords().filter(record => 
      record.timestamp >= cutoffDate
    );
    this.saveRecords(records);

    // Clean old sessions
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
    const sessions = this.loadSessions().filter(session => 
      session.date >= cutoffDateStr
    );
    this.saveSessions(sessions);
  }

  // Storage info
  getStorageInfo(): {
    used: number;
    available: number;
    percentage: number;
  } {
    try {
      let used = 0;
      Object.values(this.STORAGE_KEYS).forEach(key => {
        const data = localStorage.getItem(key);
        if (data) {
          used += new Blob([data]).size;
        }
      });

      // Estimate available space (localStorage typically has 5-10MB limit)
      const estimated_limit = 5 * 1024 * 1024; // 5MB
      const available = estimated_limit - used;
      const percentage = (used / estimated_limit) * 100;

      return {
        used,
        available: Math.max(0, available),
        percentage: Math.min(100, percentage)
      };
    } catch (error) {
      console.error('Error getting storage info:', error);
      return { used: 0, available: 0, percentage: 0 };
    }
  }

  private getDefaultSettings(): AttendanceSettings {
    return {
      default_group_type: 'general',
      auto_checkout_enabled: true,
      auto_checkout_hours: 8,
      late_threshold_minutes: 15,
      break_duration_minutes: 60,
      require_manual_checkout: false,
      enable_break_tracking: true,
      enable_location_tracking: false,
      confidence_threshold: 0.7
    };
  }
}

// Singleton instance
export const attendanceStorage = new AttendanceStorage();