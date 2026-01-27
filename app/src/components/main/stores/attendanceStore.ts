import { create } from "zustand";
import type {
  AttendanceGroup,
  AttendanceMember,
  AttendanceRecord,
} from "../../../types/recognition";
import type { CooldownInfo } from "../types";
import { persistentSettings } from "../../../services/PersistentSettingsService";

interface AttendanceState {
  currentGroup: AttendanceGroup | null;
  attendanceGroups: AttendanceGroup[];
  groupMembers: AttendanceMember[];
  recentAttendance: AttendanceRecord[];

  showGroupManagement: boolean;
  showDeleteConfirmation: boolean;
  groupToDelete: AttendanceGroup | null;
  newGroupName: string;

  persistentCooldowns: Map<string, CooldownInfo>;

  trackingMode: "auto" | "manual";
  attendanceCooldownSeconds: number;
  enableSpoofDetection: boolean;

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

const loadInitialSettings = async () => {
  const attendanceSettings = await persistentSettings.getAttendanceSettings();
  return {
    trackingMode: attendanceSettings.trackingMode,
    attendanceCooldownSeconds: attendanceSettings.attendanceCooldownSeconds,
    enableSpoofDetection: attendanceSettings.enableSpoofDetection,
  };
};

export const useAttendanceStore = create<AttendanceState>((set, get) => ({
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
  enableSpoofDetection: true,

  setCurrentGroup: (group) => {
    set({ currentGroup: group });
    persistentSettings
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
    persistentSettings
      .setAttendanceSettings({ trackingMode: mode })
      .catch(console.error);
  },
  setAttendanceCooldownSeconds: (seconds) => {
    set({ attendanceCooldownSeconds: seconds });
    persistentSettings
      .setAttendanceSettings({ attendanceCooldownSeconds: seconds })
      .catch(console.error);
  },
  setEnableSpoofDetection: (enabled) => {
    set({ enableSpoofDetection: enabled });
    persistentSettings
      .setAttendanceSettings({ enableSpoofDetection: enabled })
      .catch(console.error);
  },
}));

if (typeof window !== "undefined") {
  loadInitialSettings().then((settings) => {
    useAttendanceStore.setState(settings as Partial<AttendanceState>);
  });
}
