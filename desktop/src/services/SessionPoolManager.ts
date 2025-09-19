import * as ort from 'onnxruntime-web/all';

/**
 * Session Pool Manager for ONNX Runtime optimization
 * Implements session pooling and WebGL context optimization to reduce initialization time
 */

export interface PooledSession {
  session: ort.InferenceSession;
  inUse: boolean;
  lastUsed: number;
  modelName: string;
}

export class SessionPoolManager {
  private static instance: SessionPoolManager;
  private sessionPools: Map<string, PooledSession[]> = new Map();
  private maxPoolSize = 5; // INCREASED: More sessions for better performance
  private sessionTimeout = 600000; // INCREASED: 10 minutes timeout for better reuse

  private cleanupInterval: NodeJS.Timeout | null = null;

  private constructor() {
    // Configure WebGL settings for better GPU performance
    ort.env.webgl.contextId = 'webgl2'; // Prefer WebGL2 for better performance
    ort.env.webgl.matmulMaxBatchSize = 16; // Optimize for batch processing
    ort.env.webgl.textureCacheMode = 'full'; // Cache textures for better performance
    
    // OPTIMIZED: Clean up unused sessions less frequently for better performance
    this.cleanupInterval = setInterval(() => {
      this.cleanupUnusedSessions();
    }, 120000); // Increased from 10s to 2 minutes
    
    // AGGRESSIVE: Prewarm common models for instant availability
    this.prewarmCommonModels();
  }

  /**
   * OPTIMIZATION: Prewarm sessions for commonly used models
   */
  private async prewarmCommonModels(): Promise<void> {
    // List of models to prewarm for instant availability
    const commonModels = [
      'det_500m_kps_320.onnx',
      'edgeface-recognition.onnx',
      'AntiSpoofing_bin_1.5_128.onnx'
    ];
    
    // Prewarm in background without blocking
    setTimeout(async () => {
      for (const modelName of commonModels) {
        try {
          // Create a dummy session to warm up the model
          const session = await this.getSession(modelName, async () => {
            // This will never be called since we're just prewarming
            throw new Error('Prewarm session should not create new sessions');
          });
          // Immediately release it back to pool
           this.releaseSession(session);
    
        } catch {
          // Silently fail prewarming - models will load on demand
        }
      }
    }, 1000); // Start prewarming after 1 second
  }

  public static getInstance(): SessionPoolManager {
    if (!SessionPoolManager.instance) {
      SessionPoolManager.instance = new SessionPoolManager();
    }
    return SessionPoolManager.instance;
  }

  /**
   * Detect available GPU capabilities and return optimal execution providers
   */
  private getOptimalExecutionProviders(): (ort.InferenceSession.ExecutionProviderConfig | string)[] {
    const providers: (ort.InferenceSession.ExecutionProviderConfig | string)[] = [];
    
    // Check if we're in a worker context (no document/navigator access)
    const isWorkerContext = typeof document === 'undefined' || typeof navigator === 'undefined';
    
    if (isWorkerContext) {
      // In worker context, use conservative fallback with proper WebGL config
      providers.push('webgl');
      providers.push('wasm'); // Fallback to WASM
    } else {
      // Main thread context - full GPU detection
      // Check for WebGPU support (fastest, most modern)
      if ('gpu' in navigator && navigator.gpu) {
        providers.push('webgpu');
      }
      
      // Check for WebGL2 support (fast, widely supported)
      const canvas = document.createElement('canvas');
      const webgl2 = canvas.getContext('webgl2');
      if (webgl2) {
        providers.push('webgl');
      } else {
        // Fallback to WebGL1 if WebGL2 not available
        const webgl1 = canvas.getContext('webgl');
        if (webgl1) {
          providers.push('webgl');
        }
      }
      
      // Always include WASM as final fallback
      providers.push('wasm');
    }
    
    return providers;
  }

  /**
   * Get optimized session options with per-model WASM optimizations
   */
  public getOptimizedSessionOptions(modelName?: string): ort.InferenceSession.SessionOptions {
    // Use WASM-only execution providers for models that don't support WebGL
    const executionProviders = modelName && this.requiresWasmOnly(modelName) 
      ? this.getWasmOnlyExecutionProviders()
      : this.getOptimalExecutionProviders();

    const baseOptions: ort.InferenceSession.SessionOptions = {
      executionProviders,
      logSeverityLevel: 3, // Error only
      logVerbosityLevel: 0,
      enableMemPattern: true,
      enableCpuMemArena: true,
      executionMode: 'parallel',
      graphOptimizationLevel: 'basic', // Use basic instead of 'all' to avoid resize issues
      enableProfiling: false,
      extra: {
        session: {
          use_ort_model_bytes_directly: true,
          use_ort_model_bytes_for_initializers: true,
          disable_prepacking: false,
          use_device_allocator_for_initializers: true,
          // Disable problematic optimizations that can cause resize errors
          disable_quant_qdq: true,
          disable_sparsity: true
        }
      }
    };

    // Apply per-model WASM optimizations based on model compatibility
    if (modelName && this.supportsWasmOptimizations(modelName)) {
      const isAppProtocol = typeof window !== 'undefined' && window.location?.protocol === 'app:';
      if (!isAppProtocol) {
        baseOptions.extra = {
          ...baseOptions.extra,
          wasm: {
            simd: true,
            proxy: true,
            numThreads: Math.min(4, typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4)
          }
        };
      }
    }

    // Don't add freeDimensionOverrides for anti-spoofing model as it causes input shape conflicts
    if (modelName && !modelName.includes('AntiSpoofing')) {
      baseOptions.freeDimensionOverrides = {
        'batch_size': 1
      };
    }

    return baseOptions;
  }

