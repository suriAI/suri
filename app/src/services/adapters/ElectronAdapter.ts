import type {
  FaceRecognitionResponse,
  FaceRegistrationResponse,
  PersonRemovalResponse,
  PersonUpdateResponse,
  SimilarityThresholdResponse,
  DatabaseStatsResponse,
  PersonInfo,
} from "../../types/recognition";

export class ElectronAdapter {
  async recognizeFace(
    base64Image: string,
    bbox: number[],
    groupId?: string,
    landmarks_5?: number[][],
    enableLivenessDetection?: boolean,
  ): Promise<FaceRecognitionResponse> {
    return window.electronAPI.backend.recognizeFace(
      base64Image,
      bbox,
      groupId,
      landmarks_5,
      enableLivenessDetection,
    );
  }

  async registerFace(
    imageData: string,
    personId: string,
    bbox: number[],
    groupId?: string,
    enableLivenessDetection?: boolean,
  ): Promise<FaceRegistrationResponse> {
    return window.electronAPI.backend.registerFace(
      imageData,
      personId,
      bbox,
      groupId,
      enableLivenessDetection,
    );
  }

  async removePerson(personId: string): Promise<PersonRemovalResponse> {
    return window.electronAPI.backend.removePerson(personId);
  }

  async updatePerson(
    oldPersonId: string,
    newPersonId: string,
  ): Promise<PersonUpdateResponse> {
    return window.electronAPI.backend.updatePerson(oldPersonId, newPersonId);
  }

  async getAllPersons(): Promise<{ persons: PersonInfo[] }> {
    return window.electronAPI.backend.getAllPersons();
  }

  async setThreshold(threshold: number): Promise<SimilarityThresholdResponse> {
    return window.electronAPI.backend.setThreshold(threshold);
  }

  async clearDatabase(): Promise<{ success: boolean; message: string }> {
    return window.electronAPI.backend.clearDatabase();
  }

  async getFaceStats(): Promise<DatabaseStatsResponse> {
    return window.electronAPI.backend.getFaceStats();
  }
}
