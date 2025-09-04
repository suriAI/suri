import * as ort from 'onnxruntime-node';
import { join } from 'path';

export interface SerializableImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  colorSpace?: PredefinedColorSpace;
}

export interface DetectionResult {
  bbox: [number, number, number, number]; // [x1, y1, x2, y2]
  confidence: number;
  landmarks: number[][]; // 5 facial landmarks as [x, y] pairs
}

export class ScrfdDetectionService {
  private session: ort.InferenceSession | null = null;
  private inputSize = 640;
  private confThreshold = 0.5; // Proper threshold for real detection
  private iouThreshold = 0.4;
  
  // SCRFD model parameters
  private readonly fmc = 3;
  private readonly featStrideFpn = [8, 16, 32];
  private readonly numAnchors = 2;
  private readonly useKps = true;
  
  private readonly mean = 127.5;
  private readonly std = 128.0;
  
  private centerCache = new Map<string, Float32Array>();

  async initialize(modelPath?: string): Promise<void> {
    try {
      const weightsPath = modelPath || join(__dirname, '../../weights/scrfd_2.5g_kps_640x640.onnx');
      console.log('Loading SCRFD model from:', weightsPath);
      
      // Check if file exists
      const fs = await import('fs');
      if (!fs.existsSync(weightsPath)) {
        throw new Error(`SCRFD model file not found at: ${weightsPath}`);
      }
      
      this.session = await ort.InferenceSession.create(weightsPath, {
        executionProviders: ['cpu']
      });
      
      console.log('SCRFD model loaded successfully');
      console.log('Input names:', this.session.inputNames);
      console.log('Output names:', this.session.outputNames);
    } catch (error) {
      console.error('Failed to load SCRFD model:', error);
      throw error;
    }
  }

  async detect(imageData: SerializableImageData): Promise<DetectionResult[]> {
    if (!this.session) {
      throw new Error('SCRFD model not initialized');
    }

    try {
      // Convert ImageData to tensor format with safety checks
      const { width, height } = imageData;
      
      if (!width || !height || width <= 0 || height <= 0) {
        console.error(`[SCRFD] Invalid image dimensions: ${width}x${height}`);
        return [];
      }
      
      console.log(`[SCRFD] Processing image: ${width}x${height}`);
      
      const tensor = this.preprocessImage(imageData, width, height);
      console.log(`[SCRFD] Tensor shape: [${tensor.dims.join(',')}]`);
      
      // Run inference with minimal overhead
      const feeds = { [this.session.inputNames[0]]: tensor };
      const outputs = await this.session.run(feeds);
      
      // Process outputs  
      const detections = this.postprocessOutputs(outputs, width, height);
      
      return detections;
    } catch (error) {
      console.error('SCRFD detection error:', error);
      return []; // Return empty array instead of throwing
    }
  }

  private preprocessImage(imageData: SerializableImageData, width: number, height: number): ort.Tensor {
    // Calculate resize parameters
    const imRatio = height / width;
    const modelRatio = this.inputSize / this.inputSize;
    
    let newWidth: number, newHeight: number;
    if (imRatio > modelRatio) {
      newHeight = this.inputSize;
      newWidth = Math.floor(newHeight / imRatio);
    } else {
      newWidth = this.inputSize;
      newHeight = Math.floor(newWidth * imRatio);
    }
    
    // Create padded image
    const paddedImage = new Float32Array(3 * this.inputSize * this.inputSize);
    
    // Resize and normalize image data
    const { data } = imageData;
    const scaleX = width / newWidth;
    const scaleY = height / newHeight;
    
    for (let y = 0; y < newHeight; y++) {
      for (let x = 0; x < newWidth; x++) {
        const srcX = Math.floor(x * scaleX);
        const srcY = Math.floor(y * scaleY);
        const srcIdx = (srcY * width + srcX) * 4; // RGBA
        
        const dstIdx = y * this.inputSize + x;
        
        // Convert RGBA to BGR and normalize (SCRFD expects BGR format like Python cv2)
        const r = data[srcIdx];     // R from RGBA
        const g = data[srcIdx + 1]; // G from RGBA  
        const b = data[srcIdx + 2]; // B from RGBA
        
        // Normalize and store in CHW format as BGR (like Python implementation)
        paddedImage[dstIdx] = (b - this.mean) / this.std; // B channel first (BGR)
        paddedImage[this.inputSize * this.inputSize + dstIdx] = (g - this.mean) / this.std; // G channel
        paddedImage[2 * this.inputSize * this.inputSize + dstIdx] = (r - this.mean) / this.std; // R channel last
      }
    }
    
    return new ort.Tensor('float32', paddedImage, [1, 3, this.inputSize, this.inputSize]);
  }