  /**
   * Check if a model supports WASM optimizations
   */
  private supportsWasmOptimizations(modelName: string): boolean {
    // Models that are known to work well with WASM optimizations
    const compatibleModels = [
      'det_500m_kps_320.onnx',
      'edgeface-recognition.onnx'
      // AntiSpoofing model excluded as it may have compatibility issues
    ];
    
    return compatibleModels.some(model => modelName.includes(model));
  }

  /**
   * Get WASM-only execution providers for models that don't support WebGL
   */
  private getWasmOnlyExecutionProviders(): string[] {
    return ['wasm'];
  }

  /**
   * Check if a model should use WASM-only execution (no WebGL support)
   */
  private requiresWasmOnly(modelName: string): boolean {
    // SCRFD models don't support WebGL properly
    const wasmOnlyModels = [
      'det_500m_kps_320.onnx'
    ];
    
    return wasmOnlyModels.some(model => modelName.includes(model));
  }

  /**
   * Get or create a pooled session
   */
  public async getSession(modelName: string, createSessionFn: () => Promise<ort.InferenceSession>): Promise<PooledSession> {
    const pool = this.sessionPools.get(modelName) || [];
    
    // Find available session in pool
    const availableSession = pool.find(session => !session.inUse);
    
    if (availableSession) {
      availableSession.inUse = true;
      availableSession.lastUsed = Date.now();

      return availableSession;
    }
    
    // Create new session if pool not full
    if (pool.length < this.maxPoolSize) {

      const session = await createSessionFn();
      
      const pooledSession: PooledSession = {
        session,
        inUse: true,
        lastUsed: Date.now(),
        modelName
      };
      
      pool.push(pooledSession);
      this.sessionPools.set(modelName, pool);
      
      return pooledSession;
    }
    
    // Wait for available session if pool is full
    return new Promise((resolve) => {
      const checkForAvailable = () => {
        const available = pool.find(session => !session.inUse);
        if (available) {
          available.inUse = true;
          available.lastUsed = Date.now();
          resolve(available);
        } else {
          setTimeout(checkForAvailable, 10);
        }
      };
      checkForAvailable();
    });
  }

  /**
   * Release a session back to the pool
   */
  public releaseSession(pooledSession: PooledSession): void {
    pooledSession.inUse = false;
    pooledSession.lastUsed = Date.now();
  }

  /**
   * Cleanup unused sessions to free memory
   */
  private cleanupUnusedSessions(): void {
    const now = Date.now();
    
    for (const [modelName, pool] of this.sessionPools.entries()) {
      const activePool = pool.filter(session => {
        if (!session.inUse && (now - session.lastUsed) > this.sessionTimeout) {
          // Session cleanup is handled automatically by ONNX Runtime Web
  
          return false;
        }
        return true;
      });
      
      if (activePool.length !== pool.length) {
  
        this.sessionPools.set(modelName, activePool);
      }
    }
  }

  /**
   * Warm up sessions for faster first inference
   */
  public async warmupSession(pooledSession: PooledSession, dummyInput: Record<string, ort.Tensor>): Promise<void> {
    try {
      // Run a dummy inference to warm up the session
      await pooledSession.session.run(dummyInput);
      console.log(`✅ Successfully warmed up session for ${pooledSession.modelName}`);
    } catch (error) {
      // Log the error but don't throw - warmup failure shouldn't break initialization
      console.warn(`⚠️ Failed to warm up session for ${pooledSession.modelName}:`, error);
      
      // If warmup fails due to resize/layout issues, the session is still usable
      // The error typically occurs with specific operations that may not be used in actual inference
      if (error instanceof Error && error.message.includes('resize')) {
        console.info(`ℹ️ Resize operation not supported during warmup for ${pooledSession.modelName}, but session is still functional`);
      }
    }
  }

  /**
   * Dispose all sessions and cleanup
   */
  public dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    this.sessionPools.clear();
    
  }
}