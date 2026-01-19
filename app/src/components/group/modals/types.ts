export interface DetectedFace {
  faceId: string;
  imageId: string;
  bbox: [number, number, number, number];
  confidence: number;
  landmarks_5?: number[][];
  qualityScore: number;
  isAcceptable: boolean;
  suggestions: string[];
  assignedPersonId: string | null;
  previewUrl: string;
}

export interface BulkRegistrationResult {
  personId: string;
  memberName: string;
  success: boolean;
  error?: string;
  qualityWarning?: string;
}

export interface BulkRegisterResponseItem {
  person_id: string;
  member_name?: string;
  success: boolean;
  error?: string;
  quality_warning?: string;
}
