import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type {
  AttendanceGroup,
  AttendanceMember,
  AttendanceRecord,
} from "@/types/recognition";
import type { CooldownInfo } from "@/components/main/types";
import { persistentSettings } from "@/services/PersistentSettingsService";

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

  // trackingMode removed
  attendanceCooldownSeconds: number;
  reLogCooldownSeconds: number;
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
  // setTrackingMode removed
  setAttendanceCooldownSeconds: (seconds: number) => void;
  setReLogCooldownSeconds: (seconds: number) => void;
  setEnableSpoofDetection: (enabled: boolean) => void;
}

const loadInitialSettings = async (): Promise<Partial<AttendanceState>> => {
  const [attendanceSettings, savedCooldowns] = await Promise.all([
    persistentSettings.getAttendanceSettings(),
    persistentSettings.getCooldowns(),
  ]);

  // Convert saved record to Map and prune expired ones
  const now = Date.now();
  const reLogSeconds = attendanceSettings.reLogCooldownSeconds ?? 1800;
  const reLogMs = reLogSeconds * 1000;
  const cooldownMap = new Map<string, CooldownInfo>();
  Object.entries(savedCooldowns).forEach(([key, value]) => {
    const info = value as CooldownInfo;
    // Keep persisted cooldowns for the full re-log window so app restarts
    // don't allow immediate duplicate logs.
    const infoMs = (info.cooldownDurationSeconds || 0) * 1000;
    const effectiveTtlMs = Math.max(reLogMs, infoMs);
    if (now - info.startTime < effectiveTtlMs + 500) {
      cooldownMap.set(key, info);
    }
  });

  return {
    // trackingMode removed
    attendanceCooldownSeconds: attendanceSettings.attendanceCooldownSeconds,
    reLogCooldownSeconds: attendanceSettings.reLogCooldownSeconds ?? 1800,
    enableSpoofDetection: attendanceSettings.enableSpoofDetection,
    persistentCooldowns: cooldownMap,
  };
};

export const useAttendanceStore = create<AttendanceState>()(
  subscribeWithSelector((set, get) => ({
    currentGroup: null,
    attendanceGroups: [],
    groupMembers: [],
    recentAttendance: [],
    showGroupManagement: false,
    showDeleteConfirmation: false,
    groupToDelete: null,
    newGroupName: "",
    persistentCooldowns: new Map(),
    // trackingMode removed
    attendanceCooldownSeconds: 15,
    reLogCooldownSeconds: 1800,
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
      const newCooldownsMap =
        typeof cooldowns === "function" ? cooldowns(prevCooldowns) : cooldowns;

      set({ persistentCooldowns: newCooldownsMap });

      // Persist to electron-store
      // Convert Map to plain object for storage
      const obj: Record<string, CooldownInfo> = {};
      newCooldownsMap.forEach((val, key) => {
        obj[key] = val;
      });
      persistentSettings.setCooldowns(obj).catch(console.error);
    },
    // setTrackingMode removed
    setAttendanceCooldownSeconds: (seconds) => {
      set({ attendanceCooldownSeconds: seconds });
      persistentSettings
        .setAttendanceSettings({ attendanceCooldownSeconds: seconds })
        .catch(console.error);
    },
    setReLogCooldownSeconds: (seconds) => {
      set({ reLogCooldownSeconds: seconds });
      persistentSettings
        .setAttendanceSettings({ reLogCooldownSeconds: seconds })
        .catch(console.error);
    },
    setEnableSpoofDetection: (enabled) => {
      set({ enableSpoofDetection: enabled });
      persistentSettings
        .setAttendanceSettings({ enableSpoofDetection: enabled })
        .catch(console.error);
    },
  })),
);

if (typeof window !== "undefined") {
  loadInitialSettings().then((settings) => {
    useAttendanceStore.setState(settings as Partial<AttendanceState>);
  });

  // Second pass: once groups are set, find the one matching selectedGroupId
  useAttendanceStore.subscribe(
    (state) => state.attendanceGroups,
    (groups: AttendanceGroup[]) => {
      const currentGroup = useAttendanceStore.getState().currentGroup;
      if (!currentGroup && groups.length > 0) {
        persistentSettings.getUIState().then((ui) => {
          if (ui.selectedGroupId) {
            const match = groups.find(
              (g: AttendanceGroup) => g.id === ui.selectedGroupId,
            );
            if (match) {
              useAttendanceStore.setState({ currentGroup: match });
            }
          }
        });
      }
    },
  );
}
