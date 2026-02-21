import type { FaceRecognitionResponse } from "../../types/recognition.js";

export interface ModelInfo {
  model_name?: string;
  model_path: string;
  input_size: number[] | [number, number];
  conf_threshold?: number;
  nms_threshold?: number;
  top_k?: number;
  backend_id?: number;
  target_id?: number;
  embedding_dimension?: number;
  similarity_threshold?: number;
  providers?: string[];
  description?: string;
  version?: string;
  supported_formats?: string[];
}

export interface ModelEntry {
  available: boolean;
  info?: ModelInfo;
}

export interface ModelsResponse {
  models: {
    face_detector?: ModelEntry;
    liveness_detector?: ModelEntry;
    face_recognizer?: ModelEntry;
  };
}

export interface DetectionOptions {
  model_type?: string;
  confidence_threshold?: number;
  nms_threshold?: number;
}

export interface DetectionResponse {
  faces: Array<{
    bbox: [number, number, number, number];
    confidence: number;
    landmarks_5?: number[][];
  }>;
  model_used: string;
}

export class BackendClient {
  private getBaseUrl: () => string;

  constructor(getBaseUrl: () => string) {
    this.getBaseUrl = getBaseUrl;
  }

  private getUrl(path: string): string {
    return `${this.getBaseUrl()}${path}`;
  }

  async checkAvailability(): Promise<{
    available: boolean;
    status?: number;
    error?: string;
  }> {
    try {
      const response = await fetch(this.getUrl("/"), {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return { available: response.ok, status: response.status };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getModels(): Promise<ModelsResponse> {
    const response = await fetch(this.getUrl("/models"), {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok)
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return await response.json();
  }

  async detectFaces(
    imageBase64: string,
    options: DetectionOptions = {},
  ): Promise<DetectionResponse> {
    const request = {
      image: imageBase64,
      model_type: options.model_type || "face_detector",
      confidence_threshold: options.confidence_threshold || 0.5,
      nms_threshold: options.nms_threshold || 0.3,
    };

    const response = await fetch(this.getUrl("/detect"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok)
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return await response.json();
  }

  async recognizeFace(
    imageBase64: string,
    bbox: number[],
    groupId: string,
    landmarks_5: number[][],
    enableLivenessDetection: boolean,
  ): Promise<FaceRecognitionResponse> {
    const request = {
      image: imageBase64,
      bbox,
      group_id: groupId,
      landmarks_5,
      enable_liveness_detection: enableLivenessDetection,
    };

    const response = await fetch(this.getUrl("/face/recognize"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok)
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return await response.json();
  }

  // Helper method for health check status
  async checkReadiness(
    isRunning: boolean,
  ): Promise<{ ready: boolean; modelsLoaded: boolean; error?: string }> {
    try {
      if (!isRunning)
        return {
          ready: false,
          modelsLoaded: false,
          error: "Backend service not started",
        };

      const health = await this.checkAvailability();
      if (!health.available)
        return {
          ready: false,
          modelsLoaded: false,
          error: "Backend health check failed",
        };

      const modelsData = await this.getModels();
      const faceDetectorAvailable =
        modelsData.models.face_detector?.available || false;
      const faceRecognizerAvailable =
        modelsData.models.face_recognizer?.available || false;
      const modelsLoaded = faceDetectorAvailable && faceRecognizerAvailable;

      return {
        ready: modelsLoaded,
        modelsLoaded,
        error: modelsLoaded
          ? undefined
          : "Face recognition models not fully loaded",
      };
    } catch (error) {
      return {
        ready: false,
        modelsLoaded: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
