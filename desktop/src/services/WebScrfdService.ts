import * as ort from 'onnxruntime-web/all';
import { SessionPoolManager, type PooledSession } from './SessionPoolManager.js';

export interface DetectionResult {
  bbox: [number, number, number, number]; // [x1, y1, x2, y2]
  confidence: number;
  landmarks: number[][]; // 5 facial landmarks as [x, y] pairs
}

interface ScaleParams {
  scale: number;
  offsetX: number;
  offsetY: number;
  originalWidth: number;
  originalHeight: number;
}

export class WebScrfdService {
  private pooledSession: PooledSession | null = null;
  private sessionPool: SessionPoolManager;
  private confThreshold = 0.5;  // Optimal threshold for pre-sigmoid activated model outputs
  private iouThreshold = 0.4;   // Standard IoU for NMS
  
  private readonly fmc = 3;
  private readonly featStrideFpn = [8, 16, 32];
  private readonly numAnchors = 2;
  private readonly useKps = true;
  
  private readonly mean = 127.5;
  private readonly std = 128.0;
  
  private centerCache = new Map<string, Float32Array>();
  
  // Performance monitoring
  private frameCount = 0;

  async initialize(preloadedBuffer?: ArrayBuffer): Promise<void> {
    // Detect environment safely (works in both browser and worker contexts)
    const isDev = (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') || 
                  (typeof window !== 'undefined' && window.location.hostname === 'localhost');
    
    const modelName = 'det_500m_kps_320.onnx';

    
    let modelBuffer: ArrayBuffer;
    
    // Use pre-loaded buffer if available (worker context with optimization)
    if (preloadedBuffer) {

      modelBuffer = preloadedBuffer;
    } else {
      // Fallback to loading methods for main context or dev mode
      if (typeof window !== 'undefined' && (window as { electronAPI?: { invoke: (channel: string, ...args: unknown[]) => Promise<ArrayBuffer> } }).electronAPI) {
        // Main context - use IPC for better performance
        const electronAPI = (window as { electronAPI: { invoke: (channel: string, ...args: unknown[]) => Promise<ArrayBuffer> } }).electronAPI;
        modelBuffer = await electronAPI.invoke('model:load', modelName);
      } else if (isDev) {
        // Dev mode - use fetch from public folder
        const response = await fetch(`/weights/${modelName}`);
        if (!response.ok) throw new Error(`Failed to fetch model: ${response.statusText}`);
        modelBuffer = await response.arrayBuffer();
      } else {
        // No fallback - optimization should provide preloaded buffer or use IPC/dev fetch
        throw new Error(`Model loading failed: ${modelName} not available through optimized loading paths`);
      }
    }
    
    // Use session pool for optimized initialization and reuse
    this.pooledSession = await this.sessionPool.getSession(
      modelName,
      async () => {
        // Pass model name to get WASM-only execution providers for SCRFD
        const options = this.sessionPool.getOptimizedSessionOptions(modelName);
        return await ort.InferenceSession.create(modelBuffer, options);
      }
    );
    
    // Warm up the session with dummy input for faster first inference
    // Use the correct input size of 320x320 that matches the model's expected dimensions
    try {
      const WARMUP_INPUT_SIZE = 320; // Match the actual model input size
      const dummyInput = {
        [this.pooledSession.session.inputNames[0]]: new ort.Tensor('float32', new Float32Array(3 * WARMUP_INPUT_SIZE * WARMUP_INPUT_SIZE), [1, 3, WARMUP_INPUT_SIZE, WARMUP_INPUT_SIZE])
      };
      await this.sessionPool.warmupSession(this.pooledSession, dummyInput);
    } catch (warmupError) {
      console.info('🔄 SCRFD warmup failed, but session is ready for actual inference:', warmupError);
    }
    
    if (this.pooledSession.session.inputNames.length !== 1) {
      throw new Error(`Unexpected number of inputs: ${this.pooledSession.session.inputNames.length}`);
    }
    
    if (this.pooledSession.session.outputNames.length !== 9) {
      throw new Error(`Unexpected number of outputs: ${this.pooledSession.session.outputNames.length}`);
    }
  }

  async detect(imageData: ImageData): Promise<DetectionResult[]> {
    if (!this.pooledSession?.session) {
      throw new Error('Client-side SCRFD model not initialized');
    }

    try {
      this.frameCount++;
      
      const { width, height } = imageData;
      
      if (!width || !height || width <= 0 || height <= 0) {
        return [];
      }

      const FIXED_INPUT_SIZE = 320;
      
      const scale = Math.min(FIXED_INPUT_SIZE / width, FIXED_INPUT_SIZE / height);
      const scaledWidth = Math.round(width * scale);
      const scaledHeight = Math.round(height * scale);
      const offsetX = Math.round((FIXED_INPUT_SIZE - scaledWidth) / 2);
      const offsetY = Math.round((FIXED_INPUT_SIZE - scaledHeight) / 2);
      
      const scaleParams = { scale, offsetX, offsetY, originalWidth: width, originalHeight: height };
      
      const tensor = this.createBlobFromImage(imageData);
      
      const feeds = { [this.pooledSession.session.inputNames[0]]: tensor };
      const outputs = await this.pooledSession.session.run(feeds);
      
      const detections = this.postprocessOutputs(outputs, scaleParams);
      
      return detections;
    } catch {
      return [];
    }
  }

  // Global reusable resources with proper cleanup for production use
  private static globalBlobCanvas: OffscreenCanvas | null = null;
  private static globalSourceCanvas: OffscreenCanvas | null = null;
  private static globalTensorData: Float32Array | null = null;
  private static instanceCount = 0;
  
  constructor() {
    WebScrfdService.instanceCount++;
    this.sessionPool = SessionPoolManager.getInstance();
  }
  
  dispose(): void {
    WebScrfdService.instanceCount--;
    if (this.pooledSession) {
      this.sessionPool.releaseSession(this.pooledSession);
      this.pooledSession = null;
    }
    if (WebScrfdService.instanceCount <= 0) {
      WebScrfdService.globalBlobCanvas = null;
      WebScrfdService.globalSourceCanvas = null;
      WebScrfdService.globalTensorData = null;
      WebScrfdService.instanceCount = 0;
    }
    this.centerCache.clear();
  }
  
  private createBlobFromImage(imageData: ImageData): ort.Tensor {
    const { width, height } = imageData;
    const FIXED_INPUT_SIZE = 320;
    
    // Create or reuse global canvas for processing (shared across instances for memory efficiency)
    if (!WebScrfdService.globalBlobCanvas) {
      WebScrfdService.globalBlobCanvas = new OffscreenCanvas(FIXED_INPUT_SIZE, FIXED_INPUT_SIZE);
    }
    const canvas = WebScrfdService.globalBlobCanvas;
    const ctx = canvas.getContext('2d', { 
      willReadFrequently: true,
      alpha: false,  // Disable alpha for better performance
      desynchronized: true  // Allow async rendering
    }) as OffscreenCanvasRenderingContext2D;
    
    if (!ctx) {
      throw new Error('Failed to create canvas context for image preprocessing');
    }
    
    // Pre-calculate all scaling factors once
    const scale = Math.min(FIXED_INPUT_SIZE / width, FIXED_INPUT_SIZE / height);
    const scaledWidth = Math.round(width * scale);
    const scaledHeight = Math.round(height * scale);
    const offsetX = Math.round((FIXED_INPUT_SIZE - scaledWidth) / 2);
    const offsetY = Math.round((FIXED_INPUT_SIZE - scaledHeight) / 2);
    
    // Ultra-fast background clear (avoid fillRect for better performance)
    ctx.imageSmoothingEnabled = false;  // Critical: disable smoothing for speed
    ctx.clearRect(0, 0, FIXED_INPUT_SIZE, FIXED_INPUT_SIZE);
    
    // Create temp canvas only when size changes (major optimization)
    if (!WebScrfdService.globalSourceCanvas || 
        WebScrfdService.globalSourceCanvas.width !== width || 
        WebScrfdService.globalSourceCanvas.height !== height) {
      WebScrfdService.globalSourceCanvas = new OffscreenCanvas(width, height);
    }
    const sourceCanvas = WebScrfdService.globalSourceCanvas;
    const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    
    // Fastest possible image transfer
    sourceCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(sourceCanvas, offsetX, offsetY, scaledWidth, scaledHeight);
    
    // Get processed image data efficiently
    const processedImageData = ctx.getImageData(0, 0, FIXED_INPUT_SIZE, FIXED_INPUT_SIZE);
    const processedData = processedImageData.data;
    
    // Reuse global tensor data array (massive memory allocation savings)
    if (!WebScrfdService.globalTensorData) {
      WebScrfdService.globalTensorData = new Float32Array(3 * FIXED_INPUT_SIZE * FIXED_INPUT_SIZE);
    }
    const tensorData = WebScrfdService.globalTensorData;
    const channelSize = FIXED_INPUT_SIZE * FIXED_INPUT_SIZE;
    
    // Ultimate optimization: direct vectorized processing with minimal divisions
    const invStd = 1.0 / this.std;  // Pre-compute division
    const MEGA_BATCH_SIZE = 8192;   // Process in large chunks for cache efficiency
    
    for (let batch = 0; batch < channelSize; batch += MEGA_BATCH_SIZE) {
      const batchEnd = Math.min(batch + MEGA_BATCH_SIZE, channelSize);
      
      for (let i = batch; i < batchEnd; i++) {
        const rgba_idx = i << 2;
        
        const r = processedData[rgba_idx];
        const g = processedData[rgba_idx + 1]; 
        const b = processedData[rgba_idx + 2];
        
        // CRITICAL FIX: Store in RGB format (not BGR) for SCRFD model
        tensorData[i] = (r - this.mean) * invStd;                    // R channel
        tensorData[i + channelSize] = (g - this.mean) * invStd;      // G channel
        tensorData[i + (channelSize << 1)] = (b - this.mean) * invStd; // B channel
      }
    }
    
    return new ort.Tensor('float32', tensorData, [1, 3, FIXED_INPUT_SIZE, FIXED_INPUT_SIZE]);
  }

  private postprocessOutputs(outputs: Record<string, ort.Tensor>, scaleParams: ScaleParams): DetectionResult[] {
    const scoresList: Float32Array[] = [];
    const bboxesList: Float32Array[] = [];
    const kpssList: Float32Array[] = [];
    
    const FIXED_INPUT_SIZE = 320;
    
    for (let idx = 0; idx < this.featStrideFpn.length; idx++) {
      const stride = this.featStrideFpn[idx];
      
      const scores = outputs[this.pooledSession!.session.outputNames[idx]];
      const bboxPreds = outputs[this.pooledSession!.session.outputNames[idx + this.fmc]];
      const kpsPreds = this.useKps ? outputs[this.pooledSession!.session.outputNames[idx + this.fmc * 2]] : null;
      
      const height = Math.floor(FIXED_INPUT_SIZE / stride);
      const width = Math.floor(FIXED_INPUT_SIZE / stride);
      
      const expectedSize = height * width * this.numAnchors;
      const actualSize = scores.dims[scores.dims.length - 1] * scores.dims[scores.dims.length - 2];
      
      if (actualSize !== expectedSize) {
        continue;
      }
      
      const key = `${height},${width},${stride}`;
      let anchorCenters = this.centerCache.get(key);
      
      if (!anchorCenters) {
        anchorCenters = this.createAnchorCenters(height, width, stride);
        if (this.centerCache.size < 100) {
          this.centerCache.set(key, anchorCenters);
        }
      }
      
      const scoresData = scores.data as Float32Array;
      const bboxData = bboxPreds.data as Float32Array;
      const kpsData = kpsPreds ? (kpsPreds.data as Float32Array) : null;
      
      const numAnchors = height * width * this.numAnchors;
      
      
      for (let i = 0; i < numAnchors && i < scoresData.length; i++) {
        const rawScore = scoresData[i];
        // Model already outputs sigmoid-activated probabilities (0-1 range)
        const confidenceScore = rawScore;
        
        if (confidenceScore >= this.confThreshold) {
          // CRITICAL FIX: Create individual arrays for each detection (like server-side)
          scoresList.push(new Float32Array([confidenceScore]));
          
          // Decode bbox with stride scaling
          const bbox = this.distance2bbox(anchorCenters, bboxData, i, stride);
          bboxesList.push(bbox);
          
          // Decode keypoints if available with stride scaling  
          if (kpsData && this.useKps) {
            const kps = this.distance2kps(anchorCenters, kpsData, i, stride);
            kpssList.push(kps);
          }
        }
      }
    }
    
    if (scoresList.length === 0) {
      return [];
    }
    
    return this.applyNMS(scoresList, bboxesList, kpssList, scaleParams);
  }

  private createAnchorCenters(height: number, width: number, stride: number): Float32Array {
    const totalAnchors = height * width * this.numAnchors;
    const centers = new Float32Array(totalAnchors * 2);
    
    let idx = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const centerX = x * stride;
        const centerY = y * stride;
        
        for (let a = 0; a < this.numAnchors; a++) {
          centers[idx++] = centerX;
          centers[idx++] = centerY;
        }
      }
    }
    
