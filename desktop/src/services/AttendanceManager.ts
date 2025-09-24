import type {
  AttendanceGroup,
  AttendanceMember,
  AttendanceRecord,
  AttendanceSession,
  AttendanceStats,
  AttendanceReport,
  AttendanceSettings,
  AttendanceEvent,
  AttendanceType,
  GroupType
} from '../types/recognition.js';

export class AttendanceManager {
  private groups: Map<string, AttendanceGroup> = new Map();
  private members: Map<string, AttendanceMember> = new Map();
  private records: AttendanceRecord[] = [];
  private sessions: Map<string, AttendanceSession> = new Map();
  private settings: AttendanceSettings;
  private eventQueue: AttendanceEvent[] = [];

  constructor() {
    this.settings = this.getDefaultSettings();
    this.loadData();
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

  private loadData(): void {
    try {
      // Load from localStorage
      const groupsData = localStorage.getItem('attendance_groups');
      const membersData = localStorage.getItem('attendance_members');
      const recordsData = localStorage.getItem('attendance_records');
      const sessionsData = localStorage.getItem('attendance_sessions');
      const settingsData = localStorage.getItem('attendance_settings');

      if (groupsData) {
        const groups = JSON.parse(groupsData);
        groups.forEach((group: AttendanceGroup) => {
          group.created_at = new Date(group.created_at);
          this.groups.set(group.id, group);
        });
      }

      if (membersData) {
        const members = JSON.parse(membersData);
        members.forEach((member: AttendanceMember) => {
          member.joined_at = new Date(member.joined_at);
          this.members.set(member.person_id, member);
        });
      }

      if (recordsData) {
        this.records = JSON.parse(recordsData).map((record: AttendanceRecord) => ({
          ...record,
          timestamp: new Date(record.timestamp)
        }));
      }

      if (sessionsData) {
        const sessions = JSON.parse(sessionsData);
        sessions.forEach((session: AttendanceSession) => {
          session.check_in = session.check_in ? new Date(session.check_in) : undefined;
          session.check_out = session.check_out ? new Date(session.check_out) : undefined;
          session.break_start = session.break_start ? new Date(session.break_start) : undefined;
          session.break_end = session.break_end ? new Date(session.break_end) : undefined;
          this.sessions.set(session.id, session);
        });
      }

      if (settingsData) {
        this.settings = { ...this.settings, ...JSON.parse(settingsData) };
      }
    } catch (error) {
      console.error('Error loading attendance data:', error);
    }
  }

  private saveData(): void {
    try {
      localStorage.setItem('attendance_groups', JSON.stringify(Array.from(this.groups.values())));
      localStorage.setItem('attendance_members', JSON.stringify(Array.from(this.members.values())));
      localStorage.setItem('attendance_records', JSON.stringify(this.records));
      localStorage.setItem('attendance_sessions', JSON.stringify(Array.from(this.sessions.values())));
      localStorage.setItem('attendance_settings', JSON.stringify(this.settings));
    } catch (error) {
      console.error('Error saving attendance data:', error);
    }
  }

  // Group Management
  createGroup(name: string, type: GroupType, description?: string): AttendanceGroup {
    const group: AttendanceGroup = {
      id: this.generateId(),
      name,
      type,
      description,
      created_at: new Date(),
      is_active: true,
      settings: {
        auto_checkout_hours: this.settings.auto_checkout_hours,
        late_threshold_minutes: this.settings.late_threshold_minutes,
        break_duration_minutes: this.settings.break_duration_minutes,
        require_checkout: !this.settings.auto_checkout_enabled
      }
    };

    this.groups.set(group.id, group);
    this.saveData();
    return group;
  }

  getGroups(): AttendanceGroup[] {
    return Array.from(this.groups.values()).filter(group => group.is_active);
  }

  getGroup(groupId: string): AttendanceGroup | undefined {
    return this.groups.get(groupId);
  }

  updateGroup(groupId: string, updates: Partial<AttendanceGroup>): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    Object.assign(group, updates);
    this.groups.set(groupId, group);
    this.saveData();
    return true;
  }

  deleteGroup(groupId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    group.is_active = false;
    this.groups.set(groupId, group);
    this.saveData();
    return true;
  }

