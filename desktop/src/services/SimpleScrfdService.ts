import * as ort from 'onnxruntime-node';
import { join } from 'path';

export interface DetectionResult {
  bbox: [number, number, number, number]; // [x1, y1, x2, y2]
  confidence: number;
  landmarks: number[][]; // 5 facial landmarks as [x, y] pairs
}

export interface SerializableImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  colorSpace?: PredefinedColorSpace;
}

export class SimpleScrfdService {
  private session: ort.InferenceSession | null = null;
  private inputSize = 640;
  private confThreshold = 0.65; // Increased from 0.5 to reduce false positives
  private iouThreshold = 0.4;
  
  // SCRFD model parameters (exactly like Python)
  private readonly fmc = 3;
  private readonly featStrideFpn = [8, 16, 32];
  private readonly numAnchors = 2;
  private readonly useKps = true;
  
  private readonly mean = 127.5;
  private readonly std = 128.0;
  
  private centerCache = new Map<string, Float32Array>();

  async initialize(modelPath?: string): Promise<void> {
    try {
      const weightsPath = modelPath || join(__dirname, '../../../weights/scrfd_2.5g_kps_640x640.onnx');
      console.log('Loading Simple SCRFD model from:', weightsPath);
      
      this.session = await ort.InferenceSession.create(weightsPath, {
        executionProviders: ['cpu']
      });
      
      console.log('Simple SCRFD model loaded successfully');
    } catch (error) {
      console.error('Failed to load Simple SCRFD model:', error);
      throw error;
    }
  }

  async detect(imageData: SerializableImageData): Promise<DetectionResult[]> {
    if (!this.session) {
      throw new Error('Simple SCRFD model not initialized');
    }

    try {
      const { width, height } = imageData;
      
      if (!width || !height || width <= 0 || height <= 0) {
        return [];
      }

      // Step 1: Resize with aspect ratio preservation (like Python)
      const imRatio = height / width;
      const modelRatio = this.inputSize / this.inputSize; // 1.0
      
      let newWidth: number, newHeight: number;
      if (imRatio > modelRatio) {
        newHeight = this.inputSize;
        newWidth = Math.floor(newHeight / imRatio);
      } else {
        newWidth = this.inputSize;
        newHeight = Math.floor(newWidth * imRatio);
      }
      
      const detScale = newHeight / height;
      
      // Step 2: Create tensor exactly like cv2.dnn.blobFromImage
      const tensor = this.createBlobFromImage(imageData, newWidth, newHeight);
      
      // Step 3: Run inference
      const feeds = { [this.session.inputNames[0]]: tensor };
      const outputs = await this.session.run(feeds);
      
      // Step 4: Postprocess exactly like Python
      const detections = this.postprocessOutputs(outputs, detScale);
      
      return detections;
    } catch (error) {
      console.error('Simple SCRFD detection error:', error);
      return [];
    }
  }

  private createBlobFromImage(imageData: SerializableImageData, newWidth: number, newHeight: number): ort.Tensor {
    const { data, width, height } = imageData;
    
    // Create padded image buffer (640x640x3)
    const paddedSize = this.inputSize * this.inputSize * 3;
    const paddedData = new Uint8Array(paddedSize);
    
    // Resize and copy image data (bilinear interpolation approximation)
    for (let y = 0; y < newHeight; y++) {
      for (let x = 0; x < newWidth; x++) {
        // Map to original image coordinates
        const srcX = Math.floor((x * width) / newWidth);
        const srcY = Math.floor((y * height) / newHeight);
        
        if (srcX < width && srcY < height) {
          const srcIdx = (srcY * width + srcX) * 4; // RGBA
          const dstIdx = (y * this.inputSize + x) * 3; // RGB
          
          // Copy RGB (ignore alpha)
          paddedData[dstIdx] = data[srcIdx];     // R
          paddedData[dstIdx + 1] = data[srcIdx + 1]; // G  
          paddedData[dstIdx + 2] = data[srcIdx + 2]; // B
        }
      }
    }
    
    // Convert to blob format exactly like cv2.dnn.blobFromImage
    // Formula: (pixel - mean) / std with BGR->RGB swap
    const tensorData = new Float32Array(3 * this.inputSize * this.inputSize);
    
    for (let y = 0; y < this.inputSize; y++) {
      for (let x = 0; x < this.inputSize; x++) {
        const pixelIdx = (y * this.inputSize + x) * 3;
        const tensorIdx = y * this.inputSize + x;
        
        // Get RGB values
        const r = paddedData[pixelIdx];
        const g = paddedData[pixelIdx + 1];
        const b = paddedData[pixelIdx + 2];
        
        // Store as BGR in CHW format (like cv2.dnn.blobFromImage with swapRB=True)
        tensorData[tensorIdx] = (b - this.mean) / this.std; // B channel
        tensorData[this.inputSize * this.inputSize + tensorIdx] = (g - this.mean) / this.std; // G channel
        tensorData[2 * this.inputSize * this.inputSize + tensorIdx] = (r - this.mean) / this.std; // R channel
      }
    }
    
    return new ort.Tensor('float32', tensorData, [1, 3, this.inputSize, this.inputSize]);
  }

