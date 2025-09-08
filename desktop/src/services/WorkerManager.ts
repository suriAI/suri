import '../types/global.d.ts';

interface DetectionResult {
  bbox: [number, number, number, number];
  confidence: number;
  landmarks: number[][];
  recognition?: {
    personId: string | null;
    similarity: number;
  };
}

interface WorkerMessage {
  type: string;
  data?: Record<string, unknown>;
}

interface WorkerResponse {
  type: string;
  data?: Record<string, unknown>;
  id?: number;
}

interface PendingMessage {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

export class WorkerManager {
  private worker: Worker | null = null;
  private isInitialized = false;
  private messageId = 0;
  private pendingMessages = new Map<number, PendingMessage>();

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Create the worker
    this.worker = new Worker(new URL('./FaceWorker.ts', import.meta.url), {
      type: 'module'
    });

    // Set up message handling
    this.worker.onmessage = (event) => {
      this.handleWorkerMessage(event.data);
    };

    this.worker.onerror = (error) => {
      console.error('Worker error:', error);
    };

    // Initialize the worker
    await this.sendMessage({ type: 'init' });
    
    // Load database from localStorage and send to worker
    await this.syncDatabaseToWorker();
    
    this.isInitialized = true;
  }

  private async syncDatabaseToWorker(): Promise<void> {
    try {
      // Load database from file via electron API
      let databaseData = {};
      if (window.electronAPI?.loadFaceDatabase) {
        const result = await window.electronAPI.loadFaceDatabase();
        if (result.success) {
          databaseData = result.data;
        } else {
          console.warn('Failed to load face database from file:', result.error);
        }
      } else {
        console.warn('ElectronAPI not available - running in browser mode');
      }
      
      // Send database to worker
      await this.sendMessage({
        type: 'load-database-from-main',
        data: { databaseData }
      });
    } catch (error) {
      console.error('Failed to sync database to worker:', error);
    }
  }

  private async syncDatabaseFromWorker(): Promise<void> {
    try {
      // Get database from worker
      const response = await this.sendMessage({
        type: 'get-database-for-main'
      });
      
      const { databaseData } = response as { databaseData: Record<string, number[]> };
      
      // Save to file via electron API
      if (window.electronAPI?.saveFaceDatabase) {
        const result = await window.electronAPI.saveFaceDatabase(databaseData);
        if (!result.success) {
          console.error('Failed to save face database to file:', result.error);
        }
      } else {
        console.warn('ElectronAPI not available - cannot save to file');
      }
    } catch (error) {
      console.error('Failed to sync database from worker:', error);
    }
  }

  async detect(imageData: ImageData): Promise<DetectionResult[]> {
    if (!this.isInitialized) {
      throw new Error('Worker manager not initialized');
    }

    const response = await this.sendMessage({
      type: 'detect',
      data: { imageData }
    });

    return (response.detections as DetectionResult[]) || [];
  }

  async detectFaces(imageData: ImageData): Promise<DetectionResult[]> {
    return this.detect(imageData);
  }

  async recognizeFace(imageData: ImageData, landmarks: number[][]): Promise<{ personId: string | null; similarity: number }> {
    if (!this.isInitialized) {
      throw new Error('Worker manager not initialized');
    }

    try {
      const response = await this.sendMessage({
        type: 'recognize-face',
        data: { imageData, landmarks }
      });

      return {
        personId: (response.personId as string) || null,
        similarity: (response.similarity as number) || 0
      };
    } catch (error) {
      console.error('Face recognition failed:', error);
      return { personId: null, similarity: 0 };
    }
  }

  async getAllPersons(): Promise<string[]> {
    if (!this.isInitialized) {
      throw new Error('Worker manager not initialized');
    }

    try {
      const response = await this.sendMessage({
        type: 'get-all-persons'
      });

      return (response.persons as string[]) || [];
    } catch (error) {
      console.error('Get all persons failed:', error);
      return [];
    }
  }

  /**
   * Public helper to reload the recognition database in the worker
   * from localStorage. Useful when another part of the app mutates
   * the stored database (e.g., deleting a person from SystemManagement).
   */
  async reloadDatabaseFromLocalStorage(): Promise<void> {
    if (!this.isInitialized) return;
    await this.syncDatabaseToWorker();
  }

  /**
   * Clear a specific person from the worker's memory and sync with localStorage
   */
  async clearPersonFromMemory(personId: string): Promise<boolean> {
    if (!this.isInitialized) return false;
    
    try {
      // Remove from worker's memory
      const success = await this.removePerson(personId);
      
      // Reload database to ensure sync
      await this.syncDatabaseToWorker();
      
      return success;
    } catch (error) {
      console.error('Failed to clear person from memory:', error);
      return false;
    }
  }

