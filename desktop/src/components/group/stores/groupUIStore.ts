import { create } from "zustand";
import type { AttendanceMember } from "../../../types/recognition";
import type { GroupSection } from "../types";

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

// Load sidebar state from localStorage
const getInitialSidebarState = (): boolean => {
  if (typeof window === "undefined") return false;
  const saved = localStorage.getItem("suri_group_sidebar_collapsed");
  return saved === "true";
};

const initialState = {
  activeSection: "overview" as GroupSection,
  isSidebarCollapsed: getInitialSidebarState(),
  isMobileDrawerOpen: false,
  showAddMemberModal: false,
  showEditMemberModal: false,
  showCreateGroupModal: false,
  showEditGroupModal: false,
  editingMember: null as AttendanceMember | null,
};

export const useGroupUIStore = create<GroupUIState>((set, get) => ({
  ...initialState,

  // Navigation
  setActiveSection: (section) => set({ activeSection: section }),

  // Sidebar
  setIsSidebarCollapsed: (collapsed) => {
    set({ isSidebarCollapsed: collapsed });
    localStorage.setItem("suri_group_sidebar_collapsed", String(collapsed));
  },

  toggleSidebar: () => {
    const newValue = !get().isSidebarCollapsed;
    set({ isSidebarCollapsed: newValue });
    localStorage.setItem("suri_group_sidebar_collapsed", String(newValue));
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