  private postprocessOutputs(outputs: ort.InferenceSession.OnnxValueMapType, originalWidth: number, originalHeight: number): DetectionResult[] {
    const scoresList: Float32Array[] = [];
    const bboxesList: Float32Array[] = [];
    const kpssList: Float32Array[] = [];
    
    // Calculate scale factor (same logic as preprocessing)
    const imRatio = originalHeight / originalWidth;
    const modelRatio = 1.0; // Square input
    
    let newWidth: number, newHeight: number;
    if (imRatio > modelRatio) {
      newHeight = this.inputSize;
      newWidth = Math.floor(newHeight / imRatio);
    } else {
      newWidth = this.inputSize;
      newHeight = Math.floor(newWidth * imRatio);
    }
    
    const detScale = newHeight / originalHeight;
    
    // Process each feature map (following Python SCRFD implementation exactly)
    for (let idx = 0; idx < this.featStrideFpn.length; idx++) {
      const stride = this.featStrideFpn[idx];
      
      const scores = outputs[this.session!.outputNames[idx]] as ort.Tensor;
      const bboxPreds = outputs[this.session!.outputNames[idx + this.fmc]] as ort.Tensor;
      const kpsPreds = this.useKps ? outputs[this.session!.outputNames[idx + this.fmc * 2]] as ort.Tensor : null;
      
      const height = Math.floor(this.inputSize / stride);
      const width = Math.floor(this.inputSize / stride);
      
      // Get anchor centers
      const anchorCenters = this.getAnchorCenters(height, width, stride);
      
      // Process predictions (match Python implementation)
      const scoresData = scores.data as Float32Array;
      const bboxData = bboxPreds.data as Float32Array;
      const kpsData = kpsPreds ? (kpsPreds.data as Float32Array) : null;
      
      // Create properly sized arrays for batch processing
      const numAnchors = height * width * this.numAnchors;
      
      // Debug only on first run
      if (idx === 0) {
        console.log(`[SCRFD] Processing ${this.featStrideFpn.length} feature maps`);
      }
      
      let candidatesCount = 0;
      for (let i = 0; i < numAnchors && i < scoresData.length; i++) {
        // Apply sigmoid activation to raw scores
        const score = this.sigmoid(scoresData[i]);
        if (score >= this.confThreshold) {
          candidatesCount++;
          scoresList.push(new Float32Array([score])); // Use sigmoid score
          
          // Decode bbox with stride scaling (like Python)
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
    
    // Apply NMS and return results
    const finalDetections = this.applyNMS(scoresList, bboxesList, kpssList, detScale);
    if (finalDetections.length > 0) {
      console.log(`[SCRFD] Detected ${finalDetections.length} faces`);
    }
    return finalDetections;
  }

  private getAnchorCenters(height: number, width: number, stride: number): Float32Array {
    const key = `${height}-${width}-${stride}`;
    
    if (this.centerCache.has(key)) {
      return this.centerCache.get(key)!;
    }
    
    const centers = new Float32Array(height * width * this.numAnchors * 2);
    let idx = 0;
    
    for (let h = 0; h < height; h++) {
      for (let w = 0; w < width; w++) {
        for (let a = 0; a < this.numAnchors; a++) {
          centers[idx++] = w * stride;
          centers[idx++] = h * stride;
        }
      }
    }
    
    this.centerCache.set(key, centers);
    return centers;
  }

  private distance2bbox(centers: Float32Array, distances: Float32Array, idx: number, stride: number): Float32Array {
    const centerX = centers[idx * 2] || 0;
    const centerY = centers[idx * 2 + 1] || 0;
    
    const left = (distances[idx * 4] || 0) * stride;
    const top = (distances[idx * 4 + 1] || 0) * stride;
    const right = (distances[idx * 4 + 2] || 0) * stride;
    const bottom = (distances[idx * 4 + 3] || 0) * stride;
    
    const x1 = centerX - left;
    const y1 = centerY - top;
    const x2 = centerX + right;
    const y2 = centerY + bottom;
    
    return new Float32Array([
      isFinite(x1) ? x1 : 0,   // x1
      isFinite(y1) ? y1 : 0,   // y1
      isFinite(x2) ? x2 : 0,   // x2
      isFinite(y2) ? y2 : 0    // y2
    ]);
  }

  private distance2kps(centers: Float32Array, distances: Float32Array, idx: number, stride: number): Float32Array {
    const centerX = centers[idx * 2] || 0;
    const centerY = centers[idx * 2 + 1] || 0;
    
    const kps = new Float32Array(10); // 5 points * 2 coordinates
    
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

  private applyNMS(scoresList: Float32Array[], bboxesList: Float32Array[], kpssList: Float32Array[], scale: number): DetectionResult[] {
    // Simple NMS implementation
    const results: DetectionResult[] = [];
    
    // Convert to unified format for NMS
    const detections = scoresList.map((scores, i) => ({
      score: scores[0],
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
          bbox[0] / scale,
          bbox[1] / scale,
          bbox[2] / scale,
          bbox[3] / scale
        ];
        
        // Convert keypoints to array of [x, y] pairs
        const landmarks: number[][] = [];
        for (let k = 0; k < 5; k++) {
          landmarks.push([
            det.kps[k * 2] / scale,
            det.kps[k * 2 + 1] / scale
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

  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  dispose(): void {
    if (this.session) {
      this.session.release();
      this.session = null;
    }
    this.centerCache.clear();
  }
}
