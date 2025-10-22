// Shared types for Main component

import type { AttendanceGroup, AttendanceMember, AttendanceRecord, GroupType } from '../../types/recognition';
import type { MenuSection } from '../menu';

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
    landmarks_5?: number[][]; // YuNet 5-point landmarks [[x,y], [x,y], ...]
    liveness?: {
      is_real: boolean | null;
      confidence: number;
      live_score?: number;
      spoof_score?: number;
      status: 'real' | 'fake' | 'uncertain' | 'error' | 'insufficient_quality';
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
  landmarks_5?: number[][]; // YuNet 5-point landmarks [[x,y], [x,y], ...]
  liveness?: {
    is_real?: boolean | null;
    confidence?: number;
    live_score?: number;
    spoof_score?: number;
    status?: 'real' | 'fake' | 'uncertain' | 'error' | 'insufficient_quality';
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
  id: string;
  bbox: { x: number; y: number; width: number; height: number };
  confidence: number;
  lastSeen: number;
  trackingHistory: Array<{ timestamp: number; bbox: { x: number; y: number; width: number; height: number }; confidence: number }>;
  isLocked: boolean;
  personId?: string;
  occlusionCount: number;
  angleConsistency: number;
  cooldownRemaining?: number;
  livenessStatus?: 'real' | 'fake' | 'uncertain' | 'error';
}

export interface CooldownInfo {
  personId: string;
  memberName?: string;
  startTime: number;
  lastKnownBbox?: { x: number; y: number; width: number; height: number };
}

// Re-export needed types
export type { AttendanceGroup, AttendanceMember, AttendanceRecord, GroupType, MenuSection };

