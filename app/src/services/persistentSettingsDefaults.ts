import type { QuickSettings } from "../components/settings/types";
import type { UpdateInfo } from "../types/global";

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
    reLogCooldownSeconds: number;
  };

  // UI State
  ui: {
    sidebarCollapsed: boolean;
    sidebarWidth: number;
    selectedGroupId: string | null;
    groupSidebarCollapsed: boolean;
    selectedCamera: string;
    selectedCameraLabel: string | null;
    lastRegistrationSource: string | null;
    lastRegistrationMode: string | null;
    hasSeenIntro: boolean;
    activeGroupSection: string | null;
    closeToTrayNoticeDismissed: boolean;
  };

  // Report Scratchpad (unsaved tweaks)
  reportScratchpad: Record<
    string,
    {
      columns: string[];
      groupBy: string;
      statusFilter: string;
    }
  >;

  // Report Views (per group)
  reportViews: Record<string, unknown>;
  reportDefaultViewNames: Record<string, string>;
  // Updater Info
  updater: {
    lastChecked: string | null;
    cachedInfo: UpdateInfo | null;
  };
}

// Default values (shared between main and renderer processes)
export const defaultSettings: PersistentSettingsSchema = {
  quickSettings: {
    showFPS: false,
    showRecognitionNames: true,
    cameraMirrored: true,
  },
  attendance: {
    enableSpoofDetection: true,
    trackingMode: "auto",
    lateThresholdEnabled: false,
    lateThresholdMinutes: 5,
    classStartTime: "00:00",
    attendanceCooldownSeconds: 15,
    reLogCooldownSeconds: 1800, // 30 minutes default
  },
  ui: {
    sidebarCollapsed: false,
    sidebarWidth: 360, // Middle value between MIN_EXPANDED_WIDTH (240) and MAX_WIDTH (480)
    selectedGroupId: null,
    groupSidebarCollapsed: false,
    selectedCamera: "",
    selectedCameraLabel: null,
    lastRegistrationSource: null,
    lastRegistrationMode: null,
    hasSeenIntro: false,
    activeGroupSection: null,
    closeToTrayNoticeDismissed: false,
  },
  reportScratchpad: {},
  reportViews: {},
  reportDefaultViewNames: {},
  updater: {
    lastChecked: null,
    cachedInfo: null,
  },
};
