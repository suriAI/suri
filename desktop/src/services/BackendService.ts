/// <reference types="../types/global.d.ts" />

import type {
  FaceRecognitionResponse,
  FaceRegistrationResponse,
  PersonRemovalResponse,
  PersonUpdateResponse,
  SimilarityThresholdResponse,
  DatabaseStatsResponse,
  PersonInfo,
} from "../types/recognition.js";

/**
 * Backend Service for integrating with FastAPI face detection backend
 * Uses IPC for fast, zero-overhead communication with Python backend
 */

interface DetectionRequest {
  image: string; // base64 encoded image
  model_type?: string;
  confidence_threshold?: number;
  nms_threshold?: number;
  enable_liveness_detection?: boolean;
}

interface DetectionResponse {
  faces: Array<{
    bbox: [number, number, number, number];
    confidence: number;
    landmarks_5?: number[][];
  }>;
  model_used: string;
  session_id?: string;
}

interface BackendConfig {
  baseUrl: string;
  timeout: number;
  retryAttempts: number;
}

interface ModelInfo {
  name: string;
  description?: string;
  version?: string;
}

interface IPCMessage {
  type?: string;
  message?: string;
  status?: string;
  error?: string;
  timestamp?: number;
  data?: unknown;
  // Detection response properties
  faces?: Array<{
    bbox?: number[];
    confidence?: number;
    liveness?: {
      is_real?: boolean | null;
      live_score?: number;
      spoof_score?: number;
      confidence?: number;
      status?: "live" | "spoof" | "error" | "too_small";
      label?: string;
      attack_type?: string;
      message?: string;
    };
    track_id?: number;
  }>;
  model_used?: string;
  [key: string]: unknown;
}

export class BackendService {
  private config: BackendConfig;
  private clientId: string;
  private messageHandlers: Map<string, (data: IPCMessage) => void> = new Map();
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: number | null = null;
  private pingInterval: number | null = null;
  private isConnecting = false;
  private connectionPromise: Promise<void> | null = null;
  private enableLivenessDetection: boolean = (() => {
    const saved = localStorage.getItem("suri_enable_spoof_detection");
    return saved !== null ? saved === "true" : true;
  })();

