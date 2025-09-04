import * as ort from 'onnxruntime-node';
import { join } from 'path';
import type { SerializableImageData } from './ScrfdDetectionService.js';

export interface FaceEmbedding {
  personId: string;
  embedding: Float32Array;
  confidence: number;
}

export interface RecognitionResult {
  personId: string | null;
  similarity: number;
  embedding: Float32Array;
}

// Reference facial landmarks for alignment (from EdgeFace paper - optimized for pose variations)
const REFERENCE_FACIAL_POINTS = [
  [38.2946, 51.6963],   // Left eye
  [73.5318, 51.5014],   // Right eye  
  [56.0252, 71.7366],   // Nose tip
  [41.5493, 92.3655],   // Left mouth corner
  [70.7299, 92.2041]    // Right mouth corner
];

export class EdgeFaceRecognitionService {
  private session: ort.InferenceSession | null = null;
  private faceDatabase = new Map<string, Float32Array>();
  private similarityThreshold = 0.65; // Increased for better precision with pose variations
  
  private readonly inputMean = 127.5;
  private readonly inputStd = 127.5;
  private readonly inputSize = 112;

  async initialize(modelPath?: string, threshold = 0.6): Promise<void> {
    try {
      const weightsPath = modelPath || join(__dirname, '../../weights/edgeface-recognition.onnx');
      console.log('Loading EdgeFace model from:', weightsPath);
      
      // Check if file exists
      const fs = await import('fs');
      if (!fs.existsSync(weightsPath)) {
        throw new Error(`EdgeFace model file not found at: ${weightsPath}`);
      }
      
      this.session = await ort.InferenceSession.create(weightsPath, {
        executionProviders: ['cpu']
      });
      
      this.similarityThreshold = threshold;
      console.log('EdgeFace model loaded successfully');
      console.log('Input names:', this.session.inputNames);
      console.log('Output names:', this.session.outputNames);
    } catch (error) {
      console.error('Failed to load EdgeFace model:', error);
      throw error;
    }
  }

  async extractEmbedding(imageData: SerializableImageData, landmarks: number[][]): Promise<Float32Array> {
    if (!this.session) {
      throw new Error('EdgeFace model not initialized');
    }

    // Align face using landmarks with improved similarity transform
    const alignedFace = this.alignFace(imageData, landmarks);
    
    // For better pose robustness, extract embeddings at multiple scales
    const embeddings = [];
    
    // Main embedding at standard size (112x112)
    const mainTensor = this.preprocessFace(alignedFace);
    const mainFeeds = { [this.session.inputNames[0]]: mainTensor };
    const mainOutputs = await this.session.run(mainFeeds);
    const mainEmbedding = mainOutputs[this.session.outputNames[0]].data as Float32Array;
    embeddings.push(this.normalizeEmbedding(mainEmbedding));
    
    // Additional embedding at slightly larger crop (if pose quality is low)
    const poseQuality = this.calculatePoseQuality(landmarks);
    if (poseQuality < 0.95) {
      // Create slightly larger crop for better context in tilted faces
      const enlargedFace = this.createEnlargedCrop(imageData, landmarks);
      const enlargedTensor = this.preprocessFace(enlargedFace);
      const enlargedFeeds = { [this.session.inputNames[0]]: enlargedTensor };
      const enlargedOutputs = await this.session.run(enlargedFeeds);
      const enlargedEmbedding = enlargedOutputs[this.session.outputNames[0]].data as Float32Array;
      embeddings.push(this.normalizeEmbedding(enlargedEmbedding));
    }
    
    // Return average of embeddings (ensemble approach)
    if (embeddings.length === 1) {
      return embeddings[0];
    }
    
    const avgEmbedding = new Float32Array(embeddings[0].length);
    for (let i = 0; i < avgEmbedding.length; i++) {
      let sum = 0;
      for (const embedding of embeddings) {
        sum += embedding[i];
      }
      avgEmbedding[i] = sum / embeddings.length;
    }
    
    return this.normalizeEmbedding(avgEmbedding);
  }

