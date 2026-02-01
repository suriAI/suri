import { create } from "zustand";
import { persistentSettings } from "@/services/PersistentSettingsService";

interface CameraState {
  // Streaming state
  isStreaming: boolean;
  isVideoLoading: boolean;
  cameraActive: boolean;
  websocketStatus: "disconnected" | "connecting" | "connected" | "error";

  // Camera devices
  cameraDevices: MediaDeviceInfo[];
  selectedCamera: string; // The ACTIVE camera
  preferredCameraId: string | null; // The USER'S CHOICE (persisted)
  isPreferredCameraMissing: boolean;

  // Actions
  setIsStreaming: (value: boolean) => void;
  setIsVideoLoading: (value: boolean) => void;
  setCameraActive: (value: boolean) => void;
  setWebsocketStatus: (
    status: "disconnected" | "connecting" | "connected" | "error",
  ) => void;
  setCameraDevices: (devices: MediaDeviceInfo[]) => void;
  setSelectedCamera: (deviceId: string) => void;
}

export const useCameraStore = create<CameraState>((set, get) => ({
  // Initial state
  isStreaming: false,
  isVideoLoading: false,
  cameraActive: false,
  websocketStatus: "disconnected",
  cameraDevices: [],
  selectedCamera: "",
  preferredCameraId: null,
  isPreferredCameraMissing: false,

  // Actions
  setIsStreaming: (value) => set({ isStreaming: value }),
  setIsVideoLoading: (value) => set({ isVideoLoading: value }),
  setCameraActive: (value) => set({ cameraActive: value }),
  setWebsocketStatus: (status) => set({ websocketStatus: status }),
  setCameraDevices: (devices) => {
    const { preferredCameraId, selectedCamera } = get();
    set({ cameraDevices: devices });

    if (devices.length === 0) {
      set({ isPreferredCameraMissing: !!preferredCameraId });
      return;
    }

    // Goal: Use preferred if available. Otherwise fallback.
    const preferredExists = devices.some(
      (d) => d.deviceId === preferredCameraId,
    );

    if (preferredCameraId && preferredExists) {
      // PREFERRED IS BACK (Auto-Recovery)
      if (selectedCamera !== preferredCameraId) {
        set({
          selectedCamera: preferredCameraId,
          isPreferredCameraMissing: false,
        });
      } else {
        set({ isPreferredCameraMissing: false });
      }
    } else if (preferredCameraId && !preferredExists) {
      // PREFERRED IS MISSING (Fallback)
      const fallbackId = devices[0].deviceId;
      if (selectedCamera !== fallbackId) {
        set({
          selectedCamera: fallbackId,
          isPreferredCameraMissing: true,
        });
      } else {
        set({ isPreferredCameraMissing: true });
      }
    } else if (!preferredCameraId) {
      // NO PREFERENCE (Fresh Start)
      if (!selectedCamera && devices.length > 0) {
        const firstId = devices[0].deviceId;
        set({ selectedCamera: firstId });
      }
    }
  },
  setSelectedCamera: (deviceId) => {
    if (!deviceId) return;
    // Explicit selection sets the PREFERRED choice
    set({
      selectedCamera: deviceId,
      preferredCameraId: deviceId,
      isPreferredCameraMissing: false,
    });
    // Save preference to store
    persistentSettings
      .setUIState({ selectedCamera: deviceId })
      .catch(console.error);
  },
}));

// Load selectedCamera from store on initialization
if (typeof window !== "undefined") {
  persistentSettings.getUIState().then((uiState) => {
    if (uiState.selectedCamera) {
      useCameraStore.setState({
        selectedCamera: uiState.selectedCamera,
        preferredCameraId: uiState.selectedCamera,
      });
    }
  });
}
