import type { AttendanceMember } from "../../types/recognition";
import type { HttpClient } from "./HttpClient";

export class MemberManager {
  private httpClient: HttpClient;
  private apiEndpoints: Record<string, string>;

  constructor(httpClient: HttpClient, apiEndpoints: Record<string, string>) {
    this.httpClient = httpClient;
    this.apiEndpoints = apiEndpoints;
  }

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

      if (options?.personId) {
        memberData.person_id = options.personId;
      }

      const member = await this.httpClient.post<AttendanceMember>(
        this.apiEndpoints.members,
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
        `${this.apiEndpoints.members}/${personId}`,
      );
      return {
        ...member,
        joined_at: new Date(member.joined_at),
      };
    } catch {
      return undefined;
    }
  }

  async updateMember(
    personId: string,
    updates: Partial<AttendanceMember>,
  ): Promise<boolean> {
    try {
      await this.httpClient.put<AttendanceMember>(
        `${this.apiEndpoints.members}/${personId}`,
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
      await this.httpClient.delete(`${this.apiEndpoints.members}/${personId}`);
      return true;
    } catch (error) {
      console.error("Error removing member:", error);
      return false;
    }
  }

  async registerFaceForGroupPerson(
    groupId: string,
    personId: string,
    imageData: string,
    bbox: number[],
    landmarks_5: number[][],
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const result = await this.httpClient.post<{
        success: boolean;
        message: string;
      }>(
        `${this.apiEndpoints.groups}/${groupId}/persons/${personId}/register-face`,
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
      }>(
        `${this.apiEndpoints.groups}/${groupId}/persons/${personId}/face-data`,
      );
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
}
