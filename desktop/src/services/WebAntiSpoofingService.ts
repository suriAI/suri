import * as ort from 'onnxruntime-web/all';
import { SessionPoolManager, type PooledSession } from './SessionPoolManager.js';
export interface AntiSpoofingResult {
  isLive: boolean;
  confidence: number;
  score: number; // Raw model output score
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class WebAntiSpoofingService {
  private pooledSession: PooledSession | null = null;
  private sessionPool: SessionPoolManager;
  private threshold: number = 0.5; // Real face probability threshold

  // Model specs
  private readonly INPUT_SIZE = 128;

  private frameCount = 0;

  constructor() {
    this.sessionPool = SessionPoolManager.getInstance();
  }

  /**
   * Initialize the ONNX model
   */
  async initialize(preloadedBuffer?: ArrayBuffer): Promise<void> {
    // Detect environment safely (works in both browser and worker contexts)
    const isDev = (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') || 
                  (typeof window !== 'undefined' && window.location.hostname === 'localhost');
    
    const modelName = 'AntiSpoofing_bin_1.5_128.onnx';
    console.log(`📥 Loading AntiSpoofing model: ${modelName} (${isDev ? 'development' : 'production'} mode)`);
    
    try {
      // Use SessionPoolManager with ArrayBuffer loading like other models
      this.pooledSession = await this.sessionPool.getSession(
        modelName,
        async () => {
          let modelBuffer: ArrayBuffer;
          
          if (preloadedBuffer) {
            modelBuffer = preloadedBuffer;
            console.log('📦 Using preloaded buffer for anti-spoofing model');
          } else {
            if (isDev) {
              // Dev mode - use fetch from public folder
              const response = await fetch('/weights/AntiSpoofing_bin_1.5_128.onnx');
              if (!response.ok) {
                throw new Error(`Failed to fetch model: ${response.status} ${response.statusText}`);
              }
              modelBuffer = await response.arrayBuffer();
            } else {
              // Production mode - no fallback, should use preloaded buffer
              throw new Error('Anti-spoofing model not available through optimized loading paths');
            }
            console.log(`📦 Model buffer loaded: ${(modelBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
          }
          
          // Use WASM-only execution for anti-spoofing model (WebGL not supported)
          const options: ort.InferenceSession.SessionOptions = {
            executionProviders: ['wasm'],  // Anti-spoofing model only supports WASM
            logSeverityLevel: 4,  // Minimal logging (4 = ERROR only)
            logVerbosityLevel: 0, // No verbose logs
            enableCpuMemArena: true,
            enableMemPattern: true,
            executionMode: 'parallel',  // Use parallel execution
            graphOptimizationLevel: 'extended',  // More aggressive optimization
            enableProfiling: false,
            extra: {
              session: {
                use_device_allocator_for_initializers: 1,
                use_ort_model_bytes_directly: 1
              }
            }
            // NO freeDimensionOverrides - this was causing the input shape conflict!
          };
          
          console.log('🔧 Using direct session options for anti-spoofing model (no freeDimensionOverrides)');
          
          // Create session with WASM-only execution (no fallback needed)
          return await ort.InferenceSession.create(modelBuffer, options);
        }
      );
      
      // Warm up the session with dummy input for faster first inference
      const dummyInput = {
        [this.pooledSession.session.inputNames[0]]: new ort.Tensor('float32', new Float32Array(3 * this.INPUT_SIZE * this.INPUT_SIZE), [1, 3, this.INPUT_SIZE, this.INPUT_SIZE])
      };
      await this.sessionPool.warmupSession(this.pooledSession, dummyInput);

      console.log('✅ Anti-spoofing model loaded successfully with SessionPoolManager');
      console.log('📊 Input names:', this.pooledSession.session.inputNames);
      console.log('📊 Output names:', this.pooledSession.session.outputNames);
    } catch (err) {
      console.error('❌ Failed to load anti-spoofing model:', err);
      throw new Error(`Anti-spoofing model initialization failed: ${err}`);
    }
  }

  /**
   * Detect if a face is live or spoofed
   * @param faceImageData - ImageData of the cropped face (should be square-ish)
   * @param bbox - Optional bounding box for increased cropping
   */
  async detectLiveness(
    faceImageData: ImageData,
    bbox?: BoundingBox,
    bboxInc: number = 1.5
  ): Promise<AntiSpoofingResult> {
    if (!this.pooledSession?.session) {
      throw new Error('Anti-spoofing model not initialized');
    }

    // Input validation
    if (!faceImageData || !faceImageData.data || faceImageData.width <= 0 || faceImageData.height <= 0) {
      throw new Error('Invalid ImageData: ImageData must have valid dimensions and pixel data');
    }

    if (faceImageData.data.length !== faceImageData.width * faceImageData.height * 4) {
      throw new Error('Invalid ImageData: Data length does not match dimensions');
    }

    try {
      this.frameCount++;

      // Apply increased crop if bbox is provided
      let processedImageData: ImageData;
      if (bbox) {
        // Validate bbox
        if (bbox.width <= 0 || bbox.height <= 0 || bbox.x < 0 || bbox.y < 0) {
          throw new Error('Invalid bounding box dimensions');
        }
        if (bbox.x + bbox.width > faceImageData.width || bbox.y + bbox.height > faceImageData.height) {
          throw new Error('Bounding box exceeds image dimensions');
        }
        processedImageData = this.increasedCrop(faceImageData, bbox, bboxInc);
      } else {
        processedImageData = faceImageData;
      }

      const tensor = this.preprocessFaceImage(processedImageData);

      if (this.frameCount === 1) {
        console.log('🔍 Model initialized - Input:', this.pooledSession.session.inputNames[0]);
        console.log('🔍 Tensor shape:', tensor.dims);
      }

      // Debug: Log input details before running inference
      console.log('🔍 Input names:', this.pooledSession.session.inputNames);
      console.log('🔍 Output names:', this.pooledSession.session.outputNames);
      console.log('🔍 Tensor shape:', tensor.dims);
      console.log('🔍 Tensor type:', tensor.type);
      
      const inputName = this.pooledSession.session.inputNames[0];
      const feeds = { [inputName]: tensor };
      
      console.log('🔍 Feeds object:', Object.keys(feeds), 'with tensor shape:', feeds[inputName].dims);
      
      const outputs = await this.pooledSession.session.run(feeds);

      const outputTensor = outputs[this.pooledSession.session.outputNames[0]];
      const outputData = outputTensor.data as Float32Array;

      // Model outputs [1,2] logits: [live_logit, spoof_logit] - CORRECTED ORDER!
      const liveLogit = outputData[0];
      const spoofLogit = outputData[1];
      
      // Apply softmax to get probabilities
      const maxLogit = Math.max(spoofLogit, liveLogit);
      const expSpoof = Math.exp(spoofLogit - maxLogit);
      const expLive = Math.exp(liveLogit - maxLogit);
      const sumExp = expSpoof + expLive;
      
      const liveProb = expLive / sumExp;
      const spoofProb = expSpoof / sumExp;
      
      // Determine if spoof (not live) - FIXED LOGIC!
      const isSpoof = liveProb < spoofProb;
      
      // Use higher probability as confidence - FIXED!
      const confidence = Math.max(liveProb, spoofProb);
      
      // Raw score is the difference between live and spoof logits
      const rawScore = liveLogit - spoofLogit;

      console.log(`Spoof: ${spoofLogit.toFixed(3)}, Live: ${liveLogit.toFixed(3)}, LiveProb: ${liveProb.toFixed(3)}, isSpoof: ${isSpoof}`);

      return {
        isLive: !isSpoof, // Convert isSpoof to isLive
        confidence,
        score: rawScore,
      };
    } catch (err) {
      console.error('❌ Anti-spoofing detection failed:', err);
      return {
        isLive: false,
        confidence: 0,
        score: 0,
      };
    }
  }

  /**
   * Apply increased crop like Python's increased_crop
   */
  private increasedCrop(
    imgData: ImageData,
    bbox: BoundingBox,
    bboxInc: number
  ): ImageData {
    const { width: imgW, height: imgH } = imgData;

    const { x, y, width, height } = bbox;
    const l = Math.max(width, height);
    const xc = x + width / 2;
    const yc = y + height / 2;

    const x1 = Math.max(0, Math.round(xc - (l * bboxInc) / 2));
    const y1 = Math.max(0, Math.round(yc - (l * bboxInc) / 2));
    const x2 = Math.min(imgW, Math.round(xc + (l * bboxInc) / 2));
    const y2 = Math.min(imgH, Math.round(yc + (l * bboxInc) / 2));

    const cropW = x2 - x1;
    const cropH = y2 - y1;

    const canvas = new OffscreenCanvas(this.INPUT_SIZE, this.INPUT_SIZE);
    const ctx = canvas.getContext('2d')!;

    // Create temporary source canvas
    const srcCanvas = new OffscreenCanvas(imgW, imgH);
    const srcCtx = srcCanvas.getContext('2d')!;
    srcCtx.putImageData(imgData, 0, 0);

    // Draw cropped region and pad to square if necessary
    ctx.drawImage(srcCanvas, x1, y1, cropW, cropH, 0, 0, this.INPUT_SIZE, this.INPUT_SIZE);

    return ctx.getImageData(0, 0, this.INPUT_SIZE, this.INPUT_SIZE);
  }

  /**
   * Preprocess face image for anti-spoofing model
   * @param faceImageData - Face image data from canvas
   * @returns Preprocessed tensor data
   */
  private preprocessFaceImage(faceImageData: ImageData): ort.Tensor {
    const { width, height } = faceImageData;
    
    // Validate input dimensions
    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid image dimensions: ${width}x${height}`);
    }
    
    try {
      // Create canvas for resizing
      const canvas = new OffscreenCanvas(this.INPUT_SIZE, this.INPUT_SIZE);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get 2D context from OffscreenCanvas');
      }
      
      // Create ImageData and draw to canvas
      const sourceCanvas = new OffscreenCanvas(width, height);
      const sourceCtx = sourceCanvas.getContext('2d');
      if (!sourceCtx) {
        throw new Error('Failed to get 2D context from source OffscreenCanvas');
      }
      
      sourceCtx.putImageData(faceImageData, 0, 0);
      
      // Resize to exactly 128x128 with proper interpolation
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(sourceCanvas, 0, 0, this.INPUT_SIZE, this.INPUT_SIZE);
      
      // Get resized image data
      const resizedImageData = ctx.getImageData(0, 0, this.INPUT_SIZE, this.INPUT_SIZE);
      const resizedData = resizedImageData.data;
      
      // Validate resized data
      if (resizedData.length !== this.INPUT_SIZE * this.INPUT_SIZE * 4) {
        throw new Error(`Invalid resized data length: expected ${this.INPUT_SIZE * this.INPUT_SIZE * 4}, got ${resizedData.length}`);
      }
      
      // Convert to RGB and normalize to [0, 1] range (standard for most models)
      const tensorData = new Float32Array(3 * this.INPUT_SIZE * this.INPUT_SIZE);
      
      for (let i = 0; i < this.INPUT_SIZE * this.INPUT_SIZE; i++) {
        const pixelIndex = i * 4;
        
        // Extract RGB values
        const r = resizedData[pixelIndex];
        const g = resizedData[pixelIndex + 1];
        const b = resizedData[pixelIndex + 2];
        
        // Normalize to [0, 1] and arrange in CHW format
        tensorData[i] = r / 255.0;                                    // R channel
        tensorData[this.INPUT_SIZE * this.INPUT_SIZE + i] = g / 255.0; // G channel
        tensorData[2 * this.INPUT_SIZE * this.INPUT_SIZE + i] = b / 255.0; // B channel
      }
      
      // Validate tensor data
      if (tensorData.length !== 3 * this.INPUT_SIZE * this.INPUT_SIZE) {
        throw new Error(`Invalid tensor data length: expected ${3 * this.INPUT_SIZE * this.INPUT_SIZE}, got ${tensorData.length}`);
      }

      // Debug: Log tensor creation details
      console.log('🔍 Creating tensor with shape:', [1, 3, this.INPUT_SIZE, this.INPUT_SIZE]);
      console.log('🔍 Tensor data length:', tensorData.length);
      console.log('🔍 Expected length:', 3 * this.INPUT_SIZE * this.INPUT_SIZE);
      
      const tensor = new ort.Tensor('float32', tensorData, [1, 3, this.INPUT_SIZE, this.INPUT_SIZE]);
      console.log('🔍 Created tensor dims:', tensor.dims);
      console.log('🔍 Created tensor type:', tensor.type);
      
      return tensor;
    } catch (error) {
      console.error('❌ Error in preprocessFaceImage:', error);
      throw new Error(`Failed to preprocess face image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }


  setThreshold(threshold: number): void {
    this.threshold = Math.max(0, Math.min(1, threshold));
  }

  getThreshold(): number {
    return this.threshold;
  }

  getStats() {
    return {
      frameCount: this.frameCount,
      threshold: this.threshold,
      inputSize: this.INPUT_SIZE,
    };
  }

  /**
   * Check if the model is initialized (for lazy loading)
   */
  isInitialized(): boolean {
    return this.pooledSession !== null;
  }

  dispose(): void {
    if (this.pooledSession) {
      this.sessionPool.releaseSession(this.pooledSession);
      this.pooledSession = null;
    }
  }
}
