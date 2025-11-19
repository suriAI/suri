import { create } from "zustand";
import type {
  AttendanceGroup,
  AttendanceMember,
  AttendanceRecord,
} from "../../../types/recognition";
import type { CooldownInfo } from "../types";

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

// Load enableSpoofDetection from localStorage
const getInitialSpoofDetection = (): boolean => {
  if (typeof window === "undefined") return true;
  const saved = localStorage.getItem("suri_enable_spoof_detection");
  return saved !== null ? saved === "true" : true;
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
  enableSpoofDetection: getInitialSpoofDetection(),

  // Actions
  setCurrentGroup: (group) => {
    set({ currentGroup: group });
    if (group) {
      localStorage.setItem("suri_selected_group_id", group.id);
    } else {
      localStorage.removeItem("suri_selected_group_id");
    }
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
  setTrackingMode: (mode) => set({ trackingMode: mode }),
  setAttendanceCooldownSeconds: (seconds) =>
    set({ attendanceCooldownSeconds: seconds }),
  setEnableSpoofDetection: (enabled) => {
    set({ enableSpoofDetection: enabled });
    localStorage.setItem("suri_enable_spoof_detection", String(enabled));
  },
}));
