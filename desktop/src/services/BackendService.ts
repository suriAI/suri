/// <reference types="../types/global.d.ts" />

/**
 * Backend Service for integrating with FastAPI face detection backend
 * Uses IPC for fast, zero-overhead communication with Python backend
 */

interface DetectionRequest {
  image: string; // base64 encoded image
  model_type?: string;
  confidence_threshold?: number;
  nms_threshold?: number;
}

interface DetectionResponse {
  faces: Array<{
    bbox: [number, number, number, number];
    confidence: number;
    landmarks: number[][];
    landmarks_468?: number[][]; // FaceMesh 468 landmarks for frontend visualization
  }>;
  model_used: string;
  processing_time: number;
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

interface FaceRecognitionResponse {
  success: boolean;
  person_id?: string;
  similarity?: number;
  processing_time: number;
  error?: string;
}

interface FaceRegistrationResponse {
  success: boolean;
  person_id: string;
  processing_time: number;
  error?: string;
  total_persons?: number;
}

interface RemovalResult {
  success: boolean;
  message: string;
}

interface UpdateResult {
  success: boolean;
  message: string;
  updated_records: number;
}

export interface PersonInfo {
  person_id: string;
  embedding_count: number;
  last_seen?: string;
}

interface ThresholdResult {
  success: boolean;
  message: string;
  threshold: number;
}

interface DatabaseStatsResponse {
  total_persons: number;
  total_embeddings: number;
  persons: PersonInfo[];
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
    landmarks?: number[][];
    landmarks_468?: number[][];
    antispoofing?: {
      is_real?: boolean | null;
      live_score?: number;
      spoof_score?: number;
      confidence?: number;
      status?: 'real' | 'fake' | 'error';
      label?: string;
    };
    track_id?: number;
  }>;
  model_used?: string;
  processing_time?: number;
  [key: string]: unknown;
}

export class BackendService {
  private config: BackendConfig;
  private clientId: string;
  private messageHandlers: Map<string, (data: IPCMessage) => void> = new Map();
  private isProcessing = false;