    return centers;
  }

  private distance2bbox(points: Float32Array, distances: Float32Array, idx: number, stride: number): Float32Array {
    const centerX = points[idx * 2] || 0;
    const centerY = points[idx * 2 + 1] || 0;
    
    const left = (distances[idx * 4] || 0) * stride;
    const top = (distances[idx * 4 + 1] || 0) * stride;
    const right = (distances[idx * 4 + 2] || 0) * stride;
    const bottom = (distances[idx * 4 + 3] || 0) * stride;
    
    const x1 = centerX - left;
    const y1 = centerY - top;
    const x2 = centerX + right;
    const y2 = centerY + bottom;
    
    return new Float32Array([
      isFinite(x1) ? x1 : 0,
      isFinite(y1) ? y1 : 0,
      isFinite(x2) ? x2 : 0,
      isFinite(y2) ? y2 : 0
    ]);
  }

  private distance2kps(points: Float32Array, distances: Float32Array, idx: number, stride: number): Float32Array {
    const centerX = points[idx * 2] || 0;
    const centerY = points[idx * 2 + 1] || 0;
    
    const kps = new Float32Array(10);
    
    for (let i = 0; i < 5; i++) {
      const dx = (distances[idx * 10 + i * 2] || 0) * stride;
      const dy = (distances[idx * 10 + i * 2 + 1] || 0) * stride;
      
      const x = centerX + dx;
      const y = centerY + dy;
      
      kps[i * 2] = isFinite(x) ? x : 0;
      kps[i * 2 + 1] = isFinite(y) ? y : 0;
    }
    
    return kps;
  }

  private applyNMS(scoresList: Float32Array[], bboxesList: Float32Array[], kpssList: Float32Array[], scaleParams: ScaleParams): DetectionResult[] {
    // Simple NMS implementation matching server-side
    const results: DetectionResult[] = [];
    
    // Convert to unified format for NMS
    const detections = scoresList.map((scores, i) => ({
      score: scores[0], // Individual score arrays now
      bbox: bboxesList[i],
      kps: kpssList[i] || new Float32Array(10)
    }));
    
    // Sort by confidence
    detections.sort((a, b) => b.score - a.score);
    
    const keep: boolean[] = new Array(detections.length).fill(true);
    
    for (let i = 0; i < detections.length; i++) {
      if (!keep[i]) continue;
      
      const bbox1 = detections[i].bbox;
      
      for (let j = i + 1; j < detections.length; j++) {
        if (!keep[j]) continue;
        
        const bbox2 = detections[j].bbox;
        const iou = this.calculateIoU(bbox1, bbox2);
        
        if (iou > this.iouThreshold) {
          keep[j] = false;
        }
      }
    }
    
    // Convert kept detections to results
    for (let i = 0; i < detections.length; i++) {
      if (keep[i]) {
        const det = detections[i];
        const bbox = det.bbox;
        
        // Scale back to original image coordinates
        const scaledBbox: [number, number, number, number] = [
          (bbox[0] - scaleParams.offsetX) / scaleParams.scale,
          (bbox[1] - scaleParams.offsetY) / scaleParams.scale,
          (bbox[2] - scaleParams.offsetX) / scaleParams.scale,
          (bbox[3] - scaleParams.offsetY) / scaleParams.scale
        ];
        
        // Convert keypoints to array of [x, y] pairs
        const landmarks: number[][] = [];
        for (let k = 0; k < 5; k++) {
          landmarks.push([
            (det.kps[k * 2] - scaleParams.offsetX) / scaleParams.scale,
            (det.kps[k * 2 + 1] - scaleParams.offsetY) / scaleParams.scale
          ]);
        }
        
        results.push({
          bbox: scaledBbox,
          confidence: det.score,
          landmarks
        });
      }
    }
    
    return results;
  }

  private calculateIoU(bbox1: Float32Array, bbox2: Float32Array): number {
    const x1 = Math.max(bbox1[0], bbox2[0]);
    const y1 = Math.max(bbox1[1], bbox2[1]);
    const x2 = Math.min(bbox1[2], bbox2[2]);
    const y2 = Math.min(bbox1[3], bbox2[3]);
    
    if (x2 <= x1 || y2 <= y1) return 0;
    
    const intersection = (x2 - x1) * (y2 - y1);
    const area1 = (bbox1[2] - bbox1[0]) * (bbox1[3] - bbox1[1]);
    const area2 = (bbox2[2] - bbox2[0]) * (bbox2[3] - bbox2[1]);
    const union = area1 + area2 - intersection;
    
    return intersection / union;
  }
}
