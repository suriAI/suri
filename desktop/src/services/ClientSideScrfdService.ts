import * as ort from 'onnxruntime-web/all';

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

export class ClientSideScrfdService {
  private session: ort.InferenceSession | null = null;
  private confThreshold = 0.3;
  private iouThreshold = 0.4;
  
  private readonly fmc = 3;
  private readonly featStrideFpn = [8, 16, 32];
  private readonly numAnchors = 2;
  private readonly useKps = true;
  
  private readonly mean = 127.5;
  private readonly std = 128.0;
  
  private centerCache = new Map<string, Float32Array>();

  async initialize(): Promise<void> {
    const modelUrl = '/weights/det_500m.onnx';
    
    this.session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['cpu'],
      logSeverityLevel: 2,
      logVerbosityLevel: 0,
      enableCpuMemArena: true,
      enableMemPattern: true,
      executionMode: 'sequential',
      graphOptimizationLevel: 'basic',
    });
    
    if (this.session.inputNames.length !== 1) {
      throw new Error(`Unexpected number of inputs: ${this.session.inputNames.length}`);
    }
    
    if (this.session.outputNames.length !== 9) {
      throw new Error(`Unexpected number of outputs: ${this.session.outputNames.length}`);
    }
  }

  async detect(imageData: ImageData): Promise<DetectionResult[]> {
    if (!this.session) {
      throw new Error('Client-side SCRFD model not initialized');
    }

    try {
      const { width, height } = imageData;
      
      if (!width || !height || width <= 0 || height <= 0) {
        return [];
      }

      const FIXED_INPUT_SIZE = 640;
      
      const scale = Math.min(FIXED_INPUT_SIZE / width, FIXED_INPUT_SIZE / height);
      const scaledWidth = Math.round(width * scale);
      const scaledHeight = Math.round(height * scale);
      const offsetX = Math.round((FIXED_INPUT_SIZE - scaledWidth) / 2);
      const offsetY = Math.round((FIXED_INPUT_SIZE - scaledHeight) / 2);
      
      const scaleParams = { scale, offsetX, offsetY, originalWidth: width, originalHeight: height };
      
      const tensor = this.createBlobFromImage(imageData);
      
      const feeds = { [this.session.inputNames[0]]: tensor };
      const outputs = await this.session.run(feeds);
      
      const detections = this.postprocessOutputs(outputs, scaleParams);
      
      return detections;
    } catch {
      return [];
    }
  }

  // Reuse canvas and tensor data arrays
  private blobCanvas: OffscreenCanvas | null = null;
  private blobSourceCanvas: OffscreenCanvas | null = null;
  private tensorData: Float32Array | null = null;
  
  private createBlobFromImage(imageData: ImageData): ort.Tensor {
    const { width, height } = imageData;
    const FIXED_INPUT_SIZE = 640;
    
    // Create or reuse the destination canvas
    if (!this.blobCanvas) {
      this.blobCanvas = new OffscreenCanvas(FIXED_INPUT_SIZE, FIXED_INPUT_SIZE);
    }
    const canvas = this.blobCanvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    
    if (!ctx) {
      throw new Error('Failed to create canvas context for image preprocessing');
    }
    
    // Create or reuse the source canvas
    if (!this.blobSourceCanvas || this.blobSourceCanvas.width !== width || this.blobSourceCanvas.height !== height) {
      this.blobSourceCanvas = new OffscreenCanvas(width, height);
    }
    const sourceCanvas = this.blobSourceCanvas;
    const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    
    // Clear canvases for reuse
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, FIXED_INPUT_SIZE, FIXED_INPUT_SIZE);
    
    // Calculate scaling factors (cache if dimensions haven't changed)
    const scale = Math.min(FIXED_INPUT_SIZE / width, FIXED_INPUT_SIZE / height);
    const scaledWidth = Math.round(width * scale);
    const scaledHeight = Math.round(height * scale);
    const offsetX = Math.round((FIXED_INPUT_SIZE - scaledWidth) / 2);
    const offsetY = Math.round((FIXED_INPUT_SIZE - scaledHeight) / 2);
    
    // Put image data on source canvas
    sourceCtx.putImageData(imageData, 0, 0);
    
    // Optimize drawing quality for face detection
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium'; // medium is faster than high and still good for detection
    ctx.drawImage(sourceCanvas, offsetX, offsetY, scaledWidth, scaledHeight);
    
    // Get processed image data
    const processedImageData = ctx.getImageData(0, 0, FIXED_INPUT_SIZE, FIXED_INPUT_SIZE);
    const processedData = processedImageData.data;
    
    // Create or reuse tensor data array
    if (!this.tensorData) {
      this.tensorData = new Float32Array(3 * FIXED_INPUT_SIZE * FIXED_INPUT_SIZE);
    }
    const tensorData = this.tensorData;
    const channelSize = FIXED_INPUT_SIZE * FIXED_INPUT_SIZE;
    
    // Batch process pixels for better performance
    const BATCH_SIZE = 1024;
    for (let batch = 0; batch < channelSize; batch += BATCH_SIZE) {
      const batchEnd = Math.min(batch + BATCH_SIZE, channelSize);
      
      for (let i = batch; i < batchEnd; i++) {
        const rgba_idx = i * 4;
        
        // Process RGB values
        const r = processedData[rgba_idx];
        const g = processedData[rgba_idx + 1];
        const b = processedData[rgba_idx + 2];
        
        // Store in BGR order for ONNX model (more efficient tensor conversion)
        tensorData[i] = (b - this.mean) / this.std;
        tensorData[i + channelSize] = (g - this.mean) / this.std;
        tensorData[i + 2 * channelSize] = (r - this.mean) / this.std;
      }
    }
    
    return new ort.Tensor('float32', tensorData, [1, 3, FIXED_INPUT_SIZE, FIXED_INPUT_SIZE]);
  }

  private postprocessOutputs(outputs: Record<string, ort.Tensor>, scaleParams: ScaleParams): DetectionResult[] {
    const scoresList: Float32Array[] = [];
    const bboxesList: Float32Array[] = [];
    const kpssList: Float32Array[] = [];
    
    const FIXED_INPUT_SIZE = 640;
    
    for (let idx = 0; idx < this.featStrideFpn.length; idx++) {
      const stride = this.featStrideFpn[idx];
      
      const scores = outputs[this.session!.outputNames[idx]];
      const bboxPreds = outputs[this.session!.outputNames[idx + this.fmc]];
      const kpsPreds = this.useKps ? outputs[this.session!.outputNames[idx + this.fmc * 2]] : null;
      
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
      
      const scaledBboxData = new Float32Array(bboxData.length);
      for (let i = 0; i < bboxData.length; i++) {
        scaledBboxData[i] = bboxData[i] * stride;
      }
      
      const scaledKpsData = kpsData ? new Float32Array(kpsData.length) : null;
      if (scaledKpsData && kpsData) {
        for (let i = 0; i < kpsData.length; i++) {
          scaledKpsData[i] = kpsData[i] * stride;
        }
      }
      
      const posIndices: number[] = [];
      for (let i = 0; i < scoresData.length; i++) {
        if (scoresData[i] >= this.confThreshold) {
          posIndices.push(i);
        }
      }
      
      if (posIndices.length === 0) continue;
      
      const posScores = new Float32Array(posIndices.length);
      const posBboxes = new Float32Array(posIndices.length * 4);
      const posKpss = scaledKpsData ? new Float32Array(posIndices.length * 10) : null;
      
      for (let i = 0; i < posIndices.length; i++) {
        const idx = posIndices[i];
        
        posScores[i] = scoresData[idx];
        
        const bbox = this.distance2bbox(anchorCenters, scaledBboxData, idx);
        posBboxes[i * 4] = bbox[0];
        posBboxes[i * 4 + 1] = bbox[1];
        posBboxes[i * 4 + 2] = bbox[2];
        posBboxes[i * 4 + 3] = bbox[3];
        
        if (posKpss && scaledKpsData && this.useKps) {
          const kps = this.distance2kps(anchorCenters, scaledKpsData, idx);
          for (let k = 0; k < 10; k++) {
            posKpss[i * 10 + k] = kps[k];
          }
        }
      }
      
      scoresList.push(posScores);
      bboxesList.push(posBboxes);
      if (posKpss) {
        kpssList.push(posKpss);
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

  private distance2bbox(points: Float32Array, distances: Float32Array, idx: number): Float32Array {
    const centerX = points[idx * 2] || 0;
    const centerY = points[idx * 2 + 1] || 0;
    
    const left = distances[idx * 4] || 0;
    const top = distances[idx * 4 + 1] || 0;
    const right = distances[idx * 4 + 2] || 0;
    const bottom = distances[idx * 4 + 3] || 0;
    
    return new Float32Array([
      centerX - left,
      centerY - top,
      centerX + right,
      centerY + bottom
    ]);
  }

  private distance2kps(points: Float32Array, distances: Float32Array, idx: number): Float32Array {
    const centerX = points[idx * 2] || 0;
    const centerY = points[idx * 2 + 1] || 0;
    
    const kps = new Float32Array(10);
    
    for (let i = 0; i < 5; i++) {
      const dx = distances[idx * 10 + i * 2] || 0;
      const dy = distances[idx * 10 + i * 2 + 1] || 0;
      
      kps[i * 2] = centerX + dx;
      kps[i * 2 + 1] = centerY + dy;
    }
    
    return kps;
  }

  private applyNMS(scoresList: Float32Array[], bboxesList: Float32Array[], kpssList: Float32Array[], scaleParams: ScaleParams): DetectionResult[] {
    if (scoresList.length === 0) return [];
    
    let totalDetections = 0;
    for (const scores of scoresList) {
      totalDetections += scores.length;
    }
    
    if (totalDetections === 0) return [];
    
    const allScores = new Float32Array(totalDetections);
    const allBboxes = new Float32Array(totalDetections * 4);
    const allKpss = kpssList.length > 0 ? new Float32Array(totalDetections * 10) : null;
    
    let offset = 0;
    for (let i = 0; i < scoresList.length; i++) {
      const scores = scoresList[i];
      const bboxes = bboxesList[i];
      const kpss = i < kpssList.length ? kpssList[i] : null;
      
      for (let j = 0; j < scores.length; j++) {
        allScores[offset] = scores[j];
        
        for (let k = 0; k < 4; k++) {
          allBboxes[offset * 4 + k] = bboxes[j * 4 + k];
        }
        
        if (allKpss && kpss) {
          for (let k = 0; k < 10; k++) {
            allKpss[offset * 10 + k] = kpss[j * 10 + k];
          }
        }
        
        offset++;
      }
    }
    
    const detections: Array<{
      score: number;
      bbox: [number, number, number, number];
      kps?: number[][];
      index: number;
    }> = [];
    
    for (let i = 0; i < totalDetections; i++) {
      const x1_adjusted = allBboxes[i * 4] - scaleParams.offsetX;
      const y1_adjusted = allBboxes[i * 4 + 1] - scaleParams.offsetY;
      const x2_adjusted = allBboxes[i * 4 + 2] - scaleParams.offsetX;
      const y2_adjusted = allBboxes[i * 4 + 3] - scaleParams.offsetY;
      
      const bbox: [number, number, number, number] = [
        x1_adjusted / scaleParams.scale,
        y1_adjusted / scaleParams.scale,
        x2_adjusted / scaleParams.scale,
        y2_adjusted / scaleParams.scale
      ];
      
      let kps: number[][] | undefined;
      if (allKpss) {
        kps = [];
        for (let k = 0; k < 5; k++) {
          const kp_x_adjusted = allKpss[i * 10 + k * 2] - scaleParams.offsetX;
          const kp_y_adjusted = allKpss[i * 10 + k * 2 + 1] - scaleParams.offsetY;
          
          kps.push([
            kp_x_adjusted / scaleParams.scale,
            kp_y_adjusted / scaleParams.scale
          ]);
        }
      }
      
      detections.push({
        score: allScores[i],
        bbox,
        kps,
        index: i
      });
    }
    
    detections.sort((a, b) => b.score - a.score);
    
    const keep: boolean[] = new Array(detections.length).fill(true);
    
    for (let i = 0; i < detections.length; i++) {
      if (!keep[i]) continue;
      
      for (let j = i + 1; j < detections.length; j++) {
        if (!keep[j]) continue;
        
        const iou = this.calculateIoU(
          new Float32Array(detections[i].bbox),
          new Float32Array(detections[j].bbox)
        );
        if (iou > this.iouThreshold) {
          keep[j] = false;
        }
      }
    }
    
    const results: DetectionResult[] = [];
    
    for (let i = 0; i < detections.length; i++) {
      if (!keep[i]) continue;
      
      const det = detections[i];
      
      results.push({
        bbox: det.bbox,
        confidence: det.score,
        landmarks: det.kps || []
      });
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