  /**
   * Clear all cached data in the worker (useful for memory cleanup)
   */
  async clearCache(): Promise<boolean> {
    if (!this.isInitialized) return false;
    
    try {
      const response = await this.sendMessage({
        type: 'clear-cache'
      });
      
      return (response.success as boolean) || false;
    } catch (error) {
      console.error('Failed to clear cache:', error);
      return false;
    }
  }

  async removePerson(personId: string): Promise<boolean> {
    if (!this.isInitialized) {
      throw new Error('Worker manager not initialized');
    }

    try {
      const response = await this.sendMessage({
        type: 'remove-person',
        data: { personId }
      });

      return (response.success as boolean) || false;
    } catch (error) {
      console.error('Remove person failed:', error);
      return false;
    }
  }

  async saveDatabase(): Promise<boolean> {
    if (!this.isInitialized) {
      throw new Error('Worker manager not initialized');
    }

    try {
      const response = await this.sendMessage({
        type: 'save-database'
      });

      return (response.success as boolean) || false;
    } catch (error) {
      console.error('Save database failed:', error);
      return false;
    }
  }

  async detectAndRecognizeFaces(imageData: ImageData): Promise<DetectionResult[]> {
    if (!this.isInitialized) {
      throw new Error('Worker manager not initialized');
    }

    const response = await this.sendMessage({
      type: 'detect-and-recognize',
      data: { imageData }
    });

    return (response.detections as DetectionResult[]) || [];
  }

  async loadDatabase(): Promise<boolean> {
    if (!this.isInitialized) {
      throw new Error('Worker manager not initialized');
    }

    try {
      const response = await this.sendMessage({
        type: 'load-database'
      });

      return (response.success as boolean) || false;
    } catch (error) {
      console.error('Load database failed:', error);
      return false;
    }
  }

  async registerPerson(personId: string, imageData: ImageData, landmarks: number[][]): Promise<boolean> {
    if (!this.isInitialized) {
      throw new Error('Worker manager not initialized');
    }

    const response = await this.sendMessage({
      type: 'register-person',
      data: { personId, imageData, landmarks }
    });

    return (response.success as boolean) || false;
  }

  async getStats(): Promise<{ totalPersons: number; threshold: number; embeddingDim: number }> {
    if (!this.isInitialized) {
      throw new Error('Worker manager not initialized');
    }

    const response = await this.sendMessage({
      type: 'get-stats'
    });

    const stats = response.stats as { totalPersons: number; threshold: number; embeddingDim: number } | undefined;
    return stats || { totalPersons: 0, threshold: 0.6, embeddingDim: 512 };
  }

  private sendMessage(message: WorkerMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not available'));
        return;
      }

      const id = this.messageId++;
      this.pendingMessages.set(id, { resolve, reject });

      // Add timeout for messages
      setTimeout(() => {
        if (this.pendingMessages.has(id)) {
          this.pendingMessages.delete(id);
          reject(new Error('Worker message timeout'));
        }
      }, 10000); // 10 second timeout

      this.worker.postMessage({ ...message, id });
    });
  }

  private handleWorkerMessage(message: WorkerResponse): void {
    const { type, data, id } = message;

    // Handle messages with IDs (responses to requests)
    if (id !== undefined && this.pendingMessages.has(id)) {
      const { resolve, reject } = this.pendingMessages.get(id)!;
      this.pendingMessages.delete(id);

      if (type === 'error') {
        const errorMessage = data && typeof data === 'object' && 'message' in data && typeof data.message === 'string' 
          ? data.message 
          : 'Unknown worker error';
        reject(new Error(errorMessage));
      } else {
        // Handle different response types by mapping them to expected formats
        let responseData = data || {};
        
        // Map worker response types to expected data formats
        if (type === 'detection-result' || type === 'detection-and-recognition-result') {
          responseData = data || {};
        } else if (type === 'registration-result' || type === 'register-result') {
          responseData = data || {};
        } else if (type === 'persons-list') {
          responseData = data || {};
        } else if (type === 'removal-result') {
          responseData = data || {};
        } else if (type === 'save-result') {
          responseData = data || {};
        } else if (type === 'load-result') {
          responseData = data || {};
        } else if (type === 'stats-result') {
          responseData = data || {};
        } else if (type === 'recognition-result') {
          responseData = data || {};
        } else if (type === 'database-export') {
          responseData = data || {};
        } else if (type === 'database-loaded') {
          responseData = data || {};
        } else if (type === 'cache-cleared') {
          responseData = data || {};
        }
        
        resolve(responseData);
      }
      return;
    }

    // Handle broadcast messages (without IDs)
    switch (type) {
      case 'database-changed': {
        this.syncDatabaseFromWorker().catch(console.error);
        break;
      }
      case 'error': {
        const errorMessage = data && typeof data === 'object' && 'message' in data && typeof data.message === 'string' 
          ? data.message 
          : 'Unknown worker error';
        console.error('Worker error:', errorMessage);
        break;
      }
    }
  }

  dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingMessages.clear();
    this.isInitialized = false;
  }
}
