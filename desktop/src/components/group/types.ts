import type { AttendanceGroup } from '../../types/recognition';

export type GroupSection = 'overview' | 'members' | 'reports' | 'registration' | 'settings';

export interface GroupPanelProps {
  onBack: () => void;
  initialSection?: GroupSection;
  initialGroup?: AttendanceGroup | null; // Pre-select this group when GroupPanel opens
  onGroupsChanged?: () => void; // Callback when groups are created/deleted
  isEmbedded?: boolean; // Whether GroupPanel is embedded in Settings or standalone
}