  constructor(config?: Partial<BackendConfig>) {
    this.config = {
      baseUrl: 'http://127.0.0.1:8700',
      timeout: 30000,
      retryAttempts: 3,
      ...config
    };
    
    this.clientId = `ipc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log('[BackendService] IPC mode enabled - Fast processing, zero overhead');
  }

  /**
   * Check if the backend is available
   */
  async isBackendAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check if the backend is ready for face recognition (models loaded)
   */
  async checkReadiness(): Promise<{ ready: boolean; modelsLoaded: boolean; error?: string }> {
    try {
      // First check if backend is available
      const isAvailable = await this.isBackendAvailable();
      if (!isAvailable) {
        return { ready: false, modelsLoaded: false, error: 'Backend not available' };
      }

      // Check if critical models are loaded
      const models = await this.getAvailableModels();
      const requiredModels = ['yunet', 'edgeface'];
      const loadedModels = Object.keys(models).filter(key => 
        requiredModels.some(required => key.toLowerCase().includes(required.toLowerCase()))
      );

      const modelsLoaded = loadedModels.length >= requiredModels.length;
      
      return {
        ready: modelsLoaded,
        modelsLoaded,
        error: modelsLoaded ? undefined : 'Required face recognition models not loaded'
      };
    } catch (error) {
      console.error('Failed to check backend readiness:', error);
      return {
        ready: false,
        modelsLoaded: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get available models from the backend
   */
  async getAvailableModels(): Promise<Record<string, ModelInfo>> {
    try {
      const response = await fetch(`${this.config.baseUrl}/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(this.config.timeout)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Failed to get available models:', error);
      throw error;
    }
  }

  /**
   * Detect faces using HTTP API
   */
  async detectFaces(
    imageData: ImageData | string,
    options: {
      model_type?: string;
      confidence_threshold?: number;
      nms_threshold?: number;
    } = {}
  ): Promise<DetectionResponse> {
    try {
      let imageBase64: string;
      
      if (typeof imageData === 'string') {
        imageBase64 = imageData;
      } else {
        imageBase64 = await this.imageDataToBase64(imageData);
      }

      const request: DetectionRequest = {
        image: imageBase64,
        model_type: options.model_type || 'yunet',
        confidence_threshold: options.confidence_threshold || 0.5,
        nms_threshold: options.nms_threshold || 0.3
      };

      const response = await fetch(`${this.config.baseUrl}/detect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.config.timeout)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Face detection failed:', error);
      throw error;
    }
  }

  /**
   * Detect faces using file upload
   */
  async detectFacesFromFile(
    file: File,
    options: {
      model_type?: string;
      confidence_threshold?: number;
      nms_threshold?: number;
    } = {}
  ): Promise<DetectionResponse> {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('model_type', options.model_type || 'yunet');
      formData.append('confidence_threshold', (options.confidence_threshold || 0.5).toString());
      formData.append('nms_threshold', (options.nms_threshold || 0.3).toString());

      const response = await fetch(`${this.config.baseUrl}/detect/upload`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(this.config.timeout)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('File upload detection failed:', error);
      throw error;
    }
  }

  /**
   * Connect to IPC (instant connection, no setup needed)
   */
  async connectWebSocket(): Promise<void> {
    console.log('[BackendService] IPC connection ready (instant, no overhead)');
    
    // Send connection message to handlers
    setTimeout(() => {
      this.handleMessage({
        type: 'connection',
        status: 'connected',
        client_id: this.clientId,
        timestamp: Date.now()
      });
    }, 50);
  }

  /**
   * Send detection request via IPC (fast, zero overhead)
   */
  async sendDetectionRequest(
    imageData: ImageData | string | ArrayBuffer,
    options: {
      model_type?: string;
      nms_threshold?: number;
      enable_antispoofing?: boolean;
      frame_timestamp?: number;
    } = {}
  ): Promise<void> {
    // Skip if already processing (prevent queue buildup)
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      let imageToSend: ArrayBuffer | string;

      // Handle different image data types
      if (imageData instanceof ArrayBuffer) {
        imageToSend = imageData;
      } else if (typeof imageData === 'string') {
        imageToSend = imageData;
      } else {
        // Convert ImageData to base64
        imageToSend = await this.imageDataToBase64(imageData);
      }

      // Send via IPC
      const result = await window.electronAPI.backend.detectStream(imageToSend, {
        model_type: options.model_type || 'yunet',
        nms_threshold: options.nms_threshold || 0.3,
        enable_antispoofing: options.enable_antispoofing !== undefined ? options.enable_antispoofing : true,
        frame_timestamp: options.frame_timestamp || Date.now()
      });

      // Trigger message handlers with result
      this.handleMessage(result as IPCMessage);

    } catch (error) {
      console.error('[BackendService] IPC detection failed:', error);
      
      // Send error to handlers
      this.handleMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Send ping (no-op for IPC, always connected)
   */
  ping(): void {
    // IPC is always connected, no ping needed
  }

  /**
   * Register message handler for IPC responses
   */
  onMessage(type: string, handler: (data: IPCMessage) => void): void {
    this.messageHandlers.set(type, handler);
  }

  /**
   * Remove message handler
   */
  offMessage(type: string): void {
    this.messageHandlers.delete(type);
  }

  /**
   * Disconnect (lightweight cleanup for IPC restart)
   * NOTE: We DON'T clear message handlers because they need to persist for restart
   */
  disconnect(): void {
    // For IPC mode, we keep handlers alive for instant reconnection
    // No cleanup needed - handlers will be reused on next connect
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): {
    http: boolean;
    websocket: boolean;
    clientId: string;
  } {
    return {
      http: true,
      websocket: true, // IPC is always "connected"
      clientId: this.clientId
    };
  }

  /**
   * Get connection status string
   */
  getWebSocketStatus(): 'disconnected' | 'connecting' | 'connected' {
    return 'connected'; // IPC is always connected
  }

  /**
   * Check if ready for sending messages
   */
  isWebSocketReady(): boolean {
    return true; // IPC is always ready
  }

  // Face Recognition Methods

  /**
   * Recognize a face from image data (via IPC)
   */
  async recognizeFace(
    imageData: ImageData | string | ArrayBuffer,
    bbox?: number[],
    groupId?: string
  ): Promise<FaceRecognitionResponse> {
    try {
      let base64Image: string;
      if (typeof imageData === 'string') {
        base64Image = imageData;
      } else if (imageData instanceof ArrayBuffer) {
        // Convert ArrayBuffer to Base64
        const blob = new Blob([imageData], { type: 'image/jpeg' });
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        base64Image = dataUrl.split(',')[1];
      } else {
        base64Image = await this.imageDataToBase64(imageData);
      }

      return await window.electronAPI.backend.recognizeFace(base64Image, bbox || [], groupId);
    } catch (error) {
      console.error('Face recognition failed:', error);
      throw error;
    }
  }

  /**
   * Register a new face with person ID (via IPC)
   */
  async registerFace(
    imageData: ImageData | string,
    personId: string,
    bbox?: number[],
    groupId?: string
  ): Promise<FaceRegistrationResponse> {
    try {
      const base64Image = typeof imageData === 'string' 
        ? imageData 
        : await this.imageDataToBase64(imageData);

      return await window.electronAPI.backend.registerFace(base64Image, personId, bbox || [], groupId);
    } catch (error) {
      console.error('Face registration failed:', error);
      throw error;
    }
  }

  /**
   * Remove a person from the database (via IPC)
   */
  async removePerson(personId: string): Promise<RemovalResult> {
    try {
      return await window.electronAPI.backend.removePerson(personId);
    } catch (error) {
      console.error('Person removal failed:', error);
      throw error;
    }
  }

  /**
   * Update person ID (via IPC)
   */
  async updatePerson(oldPersonId: string, newPersonId: string): Promise<UpdateResult> {
    try {
      return await window.electronAPI.backend.updatePerson(oldPersonId, newPersonId);
    } catch (error) {
      console.error('Person update failed:', error);
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
      console.error('Failed to get persons:', error);
      throw error;
    }
  }

  /**
   * Set similarity threshold for recognition (via IPC)
   */
  async setSimilarityThreshold(threshold: number): Promise<ThresholdResult> {
    try {
      return await window.electronAPI.backend.setThreshold(threshold);
    } catch (error) {
      console.error('Failed to set similarity threshold:', error);
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
      console.error('Failed to clear database:', error);
      throw error;
    }
  }

  /**
   * Clear backend cache (antispoofing cache)
   */
  async clearCache(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${this.config.baseUrl}/recognize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: '', // Empty image
          clear_cache: true,
          cache_duration: 0.0
        }),
        signal: AbortSignal.timeout(this.config.timeout)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      return {
        success: true,
        message: result.cache_cleared ? 'Cache cleared successfully' : 'Cache clear requested'
      };
    } catch (error) {
      console.error('Failed to clear cache:', error);
      return {
        success: false,
        message: `Failed to clear cache: ${error}`
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
      console.error('Failed to get database stats:', error);
      throw error;
    }
  }

  // Private methods

  private handleMessage(data: IPCMessage): void {
    const messageType = data.type || 'unknown';
    const handler = this.messageHandlers.get(messageType);
    if (handler) {
      handler(data);
    }
    
    // Always invoke the generic broadcast handler if registered
    const broadcastHandler = this.messageHandlers.get('*');
    if (broadcastHandler && messageType !== '*') {
      broadcastHandler(data);
    }
  }

  private async imageDataToBase64(imageData: ImageData): Promise<string> {
    // Validate ImageData dimensions
    if (!imageData || typeof imageData.width !== 'number' || typeof imageData.height !== 'number' || 
        imageData.width <= 0 || imageData.height <= 0) {
      throw new Error('Invalid ImageData: width and height must be positive numbers');
    }

    // Create a canvas to convert ImageData to base64
    const canvas = new OffscreenCanvas(imageData.width, imageData.height);
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(imageData, 0, 0);
    
    // Convert to blob and then to base64
    return new Promise<string>((resolve, reject) => {
      canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
        .then(blob => {
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1];
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        })
        .catch(reject);
    });
  }
}

// Singleton instance for global use
export const backendService = new BackendService();
