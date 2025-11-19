import { create } from "zustand";
import type { AttendanceMember } from "../../../types/recognition";
import type { GroupSection } from "../types";
import { appStore } from "../../../services/AppStore";

interface GroupUIState {
  // Navigation
  activeSection: GroupSection;

  // Sidebar state
  isSidebarCollapsed: boolean;
  isMobileDrawerOpen: boolean;

  // Modal states
  showAddMemberModal: boolean;
  showEditMemberModal: boolean;
  showCreateGroupModal: boolean;
  showEditGroupModal: boolean;

  // Modal data
  editingMember: AttendanceMember | null;

  // Actions - Navigation
  setActiveSection: (section: GroupSection) => void;

  // Actions - Sidebar
  setIsSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setIsMobileDrawerOpen: (open: boolean) => void;

  // Actions - Modals
  openAddMember: () => void;
  closeAddMember: () => void;
  openEditMember: (member: AttendanceMember) => void;
  closeEditMember: () => void;
  openCreateGroup: () => void;
  closeCreateGroup: () => void;
  openEditGroup: () => void;
  closeEditGroup: () => void;

  // Reset
  reset: () => void;
}

const initialState = {
  activeSection: "overview" as GroupSection,
  isSidebarCollapsed: false, // Will be loaded from store
  isMobileDrawerOpen: false,
  showAddMemberModal: false,
  showEditMemberModal: false,
  showCreateGroupModal: false,
  showEditGroupModal: false,
  editingMember: null as AttendanceMember | null,
};

export const useGroupUIStore = create<GroupUIState>((set, get) => ({
  ...initialState,

  // Navigation - only update if section actually changed
  setActiveSection: (section) => {
    const current = get().activeSection;
    if (current !== section) {
      set({ activeSection: section });
    }
  },

  // Sidebar
  setIsSidebarCollapsed: (collapsed) => {
    set({ isSidebarCollapsed: collapsed });
    appStore
      .setUIState({ groupSidebarCollapsed: collapsed })
      .catch(console.error);
  },

  toggleSidebar: () => {
    const newValue = !get().isSidebarCollapsed;
    set({ isSidebarCollapsed: newValue });
    appStore
      .setUIState({ groupSidebarCollapsed: newValue })
      .catch(console.error);
  },

  setIsMobileDrawerOpen: (open) => set({ isMobileDrawerOpen: open }),

  // Modals
  openAddMember: () => set({ showAddMemberModal: true }),
  closeAddMember: () => set({ showAddMemberModal: false }),

  openEditMember: (member) =>
    set({ editingMember: member, showEditMemberModal: true }),
  closeEditMember: () =>
    set({ editingMember: null, showEditMemberModal: false }),

  openCreateGroup: () => set({ showCreateGroupModal: true }),
  closeCreateGroup: () => set({ showCreateGroupModal: false }),

  openEditGroup: () => set({ showEditGroupModal: true }),
  closeEditGroup: () => set({ showEditGroupModal: false }),

  reset: () => set(initialState),
}));

// Load sidebar state from store on initialization
if (typeof window !== "undefined") {
  appStore.getUIState().then((uiState) => {
    useGroupUIStore.setState({
      isSidebarCollapsed: uiState.groupSidebarCollapsed,
    });
  });
}
