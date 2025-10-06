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
  processing_time: number;
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
  track_id?: number; // SORT tracker ID for consistent face tracking across frames
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
    real_score?: number;
    fake_score?: number;
    status: 'real' | 'fake' | 'error';
  };
  recognition?: RecognitionResult;
}

export interface DetectionWithRecognitionResult {
  faces: FaceWithRecognition[];
  model_used: string;
  processing_time: number;
}

/**
 * Attendance System Types and Interfaces
 */

export type GroupType = 'employee' | 'student' | 'visitor' | 'general';
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'checked_out';

export interface AttendanceGroup {
  id: string;
  name: string;
  type: GroupType;
  description?: string;
  created_at: Date;
  is_active: boolean;
  settings: {
    auto_checkout_hours?: number;
    late_threshold_minutes?: number;
    require_checkout: boolean;
    class_start_time?: string; // HH:MM format (e.g., "08:00")
  };
}

export interface AttendanceMember {
  person_id: string;
  group_id: string;
  name: string;
  role?: string;
  employee_id?: string;
  student_id?: string;
  email?: string;
  joined_at: Date;
  is_active: boolean;
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
  default_group_type: GroupType;
  auto_checkout_enabled: boolean;
  auto_checkout_hours: number;
  late_threshold_minutes: number;
  require_manual_checkout: boolean;
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