import { BackendProcessManager, type BackendConfig, type BackendStatus } from "./backend/BackendProcessManager.js";
import { BackendClient, type ModelsResponse, type DetectionOptions, type DetectionResponse } from "./backend/BackendClient.js";
import type { FaceRecognitionResponse } from "../types/recognition.js";

export type { BackendConfig, BackendStatus, ModelsResponse, DetectionOptions, DetectionResponse };

export class BackendService {
  private config: BackendConfig;
  private status: BackendStatus;
  private processManager: BackendProcessManager;
  private client: BackendClient;

  constructor(config: Partial<BackendConfig> = {}) {
    this.config = {
      port: 8700,
      host: "127.0.0.1",
      timeout: 120000,
      maxRetries: 3,
      healthCheckInterval: 10000,
      ...config,
    };

    this.status = {
      isRunning: false,
      port: this.config.port,
    };

    this.processManager = new BackendProcessManager(this.config, this.status);
    this.client = new BackendClient(() => this.getUrl());
  }

  // Lifecycle
  async start(): Promise<void> {
    return this.processManager.start();
  }

  async stop(): Promise<void> {
    return this.processManager.stop();
  }

  async restart(): Promise<void> {
    await this.stop();
    // Small delay to ensure cleanup
    await new Promise(r => setTimeout(r, 100));
    return this.start();
  }

  killSync(): void {
    this.processManager.killSync();
  }

  // Status & Info
  getStatus(): BackendStatus {
    return this.processManager.getStatus();
  }

  getUrl(): string {
    return this.processManager.getUrl();
  }

  async isAvailable(): Promise<boolean> {
    if (!this.status.isRunning) return false;
    const health = await this.client.checkAvailability();
    return health.available;
  }

  // API Client Methods (Delegated to BackendClient)
  async checkAvailability() {
    return this.client.checkAvailability();
  }

  async checkReadiness() {
    return this.client.checkReadiness(this.status.isRunning);
  }

  async getModels(): Promise<ModelsResponse> {
    return this.client.getModels();
  }

  async detectFaces(imageBase64: string, options: DetectionOptions = {}): Promise<DetectionResponse> {
    return this.client.detectFaces(imageBase64, options);
  }

  async recognizeFace(
    imageBase64: string,
    bbox: number[],
    groupId: string,
    landmarks_5: number[][],
    enableLivenessDetection: boolean,
  ): Promise<FaceRecognitionResponse> {
    return this.client.recognizeFace(imageBase64, bbox, groupId, landmarks_5, enableLivenessDetection);
  }
}

export const backendService = new BackendService();
