import type {
  AttendanceGroup,
  AttendanceMember,
  AttendanceSettings,
} from "../../types/recognition";
import type { HttpClient } from "./HttpClient";

export class GroupManager {
  private httpClient: HttpClient;
  private apiEndpoints: Record<string, string>;

  constructor(httpClient: HttpClient, apiEndpoints: Record<string, string>) {
    this.httpClient = httpClient;
    this.apiEndpoints = apiEndpoints;
  }

  async createGroup(
    name: string,
    description?: string,
    settings?: AttendanceSettings | null,
  ): Promise<AttendanceGroup> {
    try {
      const groupData = {
        name,
        description,
        settings: {
          late_threshold_minutes: settings?.late_threshold_minutes ?? 15,
          late_threshold_enabled: false,
        },
      };

      const group = await this.httpClient.post<AttendanceGroup>(
        this.apiEndpoints.groups,
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
        this.apiEndpoints.groups,
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
        `${this.apiEndpoints.groups}/${groupId}`,
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
        `${this.apiEndpoints.groups}/${groupId}`,
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
      await this.httpClient.delete(`${this.apiEndpoints.groups}/${groupId}`);
      return true;
    } catch (error) {
      console.error("Error deleting group:", error);
      return false;
    }
  }

  async getGroupMembers(groupId: string): Promise<AttendanceMember[]> {
    try {
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
      >(`${this.apiEndpoints.groups}/${groupId}/persons`);

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
}
