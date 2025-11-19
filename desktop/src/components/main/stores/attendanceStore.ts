import { create } from "zustand";
import type {
  AttendanceGroup,
  AttendanceMember,
  AttendanceRecord,
} from "../../../types/recognition";
import type { CooldownInfo } from "../types";
import { appStore } from "../../../services/AppStore";

interface AttendanceState {
  // Group state
  currentGroup: AttendanceGroup | null;
  attendanceGroups: AttendanceGroup[];
  groupMembers: AttendanceMember[];
  recentAttendance: AttendanceRecord[];

  // Group management UI
  showGroupManagement: boolean;
  showDeleteConfirmation: boolean;
  groupToDelete: AttendanceGroup | null;
  newGroupName: string;

  // Cooldowns
  persistentCooldowns: Map<string, CooldownInfo>;

  // Settings
  trackingMode: "auto" | "manual";
  attendanceCooldownSeconds: number;
  enableSpoofDetection: boolean;

  // Actions
  setCurrentGroup: (group: AttendanceGroup | null) => void;
  setAttendanceGroups: (groups: AttendanceGroup[]) => void;
  setGroupMembers: (members: AttendanceMember[]) => void;
  setRecentAttendance: (records: AttendanceRecord[]) => void;
  setShowGroupManagement: (show: boolean) => void;
  setShowDeleteConfirmation: (show: boolean) => void;
  setGroupToDelete: (group: AttendanceGroup | null) => void;
  setNewGroupName: (name: string) => void;
  setPersistentCooldowns: (
    cooldowns:
      | Map<string, CooldownInfo>
      | ((prev: Map<string, CooldownInfo>) => Map<string, CooldownInfo>),
  ) => void;
  setTrackingMode: (mode: "auto" | "manual") => void;
  setAttendanceCooldownSeconds: (seconds: number) => void;
  setEnableSpoofDetection: (enabled: boolean) => void;
}

// Load initial settings from store (async, will be set after store loads)
const loadInitialSettings = async () => {
  const attendanceSettings = await appStore.getAttendanceSettings();
  return {
    trackingMode: attendanceSettings.trackingMode,
    attendanceCooldownSeconds: attendanceSettings.attendanceCooldownSeconds,
    enableSpoofDetection: attendanceSettings.enableSpoofDetection,
  };
};

export const useAttendanceStore = create<AttendanceState>((set, get) => ({
  // Initial state
  currentGroup: null,
  attendanceGroups: [],
  groupMembers: [],
  recentAttendance: [],
  showGroupManagement: false,
  showDeleteConfirmation: false,
  groupToDelete: null,
  newGroupName: "",
  persistentCooldowns: new Map(),
  trackingMode: "auto",
  attendanceCooldownSeconds: 10,
  enableSpoofDetection: true, // Will be loaded from store

  // Actions
  setCurrentGroup: (group) => {
    set({ currentGroup: group });
    // Save to store asynchronously (don't block)
    appStore
      .setUIState({
        selectedGroupId: group?.id || null,
      })
      .catch(console.error);
  },
  setAttendanceGroups: (groups) => set({ attendanceGroups: groups }),
  setGroupMembers: (members) => set({ groupMembers: members }),
  setRecentAttendance: (records) => set({ recentAttendance: records }),
  setShowGroupManagement: (show) => set({ showGroupManagement: show }),
  setShowDeleteConfirmation: (show) => set({ showDeleteConfirmation: show }),
  setGroupToDelete: (group) => set({ groupToDelete: group }),
  setNewGroupName: (name) => set({ newGroupName: name }),
  setPersistentCooldowns: (cooldowns) => {
    const prevCooldowns = get().persistentCooldowns;
    const newCooldowns =
      typeof cooldowns === "function" ? cooldowns(prevCooldowns) : cooldowns;
    const mapCooldowns = newCooldowns instanceof Map ? newCooldowns : new Map();
    set({ persistentCooldowns: mapCooldowns });
  },
  setTrackingMode: (mode) => {
    set({ trackingMode: mode });
    appStore.setAttendanceSettings({ trackingMode: mode }).catch(console.error);
  },
  setAttendanceCooldownSeconds: (seconds) => {
    set({ attendanceCooldownSeconds: seconds });
    appStore
      .setAttendanceSettings({ attendanceCooldownSeconds: seconds })
      .catch(console.error);
  },
  setEnableSpoofDetection: (enabled) => {
    set({ enableSpoofDetection: enabled });
    appStore
      .setAttendanceSettings({ enableSpoofDetection: enabled })
      .catch(console.error);
  },
}));

// Load settings from store on initialization
if (typeof window !== "undefined") {
  loadInitialSettings().then((settings) => {
    useAttendanceStore.setState(settings);
  });
}