  async recognizeFace(imageData: SerializableImageData, landmarks: number[][]): Promise<RecognitionResult> {
    const embedding = await this.extractEmbedding(imageData, landmarks);
    
    if (this.faceDatabase.size === 0) {
      return {
        personId: null,
        similarity: 0.0,
        embedding
      };
    }
    
    let bestMatch: string | null = null;
    let bestSimilarity = 0.0;
    
    // Calculate pose quality factor for adaptive thresholding
    const poseQuality = this.calculatePoseQuality(landmarks);
    const adaptiveThreshold = this.similarityThreshold * poseQuality;
    
    // Compare with all stored embeddings
    for (const [personId, storedEmbedding] of this.faceDatabase) {
      const similarity = this.cosineSimilarity(embedding, storedEmbedding);
      
      if (similarity > bestSimilarity && similarity >= adaptiveThreshold) {
        bestSimilarity = similarity;
        bestMatch = personId;
      }
    }
    
    return {
      personId: bestMatch,
      similarity: bestSimilarity,
      embedding
    };
  }

  addPerson(personId: string, embedding: Float32Array): void {
    this.faceDatabase.set(personId, embedding);
    console.log(`Added person '${personId}' to face database`);
  }

  removePerson(personId: string): boolean {
    const removed = this.faceDatabase.delete(personId);
    if (removed) {
      console.log(`Removed person '${personId}' from face database`);
    }
    return removed;
  }

  getAllPersons(): string[] {
    return Array.from(this.faceDatabase.keys());
  }

  getDatabaseSize(): number {
    return this.faceDatabase.size;
  }

  private alignFace(imageData: SerializableImageData, landmarks: number[][]): SerializableImageData {
    if (landmarks.length !== 5) {
      throw new Error('Expected 5 facial landmarks for alignment');
    }
    
    // Estimate transformation matrix
    const { matrix } = this.estimateNorm(landmarks);
    
    // Apply transformation
    return this.warpAffine(imageData, matrix, this.inputSize, this.inputSize);
  }

  private createEnlargedCrop(imageData: SerializableImageData, landmarks: number[][]): SerializableImageData {
    // Create a larger crop for tilted faces to capture more facial context
    const enlargeFactor = 1.2; // 20% larger crop
    
    // Calculate enlarged reference points
    const enlargedRefPoints = REFERENCE_FACIAL_POINTS.map(point => [
      point[0] * enlargeFactor + (this.inputSize * (1 - enlargeFactor)) / 2,
      point[1] * enlargeFactor + (this.inputSize * (1 - enlargeFactor)) / 2
    ]);
    
    // Estimate transformation for enlarged crop
    const srcPoints = landmarks.map(point => [point[0], point[1]]);
    const transform = this.estimateSimilarityTransform(srcPoints, enlargedRefPoints);
    
    // Apply transformation with enlarged context
    return this.warpAffine(imageData, transform, this.inputSize, this.inputSize);
  }

  private estimateNorm(landmarks: number[][]): { matrix: number[][]; index: number } {
    if (landmarks.length !== 5) {
      throw new Error('Expected exactly 5 facial landmarks for proper alignment');
    }
    
    // Convert landmarks to matrix format
    const srcPoints = landmarks.map(point => [point[0], point[1]]);
    
    // Use proper similarity transform with all 5 landmarks for better pose handling
    const transform = this.estimateSimilarityTransform(srcPoints, REFERENCE_FACIAL_POINTS);
    
    return {
      matrix: transform,
      index: 0
    };
  }

