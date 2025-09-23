/**
 * Backend Service for integrating with FastAPI face detection backend
 * Provides HTTP and WebSocket communication with the Python backend
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
  }>;
  model_used: string;
  processing_time: number;
  session_id?: string;
}

interface BackendConfig {
  baseUrl: string;
  wsUrl: string;
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

interface WebSocketMessage {
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
    antispoofing?: {
      is_real?: boolean | null;
      confidence?: number;
      status?: 'real' | 'fake' | 'error';
    };
  }>;
  model_used?: string;
  processing_time?: number;
  [key: string]: unknown;
}

export class BackendService {
  private config: BackendConfig;
  private websocket: WebSocket | null = null;
  private clientId: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second
  private messageHandlers: Map<string, (data: WebSocketMessage) => void> = new Map();
  private isConnecting = false;

  constructor(config?: Partial<BackendConfig>) {
    this.config = {
      baseUrl: 'http://127.0.0.1:8700',
    wsUrl: 'ws://127.0.0.1:8700',
      timeout: 30000,
      retryAttempts: 3,
      ...config
    };
    
    this.clientId = `electron_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
    } catch (error) {
      console.warn('Backend not available:', error);
      return false;
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
   * Connect to WebSocket for real-time detection
   */
  async connectWebSocket(): Promise<void> {
    if (this.websocket?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    this.isConnecting = true;

    try {
      const wsUrl = `${this.config.wsUrl}/ws/${this.clientId}`;
      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = () => {
        console.log('✅ WebSocket connected to backend');
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
      };

      this.websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleWebSocketMessage(data);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      this.websocket.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason);
        this.isConnecting = false;
        this.websocket = null;
        
        // Auto-reconnect if not a clean close
        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      };

      this.websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.isConnecting = false;
      };

    } catch (error) {
      this.isConnecting = false;
      console.error('Failed to connect WebSocket:', error);
      throw error;
    }
  }

  /**
   * Send detection request via WebSocket
   */
  async sendDetectionRequest(
    imageData: ImageData | string,
    options: {
      model_type?: string;
      confidence_threshold?: number;
      nms_threshold?: number;
      enable_antispoofing?: boolean;
    } = {}
  ): Promise<void> {
    if (!this.isWebSocketReady()) {
      throw new Error('WebSocket not connected or not ready');
    }

    let imageBase64: string;
    if (typeof imageData === 'string') {
      imageBase64 = imageData;
    } else {
      imageBase64 = await this.imageDataToBase64(imageData);
    }

    const message = {
      type: 'detection_request',
      image: imageBase64,
      model_type: options.model_type || 'yunet',
      confidence_threshold: options.confidence_threshold || 0.5,
      nms_threshold: options.nms_threshold || 0.3,
      enable_antispoofing: options.enable_antispoofing !== undefined ? options.enable_antispoofing : true
    };

    this.websocket!.send(JSON.stringify(message));
  }

  /**
   * Send ping to keep connection alive
   */
  ping(): void {
    if (this.isWebSocketReady()) {
      this.websocket!.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
    }
  }

  /**
   * Register message handler for WebSocket responses
   */
  onMessage(type: string, handler: (data: WebSocketMessage) => void): void {
    this.messageHandlers.set(type, handler);
  }

  /**
   * Remove message handler
   */
  offMessage(type: string): void {
    this.messageHandlers.delete(type);
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    if (this.websocket) {
      this.websocket.close(1000, 'Client disconnect');
      this.websocket = null;
    }
    this.messageHandlers.clear();
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
      http: true, // HTTP is stateless, assume available
      websocket: this.websocket?.readyState === WebSocket.OPEN,
      clientId: this.clientId
    };
  }

  /**
   * Get WebSocket status string for UI display
   */
  getWebSocketStatus(): 'disconnected' | 'connecting' | 'connected' {
    if (!this.websocket) {
      return 'disconnected';
    }
    
    switch (this.websocket.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting';
      case WebSocket.OPEN:
        return 'connected';
      case WebSocket.CLOSING:
      case WebSocket.CLOSED:
      default:
        return 'disconnected';
    }
  }

  /**
   * Check if WebSocket is ready for sending messages
   */
  isWebSocketReady(): boolean {
    return this.websocket?.readyState === WebSocket.OPEN;
  }

  // Face Recognition Methods

  /**
   * Recognize a face from image data
   */
  async recognizeFace(
    imageData: ImageData | string,
    landmarks?: number[][]
  ): Promise<FaceRecognitionResponse> {
    try {
      const base64Image = typeof imageData === 'string' 
        ? imageData 
        : await this.imageDataToBase64(imageData);

      const requestBody = {
        image: base64Image,
        landmarks: landmarks
      };

      const response = await fetch(`${this.config.baseUrl}/face/recognize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.config.timeout)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Face recognition failed:', error);
      throw error;
    }
  }

  /**
   * Register a new face with person ID
   */
  async registerFace(
    imageData: ImageData | string,
    personId: string,
    landmarks?: number[][]
  ): Promise<FaceRegistrationResponse> {
    try {
      const base64Image = typeof imageData === 'string' 
        ? imageData 
        : await this.imageDataToBase64(imageData);

      const requestBody = {
        image: base64Image,
        person_id: personId,
        landmarks: landmarks
      };

      const response = await fetch(`${this.config.baseUrl}/face/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.config.timeout)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Face registration failed:', error);
      throw error;
    }
  }

  /**
   * Remove a person from the database
   */
  async removePerson(personId: string): Promise<RemovalResult> {
    try {
      const response = await fetch(`${this.config.baseUrl}/face/person/${encodeURIComponent(personId)}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(this.config.timeout)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Person removal failed:', error);
      throw error;
    }
  }

  async updatePerson(oldPersonId: string, newPersonId: string): Promise<UpdateResult> {
    try {
      const requestBody = {
        old_person_id: oldPersonId,
        new_person_id: newPersonId
      };

      const response = await fetch(`${this.config.baseUrl}/face/person`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.config.timeout)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Person update failed:', error);
      throw error;
    }
  }

  /**
   * Get all registered persons
   */
  async getAllPersons(): Promise<PersonInfo[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/face/persons`, {
        method: 'GET',
        signal: AbortSignal.timeout(this.config.timeout)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to get persons:', error);
      throw error;
    }
  }

  /**
   * Set similarity threshold for recognition
   */
  async setSimilarityThreshold(threshold: number): Promise<ThresholdResult> {
    try {
      const requestBody = {
        threshold: threshold
      };

      const response = await fetch(`${this.config.baseUrl}/face/threshold`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.config.timeout)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to set similarity threshold:', error);
      throw error;
    }
  }

  /**
   * Clear the face database
   */
  async clearDatabase(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${this.config.baseUrl}/face/database`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(this.config.timeout)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to clear database:', error);
      throw error;
    }
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats(): Promise<DatabaseStatsResponse> {
    try {
      const response = await fetch(`${this.config.baseUrl}/face/stats`, {
        method: 'GET',
        signal: AbortSignal.timeout(this.config.timeout)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to get database stats:', error);
      throw error;
    }
  }

  // Private methods

  private handleWebSocketMessage(data: WebSocketMessage): void {
    const messageType = data.type || 'unknown';
    const handler = this.messageHandlers.get(messageType);
    if (handler) {
      handler(data);
    } else {
      console.log('Unhandled WebSocket message:', messageType, data);
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    console.log(`Scheduling WebSocket reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectDelay}ms`);
    
    setTimeout(() => {
      this.connectWebSocket().catch(error => {
        console.error('Reconnect failed:', error);
      });
    }, this.reconnectDelay);
    
    // Exponential backoff with max delay of 30 seconds
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
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