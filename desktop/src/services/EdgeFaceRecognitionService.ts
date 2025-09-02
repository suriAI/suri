import * as ort from 'onnxruntime-node';
import { join } from 'path';

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

// Reference facial landmarks for alignment (same as Python implementation)
const REFERENCE_ALIGNMENT = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041]
];

export class EdgeFaceRecognitionService {
  private session: ort.InferenceSession | null = null;
  private faceDatabase = new Map<string, Float32Array>();
  private similarityThreshold = 0.6;
  
  private readonly inputMean = 127.5;
  private readonly inputStd = 127.5;
  private readonly inputSize = 112;

  async initialize(modelPath?: string, threshold = 0.6): Promise<void> {
    try {
      const weightsPath = modelPath || join(__dirname, '../../weights/edgeface-recognition.onnx');
      console.log('Loading EdgeFace model from:', weightsPath);
      
      this.session = await ort.InferenceSession.create(weightsPath, {
        executionProviders: ['cpu']
      });
      
      this.similarityThreshold = threshold;
      console.log('EdgeFace model loaded successfully');
    } catch (error) {
      console.error('Failed to load EdgeFace model:', error);
      throw error;
    }
  }

  async extractEmbedding(imageData: ImageData, landmarks: number[][]): Promise<Float32Array> {
    if (!this.session) {
      throw new Error('EdgeFace model not initialized');
    }

    // Align face using landmarks
    const alignedFace = this.alignFace(imageData, landmarks);
    
    // Preprocess for model input
    const tensor = this.preprocessFace(alignedFace);
    
    // Run inference
    const feeds = { [this.session.inputNames[0]]: tensor };
    const outputs = await this.session.run(feeds);
    
    // Get embedding and normalize
    const embedding = outputs[this.session.outputNames[0]].data as Float32Array;
    return this.normalizeEmbedding(embedding);
  }

  async recognizeFace(imageData: ImageData, landmarks: number[][]): Promise<RecognitionResult> {
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
    
    // Compare with all stored embeddings
    for (const [personId, storedEmbedding] of this.faceDatabase) {
      const similarity = this.cosineSimilarity(embedding, storedEmbedding);
      
      if (similarity > bestSimilarity && similarity >= this.similarityThreshold) {
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

  private alignFace(imageData: ImageData, landmarks: number[][]): ImageData {
    if (landmarks.length !== 5) {
      throw new Error('Expected 5 facial landmarks for alignment');
    }
    
    // Convert landmarks to the format expected by alignment
    const landmarkArray = landmarks.flat();
    
    // Estimate transformation matrix
    const { matrix } = this.estimateNorm(landmarks);
    
    // Apply transformation
    return this.warpAffine(imageData, matrix, this.inputSize, this.inputSize);
  }

  private estimateNorm(landmarks: number[][]): { matrix: number[][]; index: number } {
    // Simplified transformation estimation
    // In a full implementation, you would use proper similarity transform
    
    // For now, use a simple scaling and translation based on eye distance
    const leftEye = landmarks[0];
    const rightEye = landmarks[1];
    
    const eyeDistance = Math.sqrt(
      Math.pow(rightEye[0] - leftEye[0], 2) + 
      Math.pow(rightEye[1] - leftEye[1], 2)
    );
    
    const targetEyeDistance = 73.5318 - 38.2946; // From reference alignment
    const scale = targetEyeDistance / eyeDistance;
    
    const eyeCenterX = (leftEye[0] + rightEye[0]) / 2;
    const eyeCenterY = (leftEye[1] + rightEye[1]) / 2;
    
    const targetCenterX = (38.2946 + 73.5318) / 2;
    const targetCenterY = (51.6963 + 51.5014) / 2;
    
    const tx = targetCenterX - eyeCenterX * scale;
    const ty = targetCenterY - eyeCenterY * scale;
    
    return {
      matrix: [
        [scale, 0, tx],
        [0, scale, ty]
      ],
      index: 0
    };
  }

  private warpAffine(imageData: ImageData, matrix: number[][], width: number, height: number): ImageData {
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
    
    return new ImageData(dstData, width, height);
  }

  private preprocessFace(alignedFace: ImageData): ort.Tensor {
    const { data, width, height } = alignedFace;
    const tensorData = new Float32Array(3 * this.inputSize * this.inputSize);
    
    // Convert RGBA to RGB and normalize
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = (y * width + x) * 4;
        const dstIdx = y * width + x;
        
        // Normalize to [-1, 1] range
        const r = (data[srcIdx] - this.inputMean) / this.inputStd;
        const g = (data[srcIdx + 1] - this.inputMean) / this.inputStd;
        const b = (data[srcIdx + 2] - this.inputMean) / this.inputStd;
        
        // Store in CHW format
        tensorData[dstIdx] = r;
        tensorData[this.inputSize * this.inputSize + dstIdx] = g;
        tensorData[2 * this.inputSize * this.inputSize + dstIdx] = b;
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
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }
    
    // Since embeddings are already normalized, we can just return the dot product
    return dotProduct;
  }

  dispose(): void {
    if (this.session) {
      this.session.release();
      this.session = null;
    }
    this.faceDatabase.clear();
  }
}
