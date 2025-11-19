import { create } from "zustand";
import type { DetectionResult, TrackedFace } from "../types";
import type { ExtendedFaceRecognitionResponse } from "../utils";

interface DetectionState {
  // Detection state
  currentDetections: DetectionResult | null;
  detectionFps: number;

  // Recognition state
  currentRecognitionResults: Map<number, ExtendedFaceRecognitionResponse>;

  // Tracking state
  trackedFaces: Map<string, TrackedFace>;

  // Actions
  setCurrentDetections: (detections: DetectionResult | null) => void;
  setDetectionFps: (fps: number) => void;
  setCurrentRecognitionResults: (
    results:
      | Map<number, ExtendedFaceRecognitionResponse>
      | ((
          prev: Map<number, ExtendedFaceRecognitionResponse>,
        ) => Map<number, ExtendedFaceRecognitionResponse>),
  ) => void;
  setTrackedFaces: (
    faces:
      | Map<string, TrackedFace>
      | ((prev: Map<string, TrackedFace>) => Map<string, TrackedFace>),
  ) => void;
  resetDetectionState: () => void;
}

export const useDetectionStore = create<DetectionState>((set, get) => ({
  // Initial state
  currentDetections: null,
  detectionFps: 0,
  currentRecognitionResults: new Map(),
  trackedFaces: new Map(),

  // Actions
  setCurrentDetections: (detections) => set({ currentDetections: detections }),
  setDetectionFps: (fps) => set({ detectionFps: fps }),
  setCurrentRecognitionResults: (results) => {
    const prevResults = get().currentRecognitionResults;
    const newResults =
      typeof results === "function" ? results(prevResults) : results;
    const mapResults = newResults instanceof Map ? newResults : new Map();
    set({ currentRecognitionResults: mapResults });
  },
  setTrackedFaces: (faces) => {
    const newFaces =
      typeof faces === "function" ? faces(get().trackedFaces) : faces;
    const mapFaces = newFaces instanceof Map ? newFaces : new Map();
    set({ trackedFaces: mapFaces });
  },
  resetDetectionState: () =>
    set({
      currentDetections: null,
      currentRecognitionResults: new Map(),
      trackedFaces: new Map(),
    }),
}));
