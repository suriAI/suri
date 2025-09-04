import cv from 'opencv4nodejs';
import * as ort from 'onnxruntime-node';
import { join } from 'path';

export interface DetectionResult {
  bbox: [number, number, number, number]; // [x1, y1, x2, y2]
  confidence: number;
  landmarks: number[][]; // 5 facial landmarks as [x, y] pairs
}

export class OpenCVDetectionService {
  private session: ort.InferenceSession | null = null;
  private inputSize = 640;
  private confThreshold = 0.5;
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
      const weightsPath = modelPath || join(__dirname, '../../weights/scrfd_2.5g_kps_640x640.onnx');
      console.log('Loading SCRFD model from:', weightsPath);
      
      this.session = await ort.InferenceSession.create(weightsPath, {
        executionProviders: ['cpu']
      });
      
      console.log('OpenCV SCRFD model loaded successfully');
      console.log('Input names:', this.session.inputNames);
      console.log('Output names:', this.session.outputNames);
    } catch (error) {
      console.error('Failed to load OpenCV SCRFD model:', error);
      throw error;
    }
  }

  async detect(imageMat: cv.Mat): Promise<DetectionResult[]> {
    if (!this.session) {
      throw new Error('OpenCV SCRFD model not initialized');
    }

    try {
      console.log(`[OpenCV SCRFD] Processing image: ${imageMat.cols}x${imageMat.rows}`);
      
      // Use OpenCV's blobFromImage just like Python cv2.dnn.blobFromImage
      const blob = this.createBlob(imageMat);
      console.log(`[OpenCV SCRFD] Blob shape: [${blob.dims.join(',')}]`);
      
      // Run inference
      const feeds = { [this.session.inputNames[0]]: blob };
      const outputs = await this.session.run(feeds);
      
      // Process outputs using the same logic as Python
      const detections = this.postprocessOutputs(outputs, imageMat.cols, imageMat.rows);
      
      if (detections.length > 0) {
        console.log(`[OpenCV SCRFD] Detected ${detections.length} faces`);
      }
      
      return detections;
    } catch (error) {
      console.error('OpenCV SCRFD detection error:', error);
      return [];
    }
  }

  private createBlob(imageMat: cv.Mat): ort.Tensor {
    // Calculate resize parameters (same as Python)
    const imRatio = imageMat.rows / imageMat.cols;
    const modelRatio = 1.0; // Square input
    
    let newWidth: number, newHeight: number;
    if (imRatio > modelRatio) {
      newHeight = this.inputSize;
      newWidth = Math.floor(newHeight / imRatio);
    } else {
      newWidth = this.inputSize;
      newHeight = Math.floor(newWidth * imRatio);
    }
    
    // Resize image
    const resized = imageMat.resize(newHeight, newWidth);
    
    // Create padded image (like Python np.zeros)
    const paddedData = Buffer.alloc(this.inputSize * this.inputSize * 3, 0);
    const padded = new cv.Mat(paddedData, this.inputSize, this.inputSize, cv.CV_8UC3);
    
    // Copy resized image to top-left of padded image
    const roi = padded.getRegion(new cv.Rect(0, 0, newWidth, newHeight));
    resized.copyTo(roi);
    
    // Convert to blob format (NCHW) with normalization
    // This mimics cv2.dnn.blobFromImage with swapRB=True
    const blobData = new Float32Array(3 * this.inputSize * this.inputSize);
    
    const paddedMatData = padded.getData();
    
    for (let y = 0; y < this.inputSize; y++) {
      for (let x = 0; x < this.inputSize; x++) {
        const pixelIdx = (y * this.inputSize + x) * 3; // BGR format
        const dstIdx = y * this.inputSize + x;
        
        // OpenCV uses BGR, convert to RGB and normalize (like Python swapRB=True)
        const b = paddedMatData[pixelIdx];
        const g = paddedMatData[pixelIdx + 1]; 
        const r = paddedMatData[pixelIdx + 2];
        
        // Normalize (same as Python: 1.0/std with mean subtraction)
        blobData[dstIdx] = (r - this.mean) / this.std; // R channel first
        blobData[this.inputSize * this.inputSize + dstIdx] = (g - this.mean) / this.std; // G channel
        blobData[2 * this.inputSize * this.inputSize + dstIdx] = (b - this.mean) / this.std; // B channel
      }
    }
    
    return new ort.Tensor('float32', blobData, [1, 3, this.inputSize, this.inputSize]);
  }

  private postprocessOutputs(outputs: ort.InferenceSession.OnnxValueMapType, originalWidth: number, originalHeight: number): DetectionResult[] {
    const scoresList: Float32Array[] = [];
    const bboxesList: Float32Array[] = [];
    const kpssList: Float32Array[] = [];
    
    // Calculate scale factor (same as Python)
    const imRatio = originalHeight / originalWidth;
    const modelRatio = 1.0;
    
    let newWidth: number, newHeight: number;
    if (imRatio > modelRatio) {
      newHeight = this.inputSize;
      newWidth = Math.floor(newHeight / imRatio);
    } else {
      newWidth = this.inputSize;
      newHeight = Math.floor(newWidth * imRatio);
    }
    
    const detScale = newHeight / originalHeight;
    
    // Process each feature map (exactly like Python)
    for (let idx = 0; idx < this.featStrideFpn.length; idx++) {
      const stride = this.featStrideFpn[idx];
      
      const scores = outputs[this.session!.outputNames[idx]] as ort.Tensor;
      const bboxPreds = outputs[this.session!.outputNames[idx + this.fmc]] as ort.Tensor;
      const kpsPreds = this.useKps ? outputs[this.session!.outputNames[idx + this.fmc * 2]] as ort.Tensor : null;
      
      const height = Math.floor(this.inputSize / stride);
      const width = Math.floor(this.inputSize / stride);
      
      // Get anchor centers
      const anchorCenters = this.getAnchorCenters(height, width, stride);
      
      // Process predictions
      const scoresData = scores.data as Float32Array;
      const bboxData = bboxPreds.data as Float32Array;
      const kpsData = kpsPreds ? (kpsPreds.data as Float32Array) : null;
      
      for (let i = 0; i < scoresData.length; i++) {
        if (scoresData[i] >= this.confThreshold) {
          scoresList.push(new Float32Array([scoresData[i]]));
          
          // Decode bbox (multiply by stride like Python)
          const bbox = this.distance2bbox(anchorCenters, bboxData, i, stride);
          bboxesList.push(bbox);
          
          // Decode keypoints if available
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
    return this.applyNMS(scoresList, bboxesList, kpssList, detScale);
  }

  private getAnchorCenters(height: number, width: number, stride: number): Float32Array {
    const key = `${height}-${width}-${stride}`;
    
    if (this.centerCache.has(key)) {
      return this.centerCache.get(key)!;
    }
    
    const centers = new Float32Array(height * width * this.numAnchors * 2);
    let idx = 0;
    
    // Same as Python: np.mgrid[:height, :width][::-1]
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
    
    // Apply stride scaling like Python
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
    const results: DetectionResult[] = [];
    
    // Convert to unified format for NMS
    const detections = scoresList.map((scores, i) => ({
      score: scores[0],
      bbox: bboxesList[i],
      kps: kpssList[i] || new Float32Array(10)
    }));
    
    // Sort by confidence (like Python)
    detections.sort((a, b) => b.score - a.score);
    
    const keep: boolean[] = new Array(detections.length).fill(true);
    
    // NMS loop
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
    
    // Convert kept detections to results (scale back to original coordinates)
    for (let i = 0; i < detections.length; i++) {
      if (keep[i]) {
        const det = detections[i];
        const bbox = det.bbox;
        
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

  dispose(): void {
    if (this.session) {
      this.session.release();
      this.session = null;
    }
    this.centerCache.clear();
  }
}