  // Member Management
  addMember(personId: string, groupId: string, name: string, options?: {
    role?: string;
    employee_id?: string;
    student_id?: string;
    email?: string;
  }): AttendanceMember {
    const member: AttendanceMember = {
      person_id: personId,
      group_id: groupId,
      name,
      role: options?.role,
      employee_id: options?.employee_id,
      student_id: options?.student_id,
      email: options?.email,
      joined_at: new Date(),
      is_active: true
    };

    this.members.set(personId, member);
    this.saveData();
    return member;
  }

  getMember(personId: string): AttendanceMember | undefined {
    return this.members.get(personId);
  }

  getGroupMembers(groupId: string): AttendanceMember[] {
    return Array.from(this.members.values()).filter(
      member => member.group_id === groupId && member.is_active
    );
  }

  updateMember(personId: string, updates: Partial<AttendanceMember>): boolean {
    const member = this.members.get(personId);
    if (!member) return false;

    Object.assign(member, updates);
    this.members.set(personId, member);
    this.saveData();
    return true;
  }

  removeMember(personId: string): boolean {
    const member = this.members.get(personId);
    if (!member) return false;

    member.is_active = false;
    this.members.set(personId, member);
    this.saveData();
    return true;
  }

  // Attendance Tracking
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async processAttendanceEvent(personId: string, confidence: number, _location?: string): Promise<AttendanceEvent | null> {
    const member = this.getMember(personId);
    if (!member || confidence < this.settings.confidence_threshold) {
      return null;
    }

    const event: AttendanceEvent = {
      id: this.generateId(),
      person_id: personId,
      group_id: member.group_id,
      type: this.determineAttendanceType(personId),
      timestamp: new Date(),
      confidence,
      processed: false
    };

    this.eventQueue.push(event);
    await this.processEvent(event);
    return event;
  }

  private determineAttendanceType(personId: string): AttendanceType {
    const today = new Date().toISOString().split('T')[0];
    const sessionKey = `${personId}_${today}`;
    const session = this.sessions.get(sessionKey);

    if (!session || !session.check_in) {
      return 'check_in';
    }

    if (session.status === 'on_break') {
      return 'break_end';
    }

    if (session.status === 'present' && this.settings.enable_break_tracking) {
      const now = new Date();
      const checkInTime = session.check_in;
      const hoursWorked = (now.getTime() - checkInTime.getTime()) / (1000 * 60 * 60);
      
      if (hoursWorked >= 4 && !session.break_start) {
        return 'break_start';
      }
    }

    return 'check_out';
  }

  private async processEvent(event: AttendanceEvent): Promise<void> {
    try {
      const record: AttendanceRecord = {
        id: event.id,
        person_id: event.person_id,
        group_id: event.group_id,
        timestamp: event.timestamp,
        type: event.type,
        confidence: event.confidence,
        location: event.location,
        is_manual: false
      };

      this.records.push(record);
      await this.updateSession(event);
      event.processed = true;
      this.saveData();
    } catch (error) {
      event.error = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error processing attendance event:', error);
    }
  }

  private async updateSession(event: AttendanceEvent): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const sessionKey = `${event.person_id}_${today}`;
    let session = this.sessions.get(sessionKey);

    if (!session) {
      session = {
        id: sessionKey,
        person_id: event.person_id,
        group_id: event.group_id,
        date: today,
        status: 'absent',
        is_late: false
      };
    }

    const group = this.getGroup(event.group_id);
    const lateThreshold = group?.settings.late_threshold_minutes || this.settings.late_threshold_minutes;

    switch (event.type) {
      case 'check_in': {
        session.check_in = event.timestamp;
        session.status = 'present';
        
        // Check if late
        const workStartTime = new Date(event.timestamp);
        workStartTime.setHours(9, 0, 0, 0); // Assuming 9 AM start time
        
        if (event.timestamp > workStartTime) {
          const lateMinutes = (event.timestamp.getTime() - workStartTime.getTime()) / (1000 * 60);
          if (lateMinutes > lateThreshold) {
            session.is_late = true;
            session.late_minutes = Math.round(lateMinutes);
            session.status = 'late';
          }
        }
        break;
      }

      case 'check_out':
        session.check_out = event.timestamp;
        session.status = 'checked_out';
        if (session.check_in) {
          session.total_hours = this.calculateTotalHours(session);
        }
        break;

      case 'break_start':
        session.break_start = event.timestamp;
        session.status = 'on_break';
        break;

      case 'break_end':
        session.break_end = event.timestamp;
        session.status = 'present';
        if (session.break_start) {
          session.break_duration = (event.timestamp.getTime() - session.break_start.getTime()) / (1000 * 60);
        }
        break;
    }

