// Shared types for Main component

import type { AttendanceGroup, AttendanceMember, AttendanceRecord, GroupType } from '../../types/recognition';
import type { MenuSection } from '../Menu';

export interface DetectionResult {
  faces: Array<{
    bbox: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    confidence: number;
    track_id?: number;
    landmarks: {
      right_eye: { x: number; y: number };
      left_eye: { x: number; y: number };
      nose_tip: { x: number; y: number };
      right_mouth_corner: { x: number; y: number };
      left_mouth_corner: { x: number; y: number };
    };
    landmarks_468?: Array<{ x: number; y: number }>;
    antispoofing?: {
      is_real: boolean | null;
      confidence: number;
      live_score?: number;
      spoof_score?: number;
      status: 'real' | 'fake' | 'error';
      label?: string;
      message?: string;
    };
  }>;
  model_used: string;
  processing_time: number;
}

export interface WebSocketFaceData {
  bbox?: number[];
  confidence?: number;
  track_id?: number;
  landmarks?: number[][];
  landmarks_468?: number[][];
  antispoofing?: {
    is_real?: boolean | null;
    confidence?: number;
    live_score?: number;
    spoof_score?: number;
    status?: 'real' | 'fake' | 'error';
    label?: string;
    message?: string;
  };
}

export interface WebSocketDetectionResponse {
  faces?: WebSocketFaceData[];
  model_used?: string;
  processing_time?: number;
  timestamp?: number;
  frame_timestamp?: number;
  frame_dropped?: boolean;
  performance_metrics?: {
    actual_fps?: number;
    avg_processing_time?: number;
    overload_counter?: number;
    samples_count?: number;
    queue_size?: number;
    dropped_frames?: number;
    max_performance_mode?: boolean;
  };
}

export interface WebSocketConnectionMessage {
  message?: string;
  status?: string;
}

export interface WebSocketErrorMessage {
  message?: string;
  error?: string;
}

export type DashboardTab = MenuSection;

export interface TrackedFace {
  personId: string;
  name: string;
  confidence: number;
  lastSeen: number;
  occlusionStartTime: number | null;
  bbox: { x: number; y: number; width: number; height: number };
  history: Array<{ timestamp: number; bbox: { x: number; y: number; width: number; height: number }; confidence: number }>;
  isLocked: boolean;
}

export interface CooldownInfo {
  personId: string;
  memberName: string;
  startTime: number;
}

// Re-export needed types
export type { AttendanceGroup, AttendanceMember, AttendanceRecord, GroupType, MenuSection };

