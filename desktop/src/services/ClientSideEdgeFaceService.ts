import * as ort from 'onnxruntime-web';

interface RecognitionResult {
  personId: string | null;
  similarity: number;
  embedding: Float32Array;
}

const REFERENCE_ALIGNMENT = new Float32Array([
  38.2946, 51.6963,   // left eye
  73.5318, 51.5014,   // right eye  
  56.0252, 71.7366,   // nose
  41.5493, 92.3655,   // left mouth corner
  70.7299, 92.2041    // right mouth corner
]);

export class ClientSideEdgeFaceService {
  private session: ort.InferenceSession | null = null;
  private database: Map<string, Float32Array> = new Map();
  private similarityThreshold: number = 0.6; // 60% similarity threshold
  
  // Model specifications (matching research paper)
  private readonly INPUT_SIZE = 112; // EdgeFace input size: 112x112
  private readonly INPUT_MEAN = 127.5;
  private readonly INPUT_STD = 127.5;
  private readonly EMBEDDING_DIM = 512; // EdgeFace embedding dimension

  constructor(similarityThreshold: number = 0.6) {
    this.similarityThreshold = similarityThreshold;
  }

  async initialize(): Promise<void> {
    try {
      console.log('🚀 Initializing EdgeFace Recognition Service...');
      
      // Let ONNX.js automatically find WASM files from node_modules
      // No need to manually configure paths - it will find them automatically
      
      console.log('📁 Loading EdgeFace model from /weights/edgeface-recognition.onnx...');
      
      // Load EdgeFace ONNX model with comprehensive GPU acceleration and fallback
      try {
        this.session = await ort.InferenceSession.create('/weights/edgeface-recognition.onnx', {
          executionProviders: [
            'webgpu',    // Try WebGPU first (fastest if available)
            'webgl',     // Fallback to WebGL GPU acceleration
            'wasm'       // Final fallback to optimized CPU
          ],
          logSeverityLevel: 4,  // Minimal logging
          logVerbosityLevel: 0,
          enableCpuMemArena: true,
          enableMemPattern: true,
          executionMode: 'sequential',
          graphOptimizationLevel: 'all',
          enableProfiling: false
        });
      } catch (error) {
        console.warn('⚠️ GPU providers failed for EdgeFace, falling back to CPU-only:', error);
        // If GPU providers fail completely, use CPU-only configuration
        this.session = await ort.InferenceSession.create('/weights/edgeface-recognition.onnx', {
          executionProviders: ['wasm'],
          logSeverityLevel: 4,
          logVerbosityLevel: 0,
          enableCpuMemArena: true,
          enableMemPattern: true,
          executionMode: 'sequential',
          graphOptimizationLevel: 'all',
          enableProfiling: false
        });
      }
      
      console.log('✅ EdgeFace model loaded successfully');
      console.log('📊 EdgeFace Input Names:', this.session.inputNames);
      console.log('📊 EdgeFace Output Names:', this.session.outputNames);
      
      // Verify input/output shapes
      const inputInfo = this.session.inputNames[0];
      const outputInfo = this.session.outputNames[0];
      console.log('🔍 EdgeFace Input Info:', inputInfo);
      console.log('🔍 EdgeFace Output Info:', outputInfo);
      
    } catch (error) {
      console.error('❌ Failed to initialize EdgeFace service:', error);
      console.error('📋 Error details:', error);
      throw new Error(`EdgeFace initialization failed: ${error}`);
    }
  }

