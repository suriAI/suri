import { create } from "zustand";
import type { QuickSettings } from "../../settings";
import type { GroupSection } from "../../group";
import { appStore } from "../../../services/AppStore";

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

// Load initial QuickSettings from store
const loadInitialQuickSettings = async (): Promise<QuickSettings> => {
  return await appStore.getQuickSettings();
};

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
  }, // Will be loaded from store

  // Actions
  setError: (error) => set({ error }),
  setShowSettings: (show) => set({ showSettings: show }),
  setIsSettingsFullScreen: (fullScreen) =>
    set({ isSettingsFullScreen: fullScreen }),
  setGroupInitialSection: (section) => set({ groupInitialSection: section }),
  setQuickSettings: (settings) => {
    const newSettings =
      typeof settings === "function"
        ? settings(useUIStore.getState().quickSettings)
        : settings;
    set({ quickSettings: newSettings });
    // Save to store asynchronously (don't block)
    appStore.setQuickSettings(newSettings).catch(console.error);
  },
}));

// Load QuickSettings from store on initialization
if (typeof window !== "undefined") {
  loadInitialQuickSettings().then((settings) => {
    useUIStore.setState({ quickSettings: settings });
  });
}
