/**
 * Face Recognition Types and Interfaces
 */

export interface FaceRecognitionRequest {
  image: string; // base64 encoded image
  bbox?: number[]; // Optional bounding box [x, y, width, height]
  group_id?: string;
}

export interface FaceRecognitionResponse {
  success: boolean;
  person_id?: string;
  name?: string;
  similarity?: number;
  error?: string;
}

export interface FaceRegistrationRequest {
  image: string; // base64 encoded image
  person_id: string;
  bbox?: number[]; // Optional bounding box [x, y, width, height]
  group_id?: string;
}

export interface FaceRegistrationResponse {
  success: boolean;
  person_id: string;
  total_persons?: number;
  error?: string;
}

export interface PersonRemovalRequest {
  person_id: string;
}

export interface PersonRemovalResponse {
  success: boolean;
  person_id?: string;
  message: string;
  total_persons?: number;
  error?: string;
}

export interface SimilarityThresholdRequest {
  threshold: number;
}

export interface SimilarityThresholdResponse {
  success: boolean;
  message: string;
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
  persons: PersonInfo[];
}

export interface PersonUpdateResponse {
  success: boolean;
  message: string;
  updated_records: number;
}

export interface PersonListResponse {
  success: boolean;
  persons: Array<{
    person_id: string;
    embedding_count: number;
  }>;
  total_count: number;
}

export interface DatabaseClearResponse {
  success: boolean;
  message: string;
  total_persons: number;
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
  track_id?: number; // SORT tracker ID for consistent face tracking across frames
  liveness?: {
    is_real: boolean | null;
    live_score?: number;
    spoof_score?: number;
    confidence: number;
    status: 'real' | 'fake' | 'error';
    label?: string;
  };
  recognition?: RecognitionResult;
}

export interface DetectionWithRecognitionResult {
  faces: FaceWithRecognition[];
  model_used: string;
}

/**
 * Attendance System Types and Interfaces
 */

export type AttendanceStatus = 'present' | 'absent';

export interface AttendanceGroup {
  id: string;
  name: string;
  description?: string;
  created_at: Date;
  is_active: boolean;
  settings: {
    late_threshold_minutes?: number;
    late_threshold_enabled?: boolean;
    class_start_time?: string; // HH:MM format (e.g., "08:00")
  };
}

export interface AttendanceMember {
  person_id: string;
  group_id: string;
  name: string;
  role?: string;
  email?: string;
  joined_at: Date;
  is_active: boolean;
  has_face_data?: boolean; // Face registration status
}

export interface AttendanceRecord {
  id: string;
  person_id: string;
  group_id: string;
  timestamp: Date;
  confidence: number;
  location?: string;
  notes?: string;
  is_manual: boolean;
  created_by?: string;
}

export interface AttendanceSession {
  id: string;
  person_id: string;
  group_id: string;
  date: string; // YYYY-MM-DD format
  check_in_time?: Date;
  total_hours?: number;
  status: AttendanceStatus;
  is_late: boolean;
  late_minutes?: number;
  notes?: string;
}

export interface AttendanceStats {
  total_members: number;
  present_today: number;
  absent_today: number;
  late_today: number;
  average_hours_today: number;
  total_hours_today: number;
}

export interface AttendanceReport {
  group_id: string;
  date_range: {
    start: Date;
    end: Date;
  };
  members: {
    person_id: string;
    name: string;
    total_days: number;
    present_days: number;
    absent_days: number;
    late_days: number;
    total_hours: number;
    average_hours: number;
    attendance_rate: number;
  }[];
  summary: {
    total_working_days: number;
    average_attendance_rate: number;
    total_hours_logged: number;
    most_punctual: string;
    most_absent: string;
  };
}

export interface AttendanceSettings {
  late_threshold_minutes: number;
  enable_location_tracking: boolean;
  attendance_cooldown_seconds: number; // Cooldown period to prevent duplicate attendance logging
}

export interface AttendanceEvent {
  id: string;
  person_id: string;
  group_id: string;
  timestamp: Date;
  confidence: number;
  location?: string;
  processed: boolean;
  error?: string;
}