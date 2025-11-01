import type {
  FaceRecognitionResponse,
  FaceRegistrationResponse,
  PersonRemovalResponse,
  DatabaseStatsResponse,
  SimilarityThresholdResponse,
  PersonUpdateResponse,
  PersonListResponse,
  DatabaseClearResponse
} from './recognition.js'

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

  interface BackendAPI {
    checkAvailability: () => Promise<{ available: boolean; status?: number; error?: string }>
    checkReadiness: () => Promise<{ ready: boolean; modelsLoaded: boolean; error?: string }>
    getModels: () => Promise<Record<string, {
      name: string;
      type: string;
      version: string;
      loaded: boolean;
      size?: number;
      accuracy?: number;
    }>>
    detectFaces: (imageBase64: string, options?: {
      model_type?: string;
      confidence_threshold?: number;
      nms_threshold?: number;
    }) => Promise<{
      faces: Array<{
        bbox: [number, number, number, number];
        confidence: number;
      }>;
      model_used: string;
    }>
    recognizeFace: (imageData: string, bbox: number[], groupId?: string, landmarks_5?: number[][], enableLivenessDetection?: boolean) => Promise<FaceRecognitionResponse>
    registerFace: (imageData: string, personId: string, bbox: number[], groupId?: string, enableLivenessDetection?: boolean) => Promise<FaceRegistrationResponse>
    getFaceStats: () => Promise<DatabaseStatsResponse>
    removePerson: (personId: string) => Promise<PersonRemovalResponse>
    updatePerson: (oldPersonId: string, newPersonId: string) => Promise<PersonUpdateResponse>
    getAllPersons: () => Promise<PersonListResponse>
    setThreshold: (threshold: number) => Promise<SimilarityThresholdResponse>
    clearDatabase: () => Promise<DatabaseClearResponse>
  }

  interface BackendReadyAPI {
    isReady: () => Promise<boolean>
  }

  // Backend Service API interface is now the primary interface for face recognition functionality
  interface BackendServiceAPI {
    // Face Recognition Database API (File-based)
    saveFaceDatabase: (databaseData: Record<string, number[]>) => Promise<unknown>
    loadFaceDatabase: () => Promise<unknown>
    removeFacePerson: (personId: string) => Promise<unknown>
    getAllFacePersons: () => Promise<unknown>
    // Generic IPC invoke method
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
    // Backend readiness check (models are loaded on server side)
    backend_ready: BackendReadyAPI
    // Backend Service API
    backend: BackendAPI
  }

  interface Window {
    suriWS?: SuriWSClientAPI
    suriVideo?: SuriVideoAPI
    suriElectron?: SuriElectronAPI
    electronAPI: BackendServiceAPI
    __suriOffFrame?: () => void
  }
}