  private estimateSimilarityTransform(srcPoints: number[][], dstPoints: number[][]): number[][] {
    // Implement least squares similarity transform estimation
    // This handles rotation, translation, and uniform scaling - crucial for pose variations
    
    const n = srcPoints.length;
    if (n < 2) {
      throw new Error('Need at least 2 points for similarity transform');
    }
    
    // Calculate centroids
    let srcCentroidX = 0, srcCentroidY = 0;
    let dstCentroidX = 0, dstCentroidY = 0;
    
    for (let i = 0; i < n; i++) {
      srcCentroidX += srcPoints[i][0];
      srcCentroidY += srcPoints[i][1];
      dstCentroidX += dstPoints[i][0];
      dstCentroidY += dstPoints[i][1];
    }
    
    srcCentroidX /= n;
    srcCentroidY /= n;
    dstCentroidX /= n;
    dstCentroidY /= n;
    
    // Center the points
    const srcCentered = srcPoints.map(p => [p[0] - srcCentroidX, p[1] - srcCentroidY]);
    const dstCentered = dstPoints.map(p => [p[0] - dstCentroidX, p[1] - dstCentroidY]);
    
    // Calculate similarity transform parameters
    let num = 0, den = 0;
    let a = 0;
    
    for (let i = 0; i < n; i++) {
      const srcX = srcCentered[i][0];
      const srcY = srcCentered[i][1];
      const dstX = dstCentered[i][0];
      const dstY = dstCentered[i][1];
      
      num += srcX * dstX + srcY * dstY;
      den += srcX * srcX + srcY * srcY;
      a += srcX * dstY - srcY * dstX;
    }
    
    if (den === 0) {
      // Fallback to identity transform
      return [
        [1, 0, 0],
        [0, 1, 0]
      ];
    }
    
    const scale = num / den;
    const rotation = a / den;
    
    // Calculate translation
    const tx = dstCentroidX - scale * srcCentroidX - rotation * srcCentroidY;
    const ty = dstCentroidY + rotation * srcCentroidX - scale * srcCentroidY;
    
    // Return transformation matrix [scale*cos(θ), -scale*sin(θ), tx; scale*sin(θ), scale*cos(θ), ty]
    return [
      [scale, -rotation, tx],
      [rotation, scale, ty]
    ];
  }

