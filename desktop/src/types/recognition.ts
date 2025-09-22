/**
 * Face Recognition Types and Interfaces
 */

export interface FaceRecognitionRequest {
  image: string; // base64 encoded image
  landmarks?: number[][];
}

export interface FaceRecognitionResponse {
  success: boolean;
  person_id?: string;
  similarity?: number;
  processing_time: number;
  error?: string;
}

export interface FaceRegistrationRequest {
  image: string; // base64 encoded image
  person_id: string;
  landmarks?: number[][];
}

export interface FaceRegistrationResponse {
  success: boolean;
  person_id: string;
  processing_time: number;
  error?: string;
}

export interface PersonRemovalRequest {
  person_id: string;
}

export interface PersonRemovalResponse {
  success: boolean;
  person_id: string;
  error?: string;
}

export interface SimilarityThresholdRequest {
  threshold: number;
}

export interface SimilarityThresholdResponse {
  success: boolean;
  threshold: number;
  error?: string;
}

export interface PersonInfo {
  person_id: string;
  embedding_count: number;
  last_seen?: string;
}

export interface DatabaseStatsResponse {
  total_persons: number;
  total_embeddings: number;
  persons: PersonInfo[];
}

export interface RecognitionResult {
  person_id?: string;
  similarity?: number;
  is_recognized: boolean;
}

export interface FaceWithRecognition {
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
  landmarks: {
    right_eye: { x: number; y: number };
    left_eye: { x: number; y: number };
    nose_tip: { x: number; y: number };
    right_mouth_corner: { x: number; y: number };
    left_mouth_corner: { x: number; y: number };
  };
  antispoofing?: {
    is_real: boolean | null;
    confidence: number;
    status: 'real' | 'fake' | 'error';
  };
  recognition?: RecognitionResult;
}

export interface DetectionWithRecognitionResult {
  faces: FaceWithRecognition[];
  model_used: string;
  processing_time: number;
}