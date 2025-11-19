import { create } from "zustand";
import { appStore } from "../../../services/AppStore";

interface CameraState {
  // Streaming state
  isStreaming: boolean;
  isVideoLoading: boolean;
  cameraActive: boolean;
  websocketStatus: "disconnected" | "connecting" | "connected";

  // Camera devices
  cameraDevices: MediaDeviceInfo[];
  selectedCamera: string;

  // Actions
  setIsStreaming: (value: boolean) => void;
  setIsVideoLoading: (value: boolean) => void;
  setCameraActive: (value: boolean) => void;
  setWebsocketStatus: (
    status: "disconnected" | "connecting" | "connected",
  ) => void;
  setCameraDevices: (devices: MediaDeviceInfo[]) => void;
  setSelectedCamera: (deviceId: string) => void;
}

export const useCameraStore = create<CameraState>((set) => ({
  // Initial state
  isStreaming: false,
  isVideoLoading: false,
  cameraActive: false,
  websocketStatus: "disconnected",
  cameraDevices: [],
  selectedCamera: "", // Will be loaded from store

  // Actions
  setIsStreaming: (value) => set({ isStreaming: value }),
  setIsVideoLoading: (value) => set({ isVideoLoading: value }),
  setCameraActive: (value) => set({ cameraActive: value }),
  setWebsocketStatus: (status) => set({ websocketStatus: status }),
  setCameraDevices: (devices) => set({ cameraDevices: devices }),
  setSelectedCamera: (deviceId) => {
    set({ selectedCamera: deviceId });
    // Save to store asynchronously
    appStore.setUIState({ selectedCamera: deviceId }).catch(console.error);
  },
}));

// Load selectedCamera from store on initialization
if (typeof window !== "undefined") {
  appStore.getUIState().then((uiState) => {
    if (uiState.selectedCamera) {
      useCameraStore.setState({ selectedCamera: uiState.selectedCamera });
    }
  });
}
