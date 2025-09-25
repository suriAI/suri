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

// API Configuration
const API_BASE_URL = 'http://127.0.0.1:8700';
const API_ENDPOINTS = {
  groups: '/attendance/groups',
  members: '/attendance/members',
  records: '/attendance/records',
  sessions: '/attendance/sessions',
  events: '/attendance/events',
  settings: '/attendance/settings',
  stats: '/attendance/stats'
};

// HTTP Client utility
class HttpClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const defaultOptions: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    const response = await fetch(url, { ...defaultOptions, ...options });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || errorData.error || `HTTP ${response.status}: ${response.statusText}`);
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
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async put<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'DELETE',
    });
  }
}

export class AttendanceManager {
  private httpClient: HttpClient;
  private settings: AttendanceSettings;
  private eventQueue: AttendanceEvent[] = [];

  constructor() {
    this.httpClient = new HttpClient(API_BASE_URL);
    this.settings = this.getDefaultSettings();
    this.loadSettings();
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
      enable_location_tracking: false
    };
  }

  private async loadSettings(): Promise<void> {
    try {
      this.settings = await this.httpClient.get<AttendanceSettings>(API_ENDPOINTS.settings);
    } catch (error) {
      console.error('Error loading settings from backend:', error);
      // Keep default settings if backend is not available
    }
  }

  // Group Management
  async createGroup(name: string, type: GroupType, description?: string): Promise<AttendanceGroup> {
    try {
      const groupData = {
        name,
        type,
        description,
        settings: {
          auto_checkout_hours: this.settings.auto_checkout_hours,
          late_threshold_minutes: this.settings.late_threshold_minutes,
          break_duration_minutes: this.settings.break_duration_minutes,
          require_checkout: !this.settings.auto_checkout_enabled
        }
      };

      const group = await this.httpClient.post<AttendanceGroup>(API_ENDPOINTS.groups, groupData);
      return {
        ...group,
        created_at: new Date(group.created_at)
      };
    } catch (error) {
      console.error('Error creating group:', error);
      throw error;
    }
  }

  async getGroups(): Promise<AttendanceGroup[]> {
    try {
      const groups = await this.httpClient.get<AttendanceGroup[]>(API_ENDPOINTS.groups, { active_only: 'true' });
      return groups.map(group => ({
        ...group,
        created_at: new Date(group.created_at)
      }));
    } catch (error) {
      console.error('Error getting groups:', error);
      return [];
    }
  }

  async getGroup(groupId: string): Promise<AttendanceGroup | undefined> {
    try {
      const group = await this.httpClient.get<AttendanceGroup>(`${API_ENDPOINTS.groups}/${groupId}`);
      return {
        ...group,
        created_at: new Date(group.created_at)
      };
    } catch (error) {
      console.error('Error getting group:', error);
      return undefined;
    }
  }

  async updateGroup(groupId: string, updates: Partial<AttendanceGroup>): Promise<boolean> {
    try {
      await this.httpClient.put<AttendanceGroup>(`${API_ENDPOINTS.groups}/${groupId}`, updates);
      return true;
    } catch (error) {
      console.error('Error updating group:', error);
      return false;
    }
  }

  async deleteGroup(groupId: string): Promise<boolean> {
    try {
      await this.httpClient.delete(`${API_ENDPOINTS.groups}/${groupId}`);
      return true;
    } catch (error) {
      console.error('Error deleting group:', error);
      return false;
    }
  }

  // Member Management
  async addMember(groupId: string, name: string, options?: {
    personId?: string;
    role?: string;
    employee_id?: string;
    student_id?: string;
    email?: string;
  }): Promise<AttendanceMember> {
    try {
      const memberData: any = {
        group_id: groupId,
        name,
        role: options?.role,
        employee_id: options?.employee_id,
        student_id: options?.student_id,
        email: options?.email
      };

      // Only include person_id if explicitly provided
      if (options?.personId) {
        memberData.person_id = options.personId;
      }

      const member = await this.httpClient.post<AttendanceMember>(API_ENDPOINTS.members, memberData);
      return {
        ...member,
        joined_at: new Date(member.joined_at)
      };
    } catch (error) {
      console.error('Error adding member:', error);
      throw error;
    }
  }

  async getMember(personId: string): Promise<AttendanceMember | undefined> {
    try {
      const member = await this.httpClient.get<AttendanceMember>(`${API_ENDPOINTS.members}/${personId}`);
      return {
        ...member,
        joined_at: new Date(member.joined_at)
      };
    } catch (error) {
      console.error('Error getting member:', error);
      return undefined;
    }
  }

  async getGroupMembers(groupId: string): Promise<AttendanceMember[]> {
    try {
      const members = await this.httpClient.get<AttendanceMember[]>(`${API_ENDPOINTS.groups}/${groupId}/members`);
      return members.map(member => ({
        ...member,
        joined_at: new Date(member.joined_at)
      }));
    } catch (error) {
      console.error('Error getting group members:', error);
      return [];
    }
  }

  async updateMember(personId: string, updates: Partial<AttendanceMember>): Promise<boolean> {
    try {
      await this.httpClient.put<AttendanceMember>(`${API_ENDPOINTS.members}/${personId}`, updates);
      return true;
    } catch (error) {
      console.error('Error updating member:', error);
      return false;
    }
  }

  async removeMember(personId: string): Promise<boolean> {
    try {
      await this.httpClient.delete(`${API_ENDPOINTS.members}/${personId}`);
      return true;
    } catch (error) {
      console.error('Error removing member:', error);
      return false;
    }
  }

  // Attendance Tracking
  async processAttendanceEvent(
    personId: string, 
    confidence: number, 
    location?: string,
    antispoofingStatus?: string,
    antispoofingConfidence?: number
  ): Promise<AttendanceEvent | null> {
    try {
      const eventData = {
        person_id: personId,
        confidence,
        location,
        antispoofing_status: antispoofingStatus,
        antispoofing_confidence: antispoofingConfidence
      };

      const event = await this.httpClient.post<AttendanceEvent>(API_ENDPOINTS.events, eventData);
      
      // Convert timestamp to Date object
      const processedEvent: AttendanceEvent = {
        ...event,
        timestamp: new Date(event.timestamp)
      };

      this.eventQueue.push(processedEvent);
      return processedEvent;
    } catch (error: any) {
      console.error('Error processing attendance event:', error);
      
      // Re-throw the error with more context for the UI to handle
      const errorMessage = error.message || error.toString();
      
      if (errorMessage.includes('below threshold')) {
        throw new Error(`Recognition confidence (${(confidence * 100).toFixed(1)}%) is below the required threshold. Please ensure good lighting and face the camera directly.`);
      } else if (errorMessage.includes('Member not found') || errorMessage.includes('Person not found')) {
        throw new Error(`Person not found in the system. Please register this person first.`);
      } else if (errorMessage.includes('Group not found')) {
        throw new Error(`Selected group not found. Please select a valid group.`);
      } else {
        throw new Error(errorMessage || 'Failed to process attendance event. Please try again.');
      }
    }
  }

  // Manual Attendance
  async addManualRecord(personId: string, type: AttendanceType, timestamp?: Date, notes?: string): Promise<AttendanceRecord> {
    try {
      const recordData = {
        person_id: personId,
        type,
        timestamp: timestamp?.toISOString(),
        confidence: 1.0,
        notes,
        is_manual: true
      };

      const record = await this.httpClient.post<AttendanceRecord>(API_ENDPOINTS.records, recordData);
      return {
        ...record,
        timestamp: new Date(record.timestamp)
      };
    } catch (error) {
      console.error('Error adding manual record:', error);
      throw error;
    }
  }

  // Statistics and Reports
  async getGroupStats(groupId: string, date?: Date): Promise<AttendanceStats> {
    try {
      const params: Record<string, string> = {};
      if (date) {
        params.date = date.toISOString().split('T')[0];
      }

      return await this.httpClient.get<AttendanceStats>(`${API_ENDPOINTS.groups}/${groupId}/stats`, params);
    } catch (error) {
      console.error('Error getting group stats:', error);
      return {
        total_members: 0,
        present_today: 0,
        absent_today: 0,
        late_today: 0,
        on_break: 0,
        average_hours_today: 0,
        total_hours_today: 0
      };
    }
  }

  async generateReport(groupId: string, startDate: Date, endDate: Date): Promise<AttendanceReport> {
    try {
      // For now, we'll implement a basic report generation
      // This would typically be a dedicated backend endpoint
      const [group, members, records, sessions] = await Promise.all([
        this.getGroup(groupId),
        this.getGroupMembers(groupId),
        this.getRecords({ 
          group_id: groupId, 
          start_date: startDate.toISOString(), 
          end_date: endDate.toISOString() 
        }),
        this.getSessions({ 
          group_id: groupId, 
          start_date: startDate.toISOString().split('T')[0], 
          end_date: endDate.toISOString().split('T')[0] 
        })
      ]);

      if (!group) {
        throw new Error('Group not found');
      }

      const workingDays = this.getWorkingDaysBetween(startDate, endDate);
      
      const memberReports = members.map(member => {
        const memberSessions = sessions.filter(s => s.person_id === member.person_id);
        
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
    } catch (error) {
      console.error('Error generating report:', error);
      throw error;
    }
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

      const records = await this.httpClient.get<AttendanceRecord[]>(API_ENDPOINTS.records, params);
      return records.map(record => ({
        ...record,
        timestamp: new Date(record.timestamp)
      }));
    } catch (error) {
      console.error('Error getting records:', error);
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

      const sessions = await this.httpClient.get<AttendanceSession[]>(API_ENDPOINTS.sessions, params);
      return sessions.map(session => ({
        ...session,
        check_in: session.check_in ? new Date(session.check_in) : undefined,
        check_out: session.check_out ? new Date(session.check_out) : undefined,
        break_start: session.break_start ? new Date(session.break_start) : undefined,
        break_end: session.break_end ? new Date(session.break_end) : undefined
      }));
    } catch (error) {
      console.error('Error getting sessions:', error);
      return [];
    }
  }

  // Settings
  getSettings(): AttendanceSettings {
    return { ...this.settings };
  }

  async updateSettings(newSettings: Partial<AttendanceSettings>): Promise<void> {
    try {
      const updatedSettings = await this.httpClient.put<AttendanceSettings>(API_ENDPOINTS.settings, newSettings);
      this.settings = updatedSettings;
    } catch (error) {
      console.error('Error updating settings:', error);
      throw error;
    }
  }

  // Utility
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Export/Import
  async exportData(): Promise<string> {
    try {
      const [groups, members, records, sessions, settings] = await Promise.all([
        this.getGroups(),
        this.httpClient.get<AttendanceMember[]>(API_ENDPOINTS.members),
        this.getRecords(),
        this.getSessions(),
        Promise.resolve(this.settings)
      ]);

      return JSON.stringify({
        groups,
        members: members.map(m => ({ ...m, joined_at: new Date(m.joined_at) })),
        records,
        sessions,
        settings,
        exported_at: new Date().toISOString()
      }, null, 2);
    } catch (error) {
      console.error('Error exporting data:', error);
      throw error;
    }
  }

  async importData(jsonData: string): Promise<boolean> {
    try {
      // This would require a dedicated import endpoint on the backend
      // For now, we'll throw an error indicating this needs backend support
      throw new Error('Import functionality requires backend implementation');
    } catch (error) {
      console.error('Error importing data:', error);
      return false;
    }
  }

  // Cleanup old data
  async cleanupOldData(daysToKeep: number = 90): Promise<void> {
    try {
      await this.httpClient.post('/attendance/cleanup', { days_to_keep: daysToKeep });
    } catch (error) {
      console.error('Error cleaning up old data:', error);
      throw error;
    }
  }

  // Health check
  async isBackendAvailable(): Promise<boolean> {
    try {
      await this.httpClient.get('/');
      return true;
    } catch (error) {
      return false;
    }
  }

  // Get backend statistics
  async getBackendStats(): Promise<any> {
    try {
      return await this.httpClient.get(API_ENDPOINTS.stats);
    } catch (error) {
      console.error('Error getting backend stats:', error);
      return {};
    }
  }

  // Group-Specific Person Management
  async getGroupPersons(groupId: string): Promise<Array<{
    person_id: string;
    name: string;
    role?: string;
    employee_id?: string;
    student_id?: string;
    email?: string;
    has_face_data: boolean;
    joined_at: Date;
  }>> {
    try {
      const persons = await this.httpClient.get<any[]>(`${API_ENDPOINTS.groups}/${groupId}/persons`);
      return persons.map(person => ({
        ...person,
        joined_at: new Date(person.joined_at)
      }));
    } catch (error) {
      console.error('Error getting group persons:', error);
      return [];
    }
  }

  async registerFaceForGroupPerson(
     groupId: string, 
     personId: string, 
     imageData: string, 
     landmarks: number[][]
   ): Promise<{ success: boolean; message?: string; error?: string }> {
     try {
       const result = await this.httpClient.post<{ success: boolean; message: string; person_id: string; group_id: string; total_persons: number }>(
         `${API_ENDPOINTS.groups}/${groupId}/persons/${personId}/register-face`,
         {
           image: imageData,
           landmarks: landmarks
         }
       );
       return { success: true, message: result.message };
     } catch (error) {
       console.error('Error registering face for group person:', error);
       return { 
         success: false, 
         error: error instanceof Error ? error.message : 'Failed to register face' 
       };
     }
   }

   async removeFaceDataForGroupPerson(
     groupId: string, 
     personId: string
   ): Promise<{ success: boolean; message?: string; error?: string }> {
     try {
       const result = await this.httpClient.delete<{ success: boolean; message: string; person_id: string; group_id: string }>(
         `${API_ENDPOINTS.groups}/${groupId}/persons/${personId}/face-data`
       );
       return { success: true, message: result.message };
     } catch (error) {
       console.error('Error removing face data for group person:', error);
       return { 
         success: false, 
         error: error instanceof Error ? error.message : 'Failed to remove face data' 
       };
     }
   }
}

// Singleton instance
export const attendanceManager = new AttendanceManager();