  /**
   * Extract face embedding from aligned face crop using facial landmarks
   */
  async extractEmbedding(imageData: ImageData, landmarks: number[][]): Promise<Float32Array> {
    if (!this.session) {
      throw new Error('EdgeFace service not initialized');
    }

    try {
      // Convert landmarks to required format (5 points x 2 coordinates)
      if (landmarks.length < 5) {
        throw new Error('Insufficient landmarks for face alignment (need 5 points)');
      }
      
      const landmarkPoints = new Float32Array(10);
      for (let i = 0; i < 5; i++) {
        landmarkPoints[i * 2] = landmarks[i][0];     // x coordinate
        landmarkPoints[i * 2 + 1] = landmarks[i][1]; // y coordinate
      }

      // 1. Align and crop face using landmarks
      const alignedFace = this.alignFace(imageData, landmarkPoints);
      
      // 2. Preprocess for EdgeFace model
      const inputTensor = this.preprocessImage(alignedFace);
      
      // 3. Run inference
      const feeds = { [this.session.inputNames[0]]: inputTensor };
      const results = await this.session.run(feeds);
      
      // 4. Extract and normalize embedding
      const outputTensor = results[this.session.outputNames[0]];
      const embedding = new Float32Array(outputTensor.data as Float32Array);
      
      // L2 normalization (critical for cosine similarity)
      const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= norm;
      }
      
      return embedding;
      
    } catch (error) {
      console.error('❌ Embedding extraction failed:', error);
      throw error;
    }
  }

  /**
   * Recognize face by comparing embedding with database
   */
  async recognizeFace(imageData: ImageData, landmarks: number[][]): Promise<RecognitionResult> {
    try {
      // Extract embedding from detected face
      const embedding = await this.extractEmbedding(imageData, landmarks);
      
      // Find best match in database
      const { personId, similarity } = this.findBestMatch(embedding);
      
      return {
        personId,
        similarity,
        embedding
      };
      
    } catch (error) {
      console.error('❌ Face recognition failed:', error);
      return {
        personId: null,
        similarity: 0,
        embedding: new Float32Array(this.EMBEDDING_DIM)
      };
    }
  }

  /**
   * Register a new person in the face database
   */
  async registerPerson(personId: string, imageData: ImageData, landmarks: number[][]): Promise<boolean> {
    try {
      console.log(`📝 Registering person: ${personId}`);
      
      // Extract high-quality embedding
      const embedding = await this.extractEmbedding(imageData, landmarks);
      
      // Store in database
      this.database.set(personId, embedding);
      
      console.log(`✅ Successfully registered ${personId} with ${embedding.length}D embedding`);
      return true;
      
    } catch (error) {
      console.error(`❌ Failed to register ${personId}:`, error);
      return false;
    }
  }

  /**
   * Get all registered persons
   */
  getAllPersons(): string[] {
    return Array.from(this.database.keys());
  }

  /**
   * Remove person from database
   */
  removePerson(personId: string): boolean {
    return this.database.delete(personId);
  }

  /**
   * Get database statistics
   */
  getStats() {
    return {
      totalPersons: this.database.size,
      threshold: this.similarityThreshold,
      embeddingDim: this.EMBEDDING_DIM
    };
  }

  // ================== PRIVATE METHODS ==================

  // Global static resources for maximum memory efficiency across all instances
  private static globalAlignCanvas: HTMLCanvasElement | null = null;
  private static globalSourceCanvas: HTMLCanvasElement | null = null;
  private static globalChwData: Float32Array | null = null;
  
  /**
   * Align face using 5-point similarity transform for optimal accuracy
   */
  private alignFace(imageData: ImageData, landmarks: Float32Array): ImageData {
    if (!ClientSideEdgeFaceService.globalAlignCanvas) {
      ClientSideEdgeFaceService.globalAlignCanvas = document.createElement('canvas');
      ClientSideEdgeFaceService.globalAlignCanvas.width = this.INPUT_SIZE;
      ClientSideEdgeFaceService.globalAlignCanvas.height = this.INPUT_SIZE;
    }
    
    if (!ClientSideEdgeFaceService.globalSourceCanvas) {
      ClientSideEdgeFaceService.globalSourceCanvas = document.createElement('canvas');
    }
    
    const canvas = ClientSideEdgeFaceService.globalAlignCanvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    
    const sourceCanvas = ClientSideEdgeFaceService.globalSourceCanvas;
    if (sourceCanvas.width !== imageData.width || sourceCanvas.height !== imageData.height) {
      sourceCanvas.width = imageData.width;
      sourceCanvas.height = imageData.height;
    }
    const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true })!;
    sourceCtx.putImageData(imageData, 0, 0);
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const transform = this.computeSimilarityTransform(landmarks, REFERENCE_ALIGNMENT);
    
    ctx.setTransform(
      transform[0], transform[1], 
      transform[2], transform[3], 
      transform[4], transform[5]
    );
    
    ctx.drawImage(sourceCanvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    
    return ctx.getImageData(0, 0, this.INPUT_SIZE, this.INPUT_SIZE);
  }

  /**
   * Compute similarity transform matrix from source to target landmarks
   */
  private computeSimilarityTransform(srcLandmarks: Float32Array, dstLandmarks: Float32Array): number[] {
    const numPoints = 5;
    
    let srcMeanX = 0, srcMeanY = 0, dstMeanX = 0, dstMeanY = 0;
    for (let i = 0; i < numPoints; i++) {
      srcMeanX += srcLandmarks[i * 2];
      srcMeanY += srcLandmarks[i * 2 + 1];
      dstMeanX += dstLandmarks[i * 2];
      dstMeanY += dstLandmarks[i * 2 + 1];
    }
    srcMeanX /= numPoints;
    srcMeanY /= numPoints;
    dstMeanX /= numPoints;
    dstMeanY /= numPoints;
    
    let num = 0, den = 0;
    for (let i = 0; i < numPoints; i++) {
      const srcX = srcLandmarks[i * 2] - srcMeanX;
      const srcY = srcLandmarks[i * 2 + 1] - srcMeanY;
      const dstX = dstLandmarks[i * 2] - dstMeanX;
      const dstY = dstLandmarks[i * 2 + 1] - dstMeanY;
      
      num += srcX * dstX + srcY * dstY;
      den += srcX * srcX + srcY * srcY;
    }
    
    let scale = 1;
    if (den > 1e-10) {
      scale = num / den;
    }
    
    num = 0;
    for (let i = 0; i < numPoints; i++) {
      const srcX = srcLandmarks[i * 2] - srcMeanX;
      const srcY = srcLandmarks[i * 2 + 1] - srcMeanY;
      const dstX = dstLandmarks[i * 2] - dstMeanX;
      const dstY = dstLandmarks[i * 2 + 1] - dstMeanY;
      
      num += srcX * dstY - srcY * dstX;
    }
    
    let rotation = 0;
    if (den > 1e-10) {
      rotation = num / den;
    }
    
    const a = scale;
    const b = rotation;
    const tx = dstMeanX - (a * srcMeanX - b * srcMeanY);
    const ty = dstMeanY - (b * srcMeanX + a * srcMeanY);
    
    return [a, b, -b, a, tx, ty];
  }

  /**
   * Preprocess aligned face for EdgeFace model input - ultra-optimized for speed
   */
  private preprocessImage(alignedFace: ImageData): ort.Tensor {
    const { width, height, data } = alignedFace;
    const imageSize = width * height;
    const channels = 3;
    
    // Create or reuse global CHW data array (massive memory savings)
    if (!ClientSideEdgeFaceService.globalChwData || ClientSideEdgeFaceService.globalChwData.length !== channels * imageSize) {
      ClientSideEdgeFaceService.globalChwData = new Float32Array(channels * imageSize);
    }
    
    // Get reference to reused array
    const chwData = ClientSideEdgeFaceService.globalChwData;
    const channelSize = imageSize;
    
    // Pre-compute constants for ultimate performance
    const invStd = 1.0 / this.INPUT_STD;  // Pre-compute division
    
    // Direct RGBA to CHW conversion - skips intermediate RGB array
    // This combines two operations (RGB conversion and CHW arrangement) into one
    const rOffset = 0;
    const gOffset = channelSize;
    const bOffset = channelSize * 2;
    
    // Process in large batches for maximum cache efficiency
    const MEGA_BATCH_SIZE = 1024;
    for (let batch = 0; batch < imageSize; batch += MEGA_BATCH_SIZE) {
      const batchEnd = Math.min(batch + MEGA_BATCH_SIZE, imageSize);
      
      for (let i = batch; i < batchEnd; i++) {
        const rgbaIndex = i << 2;  // Bit shift for multiplication
        
        // Convert to RGB and normalize in one step (no intermediate storage)
        const r = (data[rgbaIndex] - this.INPUT_MEAN) * invStd;         // R
        const g = (data[rgbaIndex + 1] - this.INPUT_MEAN) * invStd;     // G
        const b = (data[rgbaIndex + 2] - this.INPUT_MEAN) * invStd;     // B
        
        // Store directly in CHW format (optimal memory layout)
        chwData[rOffset + i] = r;
        chwData[gOffset + i] = g;
        chwData[bOffset + i] = b;
      }
    }
    
    // Create tensor in NCHW format [1, 3, 112, 112]
    return new ort.Tensor('float32', chwData, [1, 3, height, width]);
  }

  /**
   * Find best matching person in database using cosine similarity
   */
  private findBestMatch(queryEmbedding: Float32Array): { personId: string | null; similarity: number } {
    if (this.database.size === 0) {
      return { personId: null, similarity: 0 };
    }
    
    let bestMatch: string | null = null;
    let bestSimilarity = 0;
    
    for (const [personId, storedEmbedding] of this.database.entries()) {
      // Calculate cosine similarity (both embeddings are already normalized)
      let similarity = 0;
      for (let i = 0; i < queryEmbedding.length; i++) {
        similarity += queryEmbedding[i] * storedEmbedding[i];
      }
      
      // Update best match if similarity exceeds threshold
      if (similarity > bestSimilarity && similarity >= this.similarityThreshold) {
        bestSimilarity = similarity;
        bestMatch = personId;
      }
    }
    
    return { personId: bestMatch, similarity: bestSimilarity };
  }

  /**
   * Load face database from localStorage (for persistence)
   */
  loadDatabase(): boolean {
    try {
      const stored = localStorage.getItem('edgeface_database');
      if (stored) {
        const data = JSON.parse(stored);
        this.database.clear();
        
        for (const [personId, embeddingArray] of Object.entries(data)) {
          this.database.set(personId, new Float32Array(embeddingArray as number[]));
        }
        
        console.log(`📂 Loaded ${this.database.size} persons from database`);
        return true;
      }
    } catch (error) {
      console.error('❌ Failed to load database:', error);
    }
    return false;
  }

  /**
   * Save face database to localStorage
   */
  saveDatabase(): boolean {
    try {
      const data: Record<string, number[]> = {};
      for (const [personId, embedding] of this.database.entries()) {
        data[personId] = Array.from(embedding);
      }
      
      localStorage.setItem('edgeface_database', JSON.stringify(data));
      console.log(`💾 Saved ${this.database.size} persons to database`);
      return true;
    } catch (error) {
      console.error('❌ Failed to save database:', error);
      return false;
    }
  }
}