  private warpAffine(imageData: SerializableImageData, matrix: number[][], width: number, height: number): SerializableImageData {
    const { data: srcData, width: srcWidth, height: srcHeight } = imageData;
    const dstData = new Uint8ClampedArray(width * height * 4);
    
    // Inverse transformation matrix
    const det = matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
    const invMatrix = [
      [matrix[1][1] / det, -matrix[0][1] / det, (matrix[0][1] * matrix[1][2] - matrix[1][1] * matrix[0][2]) / det],
      [-matrix[1][0] / det, matrix[0][0] / det, (matrix[1][0] * matrix[0][2] - matrix[0][0] * matrix[1][2]) / det]
    ];
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Apply inverse transformation
        const srcX = invMatrix[0][0] * x + invMatrix[0][1] * y + invMatrix[0][2];
        const srcY = invMatrix[1][0] * x + invMatrix[1][1] * y + invMatrix[1][2];
        
        const dstIdx = (y * width + x) * 4;
        
        if (srcX >= 0 && srcX < srcWidth - 1 && srcY >= 0 && srcY < srcHeight - 1) {
          // Bilinear interpolation
          const x1 = Math.floor(srcX);
          const y1 = Math.floor(srcY);
          const x2 = x1 + 1;
          const y2 = y1 + 1;
          
          const fx = srcX - x1;
          const fy = srcY - y1;
          
          for (let c = 0; c < 4; c++) {
            const tl = srcData[(y1 * srcWidth + x1) * 4 + c];
            const tr = srcData[(y1 * srcWidth + x2) * 4 + c];
            const bl = srcData[(y2 * srcWidth + x1) * 4 + c];
            const br = srcData[(y2 * srcWidth + x2) * 4 + c];
            
            const top = tl * (1 - fx) + tr * fx;
            const bottom = bl * (1 - fx) + br * fx;
            const pixel = top * (1 - fy) + bottom * fy;
            
            dstData[dstIdx + c] = Math.round(pixel);
          }
        } else {
          // Fill with black for out-of-bounds pixels
          dstData[dstIdx] = 0;     // R
          dstData[dstIdx + 1] = 0; // G
          dstData[dstIdx + 2] = 0; // B
          dstData[dstIdx + 3] = 255; // A
        }
      }
    }
    
    return {
      data: dstData,
      width: width,
      height: height,
      colorSpace: imageData.colorSpace
    };
  }

  private preprocessFace(alignedFace: SerializableImageData): ort.Tensor {
    const { data, width, height } = alignedFace;
    const tensorData = new Float32Array(3 * this.inputSize * this.inputSize);
    
    // Convert RGBA to RGB and normalize (EdgeFace expects RGB format like Python)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = (y * width + x) * 4;
        const dstIdx = y * width + x;
        
        // Get RGB values from RGBA
        const r = data[srcIdx];     // R
        const g = data[srcIdx + 1]; // G  
        const b = data[srcIdx + 2]; // B
        
        // Normalize using EdgeFace parameters (same as Python implementation)
        // EdgeFace uses mean=127.5, std=127.5 for [-1, 1] normalization
        tensorData[dstIdx] = (r - this.inputMean) / this.inputStd; // R channel
        tensorData[this.inputSize * this.inputSize + dstIdx] = (g - this.inputMean) / this.inputStd; // G channel
        tensorData[2 * this.inputSize * this.inputSize + dstIdx] = (b - this.inputMean) / this.inputStd; // B channel
      }
    }
    
    return new ort.Tensor('float32', tensorData, [1, 3, this.inputSize, this.inputSize]);
  }

  private normalizeEmbedding(embedding: Float32Array): Float32Array {
    // L2 normalization
    let norm = 0;
    for (let i = 0; i < embedding.length; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);
    
    const normalized = new Float32Array(embedding.length);
    for (let i = 0; i < embedding.length; i++) {
      normalized[i] = embedding[i] / norm;
    }
    
    return normalized;
  }

  private cosineSimilarity(embedding1: Float32Array, embedding2: Float32Array): number {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings must have the same length');
    }
    
    let dotProduct = 0;
    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
    }

    // Since embeddings are already normalized, the dot product is the cosine similarity
    return dotProduct;
  }

  private calculatePoseQuality(landmarks: number[][]): number {
    if (landmarks.length !== 5) return 0.8; // Default quality for incomplete landmarks
    
    // Calculate pose quality based on facial landmark geometry
    const leftEye = landmarks[0];
    const rightEye = landmarks[1];
    const nose = landmarks[2];
    const leftMouth = landmarks[3];
    const rightMouth = landmarks[4];
    
    // Calculate eye distance and mouth distance
    const eyeDistance = Math.sqrt(
      Math.pow(rightEye[0] - leftEye[0], 2) + Math.pow(rightEye[1] - leftEye[1], 2)
    );
    const mouthDistance = Math.sqrt(
      Math.pow(rightMouth[0] - leftMouth[0], 2) + Math.pow(rightMouth[1] - leftMouth[1], 2)
    );
    
    // Calculate ideal ratios for frontal face
    const eyeMouthRatio = mouthDistance / eyeDistance;
    const idealRatio = 0.6; // Approximate ratio for frontal face
    const ratioDeviation = Math.abs(eyeMouthRatio - idealRatio) / idealRatio;
    
    // Calculate nose position relative to eyes (should be centered for frontal view)
    const eyeCenterX = (leftEye[0] + rightEye[0]) / 2;
    const noseOffset = Math.abs(nose[0] - eyeCenterX) / eyeDistance;
    
    // Calculate quality factor (higher = more frontal, lower = more profile)
    const geometryQuality = Math.exp(-ratioDeviation * 2) * Math.exp(-noseOffset * 3);
    
    // Adaptive threshold: lower threshold for side views, higher for frontal
    // Range: 0.85-1.0 (frontal gets normal threshold, profile gets relaxed threshold)
    return Math.max(0.85, Math.min(1.0, 0.85 + geometryQuality * 0.15));
  }

  dispose(): void {
    if (this.session) {
      this.session.release();
      this.session = null;
    }
    this.faceDatabase.clear();
  }
}
