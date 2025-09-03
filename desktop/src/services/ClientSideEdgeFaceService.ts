import * as ort from 'onnxruntime-web';

interface RecognitionResult {
  personId: string | null;
  similarity: number;
  embedding: Float32Array;
}

// Reference facial landmarks for alignment (matching research paper)
// Currently unused but kept for future similarity transform implementation
// const REFERENCE_ALIGNMENT = new Float32Array([
//   38.2946, 51.6963,   // left eye
//   73.5318, 51.5014,   // right eye  
//   56.0252, 71.7366,   // nose
//   41.5493, 92.3655,   // left mouth corner
//   70.7299, 92.2041    // right mouth corner
// ]);

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
      
      // Load EdgeFace ONNX model with simpler configuration
      this.session = await ort.InferenceSession.create('/weights/edgeface-recognition.onnx', {
        executionProviders: ['wasm']
      });
      
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

  // Reuse canvases for better performance
  private alignCanvas: HTMLCanvasElement | null = null;
  private sourceCanvas: HTMLCanvasElement | null = null;
  
  /**
   * Align face using facial landmarks (matching Python implementation)
   */
  private alignFace(imageData: ImageData, landmarks: Float32Array): ImageData {
    // Create reusable canvases
    if (!this.alignCanvas) {
      this.alignCanvas = document.createElement('canvas');
      this.alignCanvas.width = this.INPUT_SIZE;
      this.alignCanvas.height = this.INPUT_SIZE;
    }
    
    if (!this.sourceCanvas) {
      this.sourceCanvas = document.createElement('canvas');
    }
    
    const canvas = this.alignCanvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    
    // Reuse source canvas but update dimensions if needed
    const sourceCanvas = this.sourceCanvas;
    if (sourceCanvas.width !== imageData.width || sourceCanvas.height !== imageData.height) {
      sourceCanvas.width = imageData.width;
      sourceCanvas.height = imageData.height;
    }
    const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true })!;
    sourceCtx.putImageData(imageData, 0, 0);
    
    // Clear the alignment canvas for reuse
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Calculate eye positions (optimized)
    const leftEye = [landmarks[0], landmarks[1]];
    const rightEye = [landmarks[2], landmarks[3]];
    
    // Calculate eye center and angle (no change)
    const eyeCenterX = (leftEye[0] + rightEye[0]) / 2;
    const eyeCenterY = (leftEye[1] + rightEye[1]) / 2;
    const eyeAngle = Math.atan2(rightEye[1] - leftEye[1], rightEye[0] - leftEye[0]);
    
    // Calculate scale (simplified)
    const dx = rightEye[0] - leftEye[0];
    const dy = rightEye[1] - leftEye[1];
    const eyeDistance = Math.sqrt(dx * dx + dy * dy);
    const targetEyeDistance = 40; // Target distance in 112x112 image
    const scale = targetEyeDistance / eyeDistance;
    
    // Apply transformation
    ctx.save();
    ctx.translate(this.INPUT_SIZE / 2, this.INPUT_SIZE / 2);
    ctx.rotate(-eyeAngle);
    ctx.scale(scale, scale);
    ctx.translate(-eyeCenterX, -eyeCenterY);
    ctx.drawImage(sourceCanvas, 0, 0);
    ctx.restore();
    
    return ctx.getImageData(0, 0, this.INPUT_SIZE, this.INPUT_SIZE);
  }

  // Reuse Float32Arrays to avoid memory allocations
  private rgbData: Float32Array | null = null;
  private chwData: Float32Array | null = null;
  
  /**
   * Preprocess aligned face for EdgeFace model input - optimized for speed
   */
  private preprocessImage(alignedFace: ImageData): ort.Tensor {
    const { width, height, data } = alignedFace;
    const imageSize = width * height;
    const channels = 3;
    
    // Create or reuse RGB data array
    if (!this.rgbData || this.rgbData.length !== channels * imageSize) {
      this.rgbData = new Float32Array(channels * imageSize);
    }
    
    // Create or reuse CHW data array
    if (!this.chwData || this.chwData.length !== channels * imageSize) {
      this.chwData = new Float32Array(channels * imageSize);
    }
    
    // Get reference to reused array
    const chwData = this.chwData;
    const channelSize = imageSize;
    
    // Direct RGBA to CHW conversion - skips intermediate RGB array
    // This combines two operations (RGB conversion and CHW arrangement) into one
    const rOffset = 0;
    const gOffset = channelSize;
    const bOffset = channelSize * 2;
    
    // Process in batches of pixels for better cache locality
    const BATCH_SIZE = 128;
    for (let batch = 0; batch < imageSize; batch += BATCH_SIZE) {
      const batchEnd = Math.min(batch + BATCH_SIZE, imageSize);
      
      for (let i = batch; i < batchEnd; i++) {
        const rgbaIndex = i * 4;
        
        // Convert to RGB and normalize in one step
        const r = (data[rgbaIndex] - this.INPUT_MEAN) / this.INPUT_STD;         // R
        const g = (data[rgbaIndex + 1] - this.INPUT_MEAN) / this.INPUT_STD;     // G
        const b = (data[rgbaIndex + 2] - this.INPUT_MEAN) / this.INPUT_STD;     // B
        
        // Store directly in CHW format
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
