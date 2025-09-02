import { ScrfdDetectionService } from './ScrfdDetectionService.js';
import type { DetectionResult } from './ScrfdDetectionService.js';
import { EdgeFaceRecognitionService } from './EdgeFaceRecognitionService.js';
import type { RecognitionResult } from './EdgeFaceRecognitionService.js';

export interface PipelineResult {
  detections: Array<{
    bbox: [number, number, number, number];
    confidence: number;
    landmarks: number[][];
    recognition?: {
      personId: string | null;
      similarity: number;
    };
  }>;
  processingTime: number;
}

export class FaceRecognitionPipeline {
  private detectionService: ScrfdDetectionService;
  private recognitionService: EdgeFaceRecognitionService;
  private isInitialized = false;

  constructor() {
    this.detectionService = new ScrfdDetectionService();
    this.recognitionService = new EdgeFaceRecognitionService();
  }

  async initialize(options?: {
    detectionModelPath?: string;
    recognitionModelPath?: string;
    similarityThreshold?: number;
  }): Promise<void> {
    try {
      console.log('Initializing face recognition pipeline...');
      
      // Initialize both services
      await Promise.all([
        this.detectionService.initialize(options?.detectionModelPath),
        this.recognitionService.initialize(options?.recognitionModelPath, options?.similarityThreshold)
      ]);
      
      this.isInitialized = true;
      console.log('Face recognition pipeline initialized successfully');
    } catch (error) {
      console.error('Failed to initialize face recognition pipeline:', error);
      throw error;
    }
  }

  async processFrame(imageData: ImageData): Promise<PipelineResult> {
    if (!this.isInitialized) {
      throw new Error('Pipeline not initialized');
    }

    const startTime = performance.now();

    try {
      // Step 1: Detect faces
      const detections = await this.detectionService.detect(imageData);
      
      // Removed console logging for better performance
      
      // Step 2: Recognize each detected face
      const results = await Promise.all(
        detections.map(async (detection: DetectionResult) => {
          let recognition: RecognitionResult | undefined;
          
          try {
            // Only attempt recognition if we have valid landmarks
            if (detection.landmarks && detection.landmarks.length === 5) {
              recognition = await this.recognitionService.recognizeFace(imageData, detection.landmarks);
            }
          } catch (error) {
            // Skip logging for better performance
          }
          
          return {
            bbox: detection.bbox,
            confidence: detection.confidence,
            landmarks: detection.landmarks,
            recognition: recognition ? {
              personId: recognition.personId,
              similarity: recognition.similarity
            } : undefined
          };
        })
      );

      const processingTime = performance.now() - startTime;

      return {
        detections: results,
        processingTime
      };
    } catch (error) {
      // Return empty result for better performance 
      return {
        detections: [],
        processingTime: performance.now() - startTime
      };
    }
  }

  async registerPerson(personId: string, imageData: ImageData, landmarks: number[][]): Promise<boolean> {
    try {
      const embedding = await this.recognitionService.extractEmbedding(imageData, landmarks);
      this.recognitionService.addPerson(personId, embedding);
      return true;
    } catch (error) {
      console.error('Failed to register person:', error);
      return false;
    }
  }

  removePerson(personId: string): boolean {
    return this.recognitionService.removePerson(personId);
  }

  getAllPersons(): string[] {
    return this.recognitionService.getAllPersons();
  }

  getDatabaseSize(): number {
    return this.recognitionService.getDatabaseSize();
  }

  dispose(): void {
    this.detectionService.dispose();
    this.recognitionService.dispose();
    this.isInitialized = false;
  }
}
