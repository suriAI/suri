// Settings types

export interface QuickSettings {
  showFPS: boolean;
  showRecognitionNames: boolean;
  cameraMirrored: boolean;
  // Present in UI store; kept optional to avoid breaking older saved settings
  showLandmarks?: boolean;
}

export interface AudioSettings {
  recognitionSoundEnabled: boolean;
  recognitionSoundUrl: string | null;
}

export interface AttendanceSettings {
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