  constructor(config?: Partial<BackendConfig>) {
    this.config = {
      baseUrl: "http://127.0.0.1:8700",
      timeout: 30000,
      retryAttempts: 3,
      ...config,
    };

    this.clientId = `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Check if the backend is available
   */
  async isBackendAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check if the backend is ready for face recognition (models loaded)
   */
  async checkReadiness(): Promise<{
    ready: boolean;
    modelsLoaded: boolean;
    error?: string;
  }> {
    try {
      // First check if backend is available
      const isAvailable = await this.isBackendAvailable();
      if (!isAvailable) {
        return {
          ready: false,
          modelsLoaded: false,
          error: "Backend not available",
        };
      }

      // Check if critical models are loaded
      const models = await this.getAvailableModels();
      const requiredModels = ["face_detector", "face_recognizer"];
      const loadedModels = Object.keys(models).filter((key) =>
        requiredModels.some((required) =>
          key.toLowerCase().includes(required.toLowerCase()),
        ),
      );

      const modelsLoaded = loadedModels.length >= requiredModels.length;

      return {
        ready: modelsLoaded,
        modelsLoaded,
        error: modelsLoaded
          ? undefined
          : "Required face recognition models not loaded",
      };
    } catch (error) {
      console.error("Failed to check backend readiness:", error);
      return {
        ready: false,
        modelsLoaded: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get available models from the backend
   */
  async getAvailableModels(): Promise<Record<string, ModelInfo>> {
    try {
      const response = await fetch(`${this.config.baseUrl}/models`, {
        method: "GET",
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to get available models:", error);
      throw error;
    }
  }

  /**
   * Detect faces using HTTP API
   */
  async detectFaces(
    imageData: string,
    options: {
      model_type?: string;
      confidence_threshold?: number;
      nms_threshold?: number;
    } = {},
  ): Promise<DetectionResponse> {
    try {
      const request: DetectionRequest = {
        image: imageData,
        model_type: options.model_type || "face_detector",
        confidence_threshold: options.confidence_threshold || 0.5,
        nms_threshold: options.nms_threshold || 0.3,
        enable_liveness_detection: this.enableLivenessDetection,
      };

      const response = await fetch(`${this.config.baseUrl}/detect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Face detection failed:", error);
      throw error;
    }
  }

  async connectWebSocket(): Promise<void> {
    // If already connecting, return the existing promise
    if (this.isConnecting && this.connectionPromise) {
      return this.connectionPromise;
    }

    // If already connected, return immediately
    if (this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    this.isConnecting = true;
    this.connectionPromise = new Promise((resolve, reject) => {
      try {
        // Close existing connection if any
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }

        const wsUrl = this.config.baseUrl
          .replace("http://", "ws://")
          .replace("https://", "wss://");
        const url = `${wsUrl}/ws/detect/${this.clientId}`;

        this.ws = new WebSocket(url);
        this.ws.binaryType = "arraybuffer";

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.isConnecting = false;
          this.connectionPromise = null;
          this.startPingInterval();
          // Send initial config with liveness detection setting
          this.sendConfig();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
          } catch (error) {
            console.error("[BackendService] Failed to parse message:", error);
          }
        };

        this.ws.onclose = (event) => {
          console.log(
            `[BackendService] WebSocket closed - code: ${event.code}, wasClean: ${event.wasClean}, reason: ${event.reason || "none"}`,
          );
          this.stopPingInterval();
          this.isConnecting = false;
          this.connectionPromise = null;

          if (
            !event.wasClean &&
            this.reconnectAttempts < this.maxReconnectAttempts
          ) {
            console.log(
              "[BackendService] WebSocket closed unexpectedly, will attempt reconnect...",
            );
            this.scheduleReconnect();
          } else {
            console.log(
              "[BackendService] WebSocket closed cleanly or max reconnect attempts reached",
            );
            this.handleMessage({
              type: "connection",
              status: "disconnected",
              timestamp: Date.now(),
            });
          }
        };

        this.ws.onerror = (error) => {
          console.error("[BackendService] WebSocket error:", error);
          this.isConnecting = false;
          this.connectionPromise = null;
          reject(error);
        };
      } catch (error) {
        console.error("[BackendService] Failed to create WebSocket:", error);
        this.isConnecting = false;
        this.connectionPromise = null;
        reject(error);
      }
    });

    return this.connectionPromise;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);

    this.reconnectTimeout = window.setTimeout(() => {
      this.connectWebSocket().catch((error) => {
        console.error("[BackendService] Reconnection failed:", error);
      });
    }, delay);
  }

  private startPingInterval(): void {
    this.stopPingInterval();

    this.pingInterval = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: "ping",
            client_id: this.clientId,
            timestamp: Date.now(),
          }),
        );
      }
    }, 30000);
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Update liveness detection setting and send config to backend
   */
  setLivenessDetection(enabled: boolean): void {
    this.enableLivenessDetection = enabled;
    this.sendConfig();
  }

  /**
   * Send config message to WebSocket with current settings
   */
  private sendConfig(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "config",
          enable_liveness_detection: this.enableLivenessDetection,
          timestamp: Date.now(),
        }),
      );
    }
  }

  async sendDetectionRequest(frameData: ArrayBuffer): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      this.ws.send(frameData);
    } catch (error) {
      this.handleMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      });
    }
  }

  ping(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "ping",
          client_id: this.clientId,
          timestamp: Date.now(),
        }),
      );
    }
  }

  onMessage(type: string, handler: (data: IPCMessage) => void): void {
    this.messageHandlers.set(type, handler);
  }

  offMessage(type: string): void {
    this.messageHandlers.delete(type);
  }

  disconnect(): void {
    console.log("[BackendService] Disconnecting WebSocket...");
    this.stopPingInterval();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.isConnecting = false;
    this.connectionPromise = null;

    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(
            JSON.stringify({
              type: "disconnect",
              client_id: this.clientId,
              timestamp: Date.now(),
            }),
          );
          this.ws.close(1000, "Client disconnect");
        } else if (this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close(1000, "Client disconnect");
        }
        console.log("[BackendService] WebSocket close() called");
      } catch (error) {
        console.warn("[BackendService] Error closing WebSocket:", error);
      } finally {
        this.ws = null;
      }
    }
  }

  getConnectionStatus(): {
    http: boolean;
    websocket: boolean;
    clientId: string;
  } {
    return {
      http: true,
      websocket: this.ws?.readyState === WebSocket.OPEN,
      clientId: this.clientId,
    };
  }

  getWebSocketStatus(): "disconnected" | "connecting" | "connected" {
    if (!this.ws) return "disconnected";

    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return "connecting";
      case WebSocket.OPEN:
        return "connected";
      default:
        return "disconnected";
    }
  }

  isWebSocketReady(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // Face Recognition Methods

  /**
   * Recognize a face from image data (via IPC)
   */
  async recognizeFace(
    imageData: ArrayBuffer,
    bbox?: number[],
    groupId?: string,
    landmarks_5?: number[][],
  ): Promise<FaceRecognitionResponse> {
    try {
      // Convert ArrayBuffer to Base64
      const blob = new Blob([imageData], { type: "image/jpeg" });
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
      const base64Image = dataUrl.split(",")[1];

      return await window.electronAPI.backend.recognizeFace(
        base64Image,
        bbox || [],
        groupId,
        landmarks_5,
        this.enableLivenessDetection,
      );
    } catch (error) {
      console.error("Face recognition failed:", error);
      throw error;
    }
  }

  /**
   * Register a new face with person ID (via IPC)
   */
  async registerFace(
    imageData: string,
    personId: string,
    bbox?: number[],
    groupId?: string,
  ): Promise<FaceRegistrationResponse> {
    try {
      return await window.electronAPI.backend.registerFace(
        imageData,
        personId,
        bbox || [],
        groupId,
        this.enableLivenessDetection,
      );
    } catch (error) {
      console.error("Face registration failed:", error);
      throw error;
    }
  }

  /**
   * Remove a person from the database (via IPC)
   */
  async removePerson(personId: string): Promise<PersonRemovalResponse> {
    try {
      return await window.electronAPI.backend.removePerson(personId);
    } catch (error) {
      console.error("Person removal failed:", error);
      throw error;
    }
  }

  /**
   * Update person ID (via IPC)
   */
  async updatePerson(
    oldPersonId: string,
    newPersonId: string,
  ): Promise<PersonUpdateResponse> {
    try {
      return await window.electronAPI.backend.updatePerson(
        oldPersonId,
        newPersonId,
      );
    } catch (error) {
      console.error("Person update failed:", error);
      throw error;
    }
  }

  /**
   * Get all registered persons (via IPC)
   */
  async getAllPersons(): Promise<PersonInfo[]> {
    try {
      const result = await window.electronAPI.backend.getAllPersons();
      return result.persons || [];
    } catch (error) {
      console.error("Failed to get persons:", error);
      throw error;
    }
  }

  /**
   * Set similarity threshold for recognition (via IPC)
   */
  async setSimilarityThreshold(
    threshold: number,
  ): Promise<SimilarityThresholdResponse> {
    try {
      return await window.electronAPI.backend.setThreshold(threshold);
    } catch (error) {
      console.error("Failed to set similarity threshold:", error);
      throw error;
    }
  }

  /**
   * Clear the face database (via IPC)
   */
  async clearDatabase(): Promise<{ success: boolean; message: string }> {
    try {
      return await window.electronAPI.backend.clearDatabase();
    } catch (error) {
      console.error("Failed to clear database:", error);
      throw error;
    }
  }

  /**
   * Clear backend cache (liveness cache)
   */
  async clearCache(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${this.config.baseUrl}/recognize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image: "", // Empty image
          clear_cache: true,
          cache_duration: 0.0,
        }),
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      return {
        success: true,
        message: result.cache_cleared
          ? "Cache cleared successfully"
          : "Cache clear requested",
      };
    } catch (error) {
      console.error("Failed to clear cache:", error);
      return {
        success: false,
        message: `Failed to clear cache: ${error}`,
      };
    }
  }

  /**
   * Get database statistics (via IPC)
   */
  async getDatabaseStats(): Promise<DatabaseStatsResponse> {
    try {
      return await window.electronAPI.backend.getFaceStats();
    } catch (error) {
      console.error("Failed to get database stats:", error);
      throw error;
    }
  }

  // Private methods

  private handleMessage(data: IPCMessage): void {
    const messageType = data.type || "unknown";
    const handler = this.messageHandlers.get(messageType);
    if (handler) {
      handler(data);
    }

    // Always invoke the generic broadcast handler if registered
    const broadcastHandler = this.messageHandlers.get("*");
    if (broadcastHandler && messageType !== "*") {
      broadcastHandler(data);
    }
  }
}

// Singleton instance for global use
export const backendService = new BackendService();
