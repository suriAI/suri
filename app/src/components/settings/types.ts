// Settings types

export interface QuickSettings {
  showFPS: boolean;
  showRecognitionNames: boolean;
  cameraMirrored: boolean;
}

export interface AttendanceSettings {
  trackingMode: "auto" | "manual";
  lateThresholdEnabled: boolean;
  lateThresholdMinutes: number;
  classStartTime: string;
  attendanceCooldownSeconds: number;
  reLogCooldownSeconds: number; // New setting for database prevention
  enableSpoofDetection: boolean;
}

export interface SettingsOverview {
  totalPersons: number;
  totalMembers: number;
  lastUpdated: string;
}
