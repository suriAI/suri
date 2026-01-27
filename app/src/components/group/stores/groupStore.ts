import { create } from "zustand";
import { attendanceManager } from "../../../services";
import { persistentSettings } from "../../../services/PersistentSettingsService";
import { getLocalDateString } from "../../../utils";
import type {
  AttendanceGroup,
  AttendanceMember,
} from "../../../types/recognition";

interface GroupState {
  selectedGroup: AttendanceGroup | null;
  groups: AttendanceGroup[];
  members: AttendanceMember[];

  loading: boolean;
  error: string | null;
  lastDeletedGroupId: string | null;

  setSelectedGroup: (group: AttendanceGroup | null) => void;
  setGroups: (groups: AttendanceGroup[]) => void;
  setMembers: (members: AttendanceMember[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  fetchGroups: () => Promise<void>;
  fetchGroupDetails: (groupId: string) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
  exportData: () => Promise<void>;

  reset: () => void;
}

const initialState = {
  selectedGroup: null,
  groups: [],
  members: [],
  loading: false,
  error: null,
  lastDeletedGroupId: null,
};

export const useGroupStore = create<GroupState>((set, get) => ({
  ...initialState,

  setSelectedGroup: (group) => {
    set({ selectedGroup: group });
    if (group) {
      persistentSettings
        .setUIState({ selectedGroupId: group.id })
        .catch(console.error);
    } else {
      persistentSettings
        .setUIState({ selectedGroupId: null })
        .catch(console.error);
      set({ members: [] });
    }
  },

  setGroups: (groups) => set({ groups }),
  setMembers: (members) => set({ members }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  fetchGroups: async () => {
    set({ loading: true, error: null });
    try {
      const allGroups = await attendanceManager.getGroups();
      set({ groups: allGroups });

      if (allGroups.length === 0) {
        set({ selectedGroup: null, members: [] });
        return;
      }

      const currentSelected = get().selectedGroup;
      if (currentSelected) {
        const stillExists = allGroups.find(
          (group) => group.id === currentSelected.id,
        );
        if (stillExists) {
          set({ selectedGroup: stillExists });
        } else {
          set({ selectedGroup: null, members: [] });
        }
      }
    } catch (err) {
      console.error("[GroupStore] Error in fetchGroups:", err);
      set({
        error: err instanceof Error ? err.message : "Failed to load groups",
      });
    } finally {
      set({ loading: false });
    }
  },

  fetchGroupDetails: async (groupId: string) => {
    set({ loading: true, error: null });
    try {
      const groupMembers = await attendanceManager.getGroupMembers(groupId);
      set({ members: groupMembers });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to load group data",
      });
    } finally {
      set({ loading: false });
    }
  },

  deleteGroup: async (groupId: string) => {
    set({ loading: true, lastDeletedGroupId: groupId });
    try {
      await attendanceManager.deleteGroup(groupId);
      const currentSelected = get().selectedGroup;

      window.dispatchEvent(
        new CustomEvent("selectGroup", {
          detail: { group: null },
        }),
      );

      if (currentSelected?.id === groupId) {
        set({ selectedGroup: null, members: [] });
      }
      await get().fetchGroups();
      set({ lastDeletedGroupId: null });
    } catch (err) {
      console.error("[GroupStore] ❌ Error in deleteGroup:", err);
      set({
        error: err instanceof Error ? err.message : "Failed to delete group",
        lastDeletedGroupId: null,
      });
    } finally {
      set({ loading: false });
    }
  },

  exportData: async () => {
    set({ loading: true, error: null });
    try {
      const data = await attendanceManager.exportData();
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `attendance-data-${getLocalDateString()}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to export data",
      });
    } finally {
      set({ loading: false });
    }
  },

  reset: () => set(initialState),
}));