  private postprocessOutputs(outputs: ort.InferenceSession.OnnxValueMapType, detScale: number): DetectionResult[] {
    const scoresList: Float32Array[] = [];
    const bboxesList: Float32Array[] = [];
    const kpssList: Float32Array[] = [];
    
    // Process each feature map (exactly like Python)
    for (let idx = 0; idx < this.featStrideFpn.length; idx++) {
      const stride = this.featStrideFpn[idx];
      
      const scores = outputs[this.session!.outputNames[idx]] as ort.Tensor;
      const bboxPreds = outputs[this.session!.outputNames[idx + this.fmc]] as ort.Tensor;
      const kpsPreds = this.useKps ? outputs[this.session!.outputNames[idx + this.fmc * 2]] as ort.Tensor : null;
      
      const height = Math.floor(this.inputSize / stride);
      const width = Math.floor(this.inputSize / stride);
      
      // Get anchor centers (cached like Python)
      const key = `${height},${width},${stride}`;
      let anchorCenters = this.centerCache.get(key);
      
      if (!anchorCenters) {
        anchorCenters = this.createAnchorCenters(height, width, stride);
        if (this.centerCache.size < 100) {
          this.centerCache.set(key, anchorCenters);
        }
      }
      
      // Filter by confidence (exactly like Python)
      const scoresData = scores.data as Float32Array;
      const bboxData = bboxPreds.data as Float32Array;
      const kpsData = kpsPreds ? (kpsPreds.data as Float32Array) : null;
      
      // Scale bbox predictions by stride (like Python)
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
      
      // Find positive indices (like Python np.where)
      for (let i = 0; i < scoresData.length; i++) {
        if (scoresData[i] >= this.confThreshold) {
          scoresList.push(new Float32Array([scoresData[i]]));
          
          // Decode bbox using distance2bbox
          const bbox = this.distance2bbox(anchorCenters, scaledBboxData, i);
          bboxesList.push(bbox);
          
          // Decode keypoints if available
          if (scaledKpsData && this.useKps) {
            const kps = this.distance2kps(anchorCenters, scaledKpsData, i);
            kpssList.push(kps);
          }
        }
      }
    }
    
    if (scoresList.length === 0) {
      return [];
    }
    
    // Apply NMS and scale back to original image coordinates
    return this.applyNMS(scoresList, bboxesList, kpssList, detScale);
  }

  private createAnchorCenters(height: number, width: number, stride: number): Float32Array {
    const centers = new Float32Array(height * width * this.numAnchors * 2);
    let idx = 0;
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let a = 0; a < this.numAnchors; a++) {
          centers[idx++] = x * stride;
          centers[idx++] = y * stride;
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
      centerX - left,   // x1
      centerY - top,    // y1
      centerX + right,  // x2
      centerY + bottom  // y2
    ]);
  }

  private distance2kps(points: Float32Array, distances: Float32Array, idx: number): Float32Array {
    const centerX = points[idx * 2] || 0;
    const centerY = points[idx * 2 + 1] || 0;
    
    const kps = new Float32Array(10); // 5 points * 2 coordinates
    
    for (let i = 0; i < 5; i++) {
      const dx = distances[idx * 10 + i * 2] || 0;
      const dy = distances[idx * 10 + i * 2 + 1] || 0;
      
      kps[i * 2] = centerX + dx;
      kps[i * 2 + 1] = centerY + dy;
    }
    
    return kps;
  }

  private applyNMS(scores: Float32Array[], bboxes: Float32Array[], kpss: Float32Array[], detScale: number): DetectionResult[] {
    if (scores.length === 0) return [];
    
    // Convert to unified format
    const detections: Array<{
      score: number;
      bbox: Float32Array;
      kps?: Float32Array;
    }> = [];
    
    for (let i = 0; i < scores.length; i++) {
      detections.push({
        score: scores[i][0],
        bbox: bboxes[i],
        kps: kpss.length > i ? kpss[i] : undefined
      });
    }
    
    // Sort by score (descending)
    detections.sort((a, b) => b.score - a.score);
    
    // Apply NMS
    const keep: boolean[] = new Array(detections.length).fill(true);
    
    for (let i = 0; i < detections.length; i++) {
      if (!keep[i]) continue;
      
      for (let j = i + 1; j < detections.length; j++) {
        if (!keep[j]) continue;
        
        const iou = this.calculateIoU(detections[i].bbox, detections[j].bbox);
        if (iou > this.iouThreshold) {
          keep[j] = false;
        }
      }
    }
    
    // Convert to final format and scale back to original image
    const results: DetectionResult[] = [];
    
    for (let i = 0; i < detections.length; i++) {
      if (!keep[i]) continue;
      
      const det = detections[i];
      const scaledBbox: [number, number, number, number] = [
        det.bbox[0] / detScale,
        det.bbox[1] / detScale,
        det.bbox[2] / detScale,
        det.bbox[3] / detScale
      ];
      
      const landmarks: number[][] = [];
      if (det.kps) {
        for (let k = 0; k < 5; k++) {
          landmarks.push([
            det.kps[k * 2] / detScale,
            det.kps[k * 2 + 1] / detScale
          ]);
        }
      }
      
      results.push({
        bbox: scaledBbox,
        confidence: det.score,
        landmarks
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
