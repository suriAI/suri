import { WorkerManager } from './WorkerManager.js';
import { WebAntiSpoofingService } from './WebAntiSpoofingService.js';

export interface WorkerPoolStats {
  totalPersons: number;
}

export interface GlobalWorkerPoolState {
  isInitialized: boolean;
  isInitializing: boolean;
  error: string | null;
  workerManager: WorkerManager | null;
  antiSpoofingService: WebAntiSpoofingService | null;
  stats: WorkerPoolStats | null;
}

class GlobalWorkerPoolManager {
  private state: GlobalWorkerPoolState = {
    isInitialized: false,
    isInitializing: false,
    error: null,
    workerManager: null,
    antiSpoofingService: null,
    stats: null
  };

  private listeners: Set<(state: GlobalWorkerPoolState) => void> = new Set();

  /**
   * Subscribe to worker pool state changes
   */
  subscribe(listener: (state: GlobalWorkerPoolState) => void): () => void {
    this.listeners.add(listener);
    // Immediately call with current state
    listener(this.getState());
    
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Get current worker pool state
   */
  getState(): GlobalWorkerPoolState {
    return { ...this.state };
  }

  /**
   * Initialize worker pool in background
   */
  async initializeInBackground(): Promise<void> {
    if (this.state.isInitialized || this.state.isInitializing) {
      return;
    }

    this.updateState({
      isInitializing: true,
      error: null
    });

    try {
      console.log('🚀 Starting background worker pool initialization...');
      
      // Create and initialize worker manager
      const workerManager = new WorkerManager();
      await workerManager.initialize();
      console.log('✅ Worker manager initialized');

      // Initialize anti-spoofing service
      const antiSpoofingService = new WebAntiSpoofingService();
      await antiSpoofingService.initialize();
      console.log('✅ Anti-spoofing service initialized');

      // Get initial stats
      const stats = await workerManager.getStats();
      console.log('✅ Stats loaded:', stats);

      this.updateState({
        isInitialized: true,
        isInitializing: false,
        workerManager,
        antiSpoofingService,
        stats,
        error: null
      });

      console.log('🎉 Background worker pool initialization complete!');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Background worker pool initialization failed:', errorMessage);
      
      this.updateState({
        isInitialized: false,
        isInitializing: false,
        error: errorMessage
      });
      
      throw error;
    }
  }

  /**
   * Get initialized worker manager (throws if not ready)
   */
  getWorkerManager(): WorkerManager {
    if (!this.state.isInitialized || !this.state.workerManager) {
      throw new Error('Worker pool not initialized');
    }
    return this.state.workerManager;
  }

  /**
   * Get initialized anti-spoofing service (throws if not ready)
   */
  getAntiSpoofingService(): WebAntiSpoofingService {
    if (!this.state.isInitialized || !this.state.antiSpoofingService) {
      throw new Error('Anti-spoofing service not initialized');
    }
    return this.state.antiSpoofingService;
  }

  /**
   * Get worker pool stats
   */
  getStats(): WorkerPoolStats | null {
    return this.state.stats;
  }

  /**
   * Check if worker pool is ready for immediate use
   */
  isReady(): boolean {
    return this.state.isInitialized && !this.state.error;
  }

  /**
   * Reset worker pool (for cleanup)
   */
  reset(): void {
    // Clean up existing resources
    if (this.state.workerManager) {
      // WorkerManager cleanup would go here if it has a cleanup method
    }
    
    if (this.state.antiSpoofingService) {
      // WebAntiSpoofingService cleanup would go here if it has a cleanup method
    }

    this.updateState({
      isInitialized: false,
      isInitializing: false,
      error: null,
      workerManager: null,
      antiSpoofingService: null,
      stats: null
    });
  }

  private updateState(updates: Partial<GlobalWorkerPoolState>): void {
    this.state = { ...this.state, ...updates };
    this.notifyListeners();
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.getState());
      } catch (error) {
        console.error('Error in worker pool state listener:', error);
      }
    });
  }
}

// Export singleton instance
export const globalWorkerPool = new GlobalWorkerPoolManager();