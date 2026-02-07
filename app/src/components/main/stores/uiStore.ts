import { create } from "zustand";
import type { AudioSettings, QuickSettings } from "@/components/settings";
import type { GroupSection } from "@/components/group";
import { persistentSettings } from "@/services/PersistentSettingsService";

interface UIState {
  // Error state
  error: string | null;

  // Warning state (non-blocking)
  warning: string | null;

  // Settings UI
  showSettings: boolean;
  isSettingsFullScreen: boolean;
  groupInitialSection: GroupSection | undefined;
  settingsInitialSection: string | undefined;
  hasSeenIntro: boolean;
  isHydrated: boolean;

  // Sidebar state
  sidebarCollapsed: boolean;
  sidebarWidth: number;

  // Quick settings
  quickSettings: QuickSettings;

  // Audio settings
  audioSettings: AudioSettings;

  // Actions
  setError: (error: string | null) => void;
  setWarning: (warning: string | null) => void;
  setShowSettings: (show: boolean) => void;
  setIsSettingsFullScreen: (fullScreen: boolean) => void;
  setGroupInitialSection: (section: GroupSection | undefined) => void;
  setSettingsInitialSection: (section: string | undefined) => void;
  setHasSeenIntro: (seen: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setQuickSettings: (
    settings: QuickSettings | ((prev: QuickSettings) => QuickSettings),
  ) => void;
  setAudioSettings: (
    settings:
      | AudioSettings
      | ((prev: AudioSettings) => AudioSettings)
      | Partial<AudioSettings>,
  ) => void;
  setIsHydrated: (isHydrated: boolean) => void;
}

// Load initial QuickSettings from store
const loadInitialSettings = async () => {
  const [quickSettings, audioSettings, uiState] = await Promise.all([
    persistentSettings.getQuickSettings(),
    persistentSettings.getAudioSettings(),
    persistentSettings.getUIState(),
  ]);
  return {
    quickSettings,
    audioSettings,
    hasSeenIntro: uiState.hasSeenIntro,
    sidebarCollapsed: uiState.sidebarCollapsed,
    sidebarWidth: uiState.sidebarWidth,
  };
};

export const useUIStore = create<UIState>((set) => ({
  // Initial state
  error: null,
  warning: null,
  showSettings: false,
  isSettingsFullScreen: false,
  groupInitialSection: undefined,
  settingsInitialSection: undefined,
  hasSeenIntro: false, // Default to false
  isHydrated: false, // Wait for hydration before rendering decisions

  sidebarCollapsed: false,
  sidebarWidth: 300,

  quickSettings: {
    cameraMirrored: true,
    showFPS: false,
    showRecognitionNames: true,
    showLandmarks: true,
  },

  audioSettings: {
    recognitionSoundEnabled: true,
    recognitionSoundUrl: "./assets/sounds/Default.mp3",
  },

  // Actions
  setError: (error) => set({ error }),
  setWarning: (warning) => set({ warning }),
  setShowSettings: (show) => set({ showSettings: show }),
  setIsSettingsFullScreen: (fullScreen) =>
    set({ isSettingsFullScreen: fullScreen }),
  setGroupInitialSection: (section) => set({ groupInitialSection: section }),
  setSettingsInitialSection: (section) =>
    set({ settingsInitialSection: section }),
  setHasSeenIntro: (seen) => {
    set({ hasSeenIntro: seen });
    persistentSettings.setUIState({ hasSeenIntro: seen }).catch(console.error);
  },
  setSidebarCollapsed: (collapsed) => {
    set({ sidebarCollapsed: collapsed });
    persistentSettings
      .setUIState({ sidebarCollapsed: collapsed })
      .catch(console.error);
  },
  setSidebarWidth: (width) => {
    set({ sidebarWidth: width });
    persistentSettings.setUIState({ sidebarWidth: width }).catch(console.error);
  },
  setQuickSettings: (settings) => {
    const newSettings =
      typeof settings === "function"
        ? settings(useUIStore.getState().quickSettings)
        : settings;
    set({ quickSettings: newSettings });
    // Save to store asynchronously (don't block)
    persistentSettings.setQuickSettings(newSettings).catch(console.error);
  },

  setAudioSettings: (settings) => {
    const prev = useUIStore.getState().audioSettings;

    const merged: AudioSettings =
      typeof settings === "function"
        ? settings(prev)
        : { ...prev, ...(settings as Partial<AudioSettings>) };

    set({ audioSettings: merged });
    persistentSettings.setAudioSettings(merged).catch(console.error);
  },
  setIsHydrated: (isHydrated: boolean) => set({ isHydrated }),
}));

// Load Settings from store on initialization
if (typeof window !== "undefined") {
  loadInitialSettings().then(
    ({
      quickSettings,
      audioSettings,
      hasSeenIntro,
      sidebarCollapsed,
      sidebarWidth,
    }) => {
      useUIStore.setState({
        quickSettings,
        audioSettings,
        hasSeenIntro,
        sidebarCollapsed: sidebarCollapsed ?? false,
        sidebarWidth: sidebarWidth ?? 300,
        isHydrated: true,
      });
    },
  );
}
