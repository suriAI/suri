import { create } from "zustand";

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
  selectedCamera: "",

  // Actions
  setIsStreaming: (value) => set({ isStreaming: value }),
  setIsVideoLoading: (value) => set({ isVideoLoading: value }),
  setCameraActive: (value) => set({ cameraActive: value }),
  setWebsocketStatus: (status) => set({ websocketStatus: status }),
  setCameraDevices: (devices) => set({ cameraDevices: devices }),
  setSelectedCamera: (deviceId) => set({ selectedCamera: deviceId }),
}));