    this.sessions.set(sessionKey, session);
  }

  private calculateTotalHours(session: AttendanceSession): number {
    if (!session.check_in || !session.check_out) return 0;

    let totalMs = session.check_out.getTime() - session.check_in.getTime();
    
    // Subtract break time if applicable
    if (session.break_duration) {
      totalMs -= session.break_duration * 60 * 1000;
    }

    return Math.round((totalMs / (1000 * 60 * 60)) * 100) / 100; // Round to 2 decimal places
  }

  // Manual Attendance
  addManualRecord(personId: string, type: AttendanceType, timestamp?: Date, notes?: string): AttendanceRecord {
    const member = this.getMember(personId);
    if (!member) {
      throw new Error('Member not found');
    }

    const record: AttendanceRecord = {
      id: this.generateId(),
      person_id: personId,
      group_id: member.group_id,
      timestamp: timestamp || new Date(),
      type,
      confidence: 1.0,
      notes,
      is_manual: true
    };

    this.records.push(record);
    
    // Process the manual record as an event
    const event: AttendanceEvent = {
      id: record.id,
      person_id: personId,
      group_id: member.group_id,
      type,
      timestamp: record.timestamp,
      confidence: 1.0,
      processed: false
    };

    this.updateSession(event);
    this.saveData();
    return record;
  }

  // Statistics and Reports
  getGroupStats(groupId: string, date?: Date): AttendanceStats {
    const targetDate = date || new Date();
    const dateStr = targetDate.toISOString().split('T')[0];
    const members = this.getGroupMembers(groupId);
    
    const stats: AttendanceStats = {
      total_members: members.length,
      present_today: 0,
      absent_today: 0,
      late_today: 0,
      on_break: 0,
      average_hours_today: 0,
      total_hours_today: 0
    };

    let totalHours = 0;
    let membersWithHours = 0;

    members.forEach(member => {
      const sessionKey = `${member.person_id}_${dateStr}`;
      const session = this.sessions.get(sessionKey);

      if (session) {
        switch (session.status) {
          case 'present':
          case 'late':
            stats.present_today++;
            if (session.is_late) stats.late_today++;
            break;
          case 'on_break':
            stats.on_break++;
            break;
          case 'checked_out':
            stats.present_today++;
            if (session.is_late) stats.late_today++;
            break;
          default:
            stats.absent_today++;
        }

        if (session.total_hours) {
          totalHours += session.total_hours;
          membersWithHours++;
        }
      } else {
        stats.absent_today++;
      }
    });

    stats.total_hours_today = Math.round(totalHours * 100) / 100;
    stats.average_hours_today = membersWithHours > 0 ? 
      Math.round((totalHours / membersWithHours) * 100) / 100 : 0;

    return stats;
  }

  generateReport(groupId: string, startDate: Date, endDate: Date): AttendanceReport {
    const group = this.getGroup(groupId);
    if (!group) {
      throw new Error('Group not found');
    }

    const members = this.getGroupMembers(groupId);
    const workingDays = this.getWorkingDaysBetween(startDate, endDate);
    
    const memberReports = members.map(member => {
      const memberSessions = this.getMemberSessionsInRange(member.person_id, startDate, endDate);
      
      const presentDays = memberSessions.filter(s => s.status !== 'absent').length;
      const absentDays = workingDays - presentDays;
      const lateDays = memberSessions.filter(s => s.is_late).length;
      const totalHours = memberSessions.reduce((sum, s) => sum + (s.total_hours || 0), 0);
      const averageHours = presentDays > 0 ? totalHours / presentDays : 0;
      const attendanceRate = workingDays > 0 ? (presentDays / workingDays) * 100 : 0;

      return {
        person_id: member.person_id,
        name: member.name,
        total_days: workingDays,
        present_days: presentDays,
        absent_days: absentDays,
        late_days: lateDays,
        total_hours: Math.round(totalHours * 100) / 100,
        average_hours: Math.round(averageHours * 100) / 100,
        attendance_rate: Math.round(attendanceRate * 100) / 100
      };
    });

    const totalHoursLogged = memberReports.reduce((sum, m) => sum + m.total_hours, 0);
    const averageAttendanceRate = memberReports.length > 0 ?
      memberReports.reduce((sum, m) => sum + m.attendance_rate, 0) / memberReports.length : 0;

    const mostPunctual = memberReports.reduce((best, current) => 
      current.late_days < best.late_days ? current : best, memberReports[0])?.name || 'N/A';
    
    const mostAbsent = memberReports.reduce((worst, current) => 
      current.absent_days > worst.absent_days ? current : worst, memberReports[0])?.name || 'N/A';

    return {
      group_id: groupId,
      date_range: { start: startDate, end: endDate },
      members: memberReports,
      summary: {
        total_working_days: workingDays,
        average_attendance_rate: Math.round(averageAttendanceRate * 100) / 100,
        total_hours_logged: Math.round(totalHoursLogged * 100) / 100,
        most_punctual: mostPunctual,
        most_absent: mostAbsent
      }
    };
  }

  private getMemberSessionsInRange(personId: string, startDate: Date, endDate: Date): AttendanceSession[] {
    const sessions: AttendanceSession[] = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const sessionKey = `${personId}_${dateStr}`;
      const session = this.sessions.get(sessionKey);
      
      if (session) {
        sessions.push(session);
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return sessions;
  }

  private getWorkingDaysBetween(startDate: Date, endDate: Date): number {
    let count = 0;
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const dayOfWeek = currentDate.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Exclude weekends
        count++;
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return count;
  }

  // Settings
  getSettings(): AttendanceSettings {
    return { ...this.settings };
  }

  updateSettings(newSettings: Partial<AttendanceSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    this.saveData();
  }

  // Utility
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Export/Import
  exportData(): string {
    return JSON.stringify({
      groups: Array.from(this.groups.values()),
      members: Array.from(this.members.values()),
      records: this.records,
      sessions: Array.from(this.sessions.values()),
      settings: this.settings,
      exported_at: new Date().toISOString()
    }, null, 2);
  }

  importData(jsonData: string): boolean {
    try {
      const data = JSON.parse(jsonData);
      
      if (data.groups) {
        this.groups.clear();
        data.groups.forEach((group: AttendanceGroup) => {
          group.created_at = new Date(group.created_at);
          this.groups.set(group.id, group);
        });
      }

      if (data.members) {
        this.members.clear();
        data.members.forEach((member: AttendanceMember) => {
          member.joined_at = new Date(member.joined_at);
          this.members.set(member.person_id, member);
        });
      }

      if (data.records) {
        this.records = data.records.map((record: AttendanceRecord) => ({
          ...record,
          timestamp: new Date(record.timestamp)
        }));
      }

      if (data.sessions) {
        this.sessions.clear();
        data.sessions.forEach((session: AttendanceSession) => {
          session.check_in = session.check_in ? new Date(session.check_in) : undefined;
          session.check_out = session.check_out ? new Date(session.check_out) : undefined;
          session.break_start = session.break_start ? new Date(session.break_start) : undefined;
          session.break_end = session.break_end ? new Date(session.break_end) : undefined;
          this.sessions.set(session.id, session);
        });
      }

      if (data.settings) {
        this.settings = { ...this.settings, ...data.settings };
      }

      this.saveData();
      return true;
    } catch (error) {
      console.error('Error importing attendance data:', error);
      return false;
    }
  }

  // Cleanup old data
  cleanupOldData(daysToKeep: number = 90): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    // Remove old records
    this.records = this.records.filter(record => record.timestamp >= cutoffDate);

    // Remove old sessions
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
    Array.from(this.sessions.keys()).forEach(key => {
      const dateStr = key.split('_')[1];
      if (dateStr < cutoffDateStr) {
        this.sessions.delete(key);
      }
    });

    this.saveData();
  }
}

// Singleton instance
export const attendanceManager = new AttendanceManager();