export {}

declare global {
  interface SuriWSClientAPI {
    connect: (url?: string) => Promise<void>
    send: (msg: unknown) => void
    sendRequest: (action: string, payload?: unknown, timeoutMs?: number) => Promise<unknown>
    onMessage: (handler: (msg: Record<string, unknown>) => void) => () => void
    close: () => void
  }

  interface SuriVideoAPI {
    start: (opts?: { device?: number; width?: number; height?: number; fps?: number; annotate?: boolean }) => Promise<boolean>
    startFast: (opts?: { device?: number; width?: number; height?: number; fps?: number; annotate?: boolean }) => Promise<boolean>
    stop: () => Promise<boolean>
    pause: () => Promise<boolean>
    resume: () => Promise<boolean>
    setDevice: (device: number) => Promise<boolean>
    onFrame: (handler: (buf: ArrayBuffer | Uint8Array) => void) => () => void
    onEvent: (handler: (evt: Record<string, unknown>) => void) => () => void
    onWebSocketBroadcast: (handler: (evt: Record<string, unknown>) => void) => () => void
  }

  interface SuriElectronAPI {
    minimize: () => Promise<boolean>
    maximize: () => Promise<boolean>
    close: () => Promise<boolean>
    onMaximize: (callback: () => void) => () => void
    onUnmaximize: (callback: () => void) => () => void
  }

  interface FaceRecognitionAPI {
    initializeFaceRecognition: (options?: { similarityThreshold?: number }) => Promise<{ success: boolean; error?: string }>
    processFrame: (imageData: ImageData) => Promise<{
      detections: Array<{
        bbox: [number, number, number, number];
        confidence: number;
        landmarks: number[][];
        recognition?: {
          personId: string | null;
          similarity: number;
        };
      }>;
      processingTime: number;
    }>
    registerPerson: (personId: string, imageData: ImageData, landmarks: number[][]) => Promise<boolean>
    getAllPersons: () => Promise<string[]>
    removePerson: (personId: string) => Promise<boolean>
    // Face Log Database API
    logDetection: (detection: FaceLogEntry) => Promise<string>
    getRecentLogs: (limit?: number) => Promise<FaceLogEntry[]>
    getTodayStats: () => Promise<{ totalDetections: number; uniquePersons: number; firstDetection: string | null; lastDetection: string | null }>
    exportData: (filePath: string) => Promise<boolean>
    clearOldData: (daysToKeep: number) => Promise<number>
  }

  interface FaceLogEntry {
    id?: string;
    timestamp: string;
    personId: string | null;
    confidence: number;
    bbox: [number, number, number, number];
    similarity?: number;
    mode: 'auto' | 'manual';
  }

  interface Window {
    suriWS?: SuriWSClientAPI
    suriVideo?: SuriVideoAPI
    suriElectron?: SuriElectronAPI
    electronAPI?: FaceRecognitionAPI
    __suriOffFrame?: () => void
  }
}
