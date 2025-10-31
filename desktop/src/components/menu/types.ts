import type { AttendanceGroup } from '../../types/recognition';

export type MenuSection = 'overview' | 'members' | 'reports' | 'registration' | 'settings';

export interface MenuProps {
  onBack: () => void;
  initialSection?: MenuSection;
  initialGroup?: AttendanceGroup | null; // Pre-select this group when Menu opens
  onGroupsChanged?: () => void; // Callback when groups are created/deleted
}

