import { create } from "zustand";
import type { QuickSettings } from "../../settings";
import type { GroupSection } from "../../group";

interface UIState {
  // Error state
  error: string | null;

  // Settings UI
  showSettings: boolean;
  isSettingsFullScreen: boolean;
  groupInitialSection: GroupSection | undefined;

  // Quick settings
  quickSettings: QuickSettings;

  // Actions
  setError: (error: string | null) => void;
  setShowSettings: (show: boolean) => void;
  setIsSettingsFullScreen: (fullScreen: boolean) => void;
  setGroupInitialSection: (section: GroupSection | undefined) => void;
  setQuickSettings: (
    settings: QuickSettings | ((prev: QuickSettings) => QuickSettings),
  ) => void;
}

export const useUIStore = create<UIState>((set) => ({
  // Initial state
  error: null,
  showSettings: false,
  isSettingsFullScreen: false,
  groupInitialSection: undefined,
  quickSettings: {
    cameraMirrored: true,
    showFPS: false,
    showPreprocessing: false,
    showBoundingBoxes: true,
    showRecognitionNames: true,
    showLandmarks: true,
  },

  // Actions
  setError: (error) => set({ error }),
  setShowSettings: (show) => set({ showSettings: show }),
  setIsSettingsFullScreen: (fullScreen) =>
    set({ isSettingsFullScreen: fullScreen }),
  setGroupInitialSection: (section) => set({ groupInitialSection: section }),
  setQuickSettings: (settings) =>
    set((state) => ({
      quickSettings:
        typeof settings === "function"
          ? settings(state.quickSettings)
          : settings,
    })),
}));
