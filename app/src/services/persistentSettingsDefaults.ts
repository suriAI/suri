import type { QuickSettings } from "../components/settings/types.js";

// Define the persistent settings schema (shared between main and renderer)
export interface PersistentSettingsSchema {
  // Display Settings (QuickSettings)
  quickSettings: QuickSettings;

  // Attendance Settings
  attendance: {
    enableSpoofDetection: boolean;
    trackingMode: "auto" | "manual";
    lateThresholdEnabled: boolean;
    lateThresholdMinutes: number;
    classStartTime: string;
    attendanceCooldownSeconds: number;
  };

  // UI State
  ui: {
    sidebarCollapsed: boolean;
    sidebarWidth: number;
    selectedGroupId: string | null;
    groupSidebarCollapsed: boolean;
    selectedCamera: string;
    lastRegistrationSource: string | null;
    lastRegistrationMode: string | null;
  };

  // Report Views (per group)
  reportViews: Record<string, unknown>;
  reportDefaultViewNames: Record<string, string>;
}

// Default values (shared between main and renderer processes)
export const defaultSettings: PersistentSettingsSchema = {
  quickSettings: {
    showFPS: false,
    showLandmarks: true,
    showRecognitionNames: true,
    cameraMirrored: true,
  },
  attendance: {
    enableSpoofDetection: true,
    trackingMode: "auto",
    lateThresholdEnabled: false,
    lateThresholdMinutes: 5,
    classStartTime: "00:00",
    attendanceCooldownSeconds: 10,
  },
  ui: {
    sidebarCollapsed: false,
    sidebarWidth: 360, // Middle value between MIN_EXPANDED_WIDTH (240) and MAX_WIDTH (480)
    selectedGroupId: null,
    groupSidebarCollapsed: false,
    selectedCamera: "",
    lastRegistrationSource: null,
    lastRegistrationMode: null,
  },
  reportViews: {},
  reportDefaultViewNames: {},
};
