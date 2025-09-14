// WebWorker for face detection and recognition to avoid main thread blocking
import { WebScrfdService } from "./WebScrfdService.js";
import { WebFaceService } from "./WebFaceService.js";
import { WebAntiSpoofingService } from "./WebAntiSpoofingService.js";

let scrfdService: WebScrfdService | null = null;
let edgeFaceService: WebFaceService | null = null;
let antiSpoofingService: WebAntiSpoofingService | null = null;
let storedModelBuffers: Record<string, ArrayBuffer> | null = null;

// ULTRA-AGGRESSIVE OPTIMIZATION: Pre-instantiate services for zero-delay initialization
let prewarmStarted = false;
const prewarmServices = () => {
  if (prewarmStarted) return;
  prewarmStarted = true;
  
  // Pre-instantiate services immediately (before models are even loaded)
  scrfdService = new WebScrfdService();
  edgeFaceService = new WebFaceService(0.6);
  // Anti-spoofing stays lazy for memory efficiency
  
  console.log('🚀 ULTRA-OPTIMIZED: Services pre-instantiated for zero-delay init');
};

// Start prewarming immediately when worker loads
prewarmServices();

self.onmessage = async (event) => {
  const { type, data, id } = event.data;
  
  try {
    switch (type) {
      case 'init': {
        // ULTRA-OPTIMIZED: Use pre-instantiated services for zero-delay initialization
        const { modelBuffers } = data;
        storedModelBuffers = modelBuffers; // Store for lazy initialization

        // Services are already pre-instantiated, just initialize with models
        const initStart = performance.now();
        
        // Parallel initialization with pre-loaded buffers (services already exist)
        await Promise.all([
          scrfdService!.initialize(modelBuffers?.['scrfd_2.5g_kps_640x640.onnx']),
          edgeFaceService!.initialize(modelBuffers?.['edgeface-recognition.onnx'])
        ]);
        
        const initTime = performance.now() - initStart;
        console.log(`⚡ ULTRA-OPTIMIZED: Worker models initialized in ${initTime.toFixed(0)}ms`);
        
        // Don't load database here - we'll get it from main thread
        
        self.postMessage({ type: 'init-complete', id });
        break;
      }

      case 'load-database-from-main': {
        if (!edgeFaceService) {
          throw new Error('EdgeFace service not initialized');
        }
        
        const { databaseData } = data;
        
        // Load database using the public method
        const success = edgeFaceService.loadDatabaseFromData(databaseData || {});
        
        self.postMessage({ 
          type: 'database-loaded', 
          data: { success, count: edgeFaceService.getStats().totalPersons },
          id
        });
        break;
      }

      case 'get-database-for-main': {
        if (!edgeFaceService) {
          throw new Error('EdgeFace service not initialized');
        }
        
        // Export database using the public method
        const databaseData = edgeFaceService.exportDatabase();
        
        self.postMessage({ 
          type: 'database-export', 
          data: { databaseData },
          id
        });
        break;
      }
        
      case 'detect': {
        if (!scrfdService) {
          throw new Error('SCRFD service not initialized');
        }
        
        const { imageData } = data;
        const detections = await scrfdService.detect(imageData);
        
        self.postMessage({ 
          type: 'detection-result', 
          data: { detections },
          id
        });
        break;
      }

      case 'detect-and-recognize': {
        if (!scrfdService || !edgeFaceService) {
          throw new Error('Services not initialized');
        }
        
        const { imageData } = data;
        
        // First detect faces
        const detections = await scrfdService.detect(imageData);
        
        // Filter out low confidence detections early (major performance boost)
        const minConfidence = 0.5;
        const validDetections = detections.filter(det => det.confidence >= minConfidence);
        
        // Early exit if no valid faces (saves compute time)
        if (validDetections.length === 0) {
          self.postMessage({ 
            type: 'detection-and-recognition-result', 
            data: { detections: [] },
            id
          });
          break;
        }
        
        // Process all detections and run recognition on each face
        const detectionsWithRecognition = [];
        
        for (const detection of validDetections) {
          let recognitionResult: {
            personId: string | null;
            similarity: number;
          } = {
            personId: null,
            similarity: 0
          };
          
          // Run recognition on all faces that have valid landmarks
          if (detection.landmarks && detection.landmarks.length >= 5) {
            try {
              const result = await edgeFaceService.recognizeFace(imageData, detection.landmarks);
              recognitionResult = {
                personId: result.personId,
                similarity: result.similarity
              };
            } catch {
              // Silent fail - keep default values
            }
          }
          
          detectionsWithRecognition.push({
            bbox: detection.bbox,
            confidence: detection.confidence,
            landmarks: detection.landmarks,
            recognition: recognitionResult
          });
        }
        
        self.postMessage({ 
          type: 'detection-and-recognition-result', 
          data: { detections: detectionsWithRecognition },
          id
        });
        break;
      }

      case 'register-person': {
        if (!edgeFaceService) {
          throw new Error('EdgeFace service not initialized');
        }
        
        const { personId, imageData, landmarks } = data;
        const success = await edgeFaceService.registerPerson(personId, imageData, landmarks);
        
        if (success) {
          // Don't save here - notify main thread to save database
          self.postMessage({ 
            type: 'database-changed', 
            data: { action: 'register', personId }
          });
        }
        
        self.postMessage({ 
          type: 'register-result', 
          data: { success },
          id
        });
        break;
      }

      case 'recognize-face': {
        if (!edgeFaceService) {
          throw new Error('EdgeFace service not initialized');
        }
        
        const { imageData, landmarks } = data;
        const result = await edgeFaceService.recognizeFace(imageData, landmarks);
        
        self.postMessage({ 
          type: 'recognition-result', 
          data: { 
            personId: result.personId, 
            similarity: result.similarity 
          },
          id
        });
        break;
      }

      case 'get-all-persons': {
        if (!edgeFaceService) {
          throw new Error('EdgeFace service not initialized');
        }
        
        const persons = edgeFaceService.getAllPersons();
        
        self.postMessage({ 
          type: 'persons-list', 
          data: { persons },
          id
        });
        break;
      }

      case 'remove-person': {
        if (!edgeFaceService) {
          throw new Error('EdgeFace service not initialized');
        }
        
        const { personId } = data;
        const success = edgeFaceService.removePerson(personId);
        
        if (success) {
          // Don't save here - notify main thread to save database
          self.postMessage({ 
            type: 'database-changed', 
            data: { action: 'remove', personId }
          });
        }
        
        self.postMessage({ 
          type: 'removal-result', 
          data: { success },
          id
        });
        break;
      }

      case 'save-database': {
        if (!edgeFaceService) {
          throw new Error('EdgeFace service not initialized');
        }
        
        const success = edgeFaceService.saveDatabase();
        
        self.postMessage({ 
          type: 'save-result', 
          data: { success },
          id
        });
        break;
      }

      case 'load-database': {
        if (!edgeFaceService) {
          throw new Error('EdgeFace service not initialized');
        }
        
        const success = edgeFaceService.loadDatabase();
        
        self.postMessage({ 
          type: 'load-result', 
          data: { success },
          id
        });
        break;
      }

      case 'get-stats': {
        if (!edgeFaceService) {
          throw new Error('EdgeFace service not initialized');
        }
        
        const stats = edgeFaceService.getStats();
        self.postMessage({ 
          type: 'stats-result', 
          data: { stats },
          id
        });
        break;
      }

      case 'clear-cache': {
        if (!edgeFaceService) {
          throw new Error('EdgeFace service not initialized');
        }
        
        edgeFaceService.clearCache();
        self.postMessage({ 
          type: 'cache-cleared', 
          data: { success: true },
          id
        });
        break;
      }

      case 'anti-spoofing-detect': {
        // Lazy initialization of anti-spoofing service (only when needed for recognized faces)
        if (!antiSpoofingService) {
          console.log('🔄 Lazy initializing anti-spoofing service...');
          antiSpoofingService = new WebAntiSpoofingService();
          await antiSpoofingService.initialize(storedModelBuffers?.['anti_spoofing.onnx']);
          console.log('✅ Anti-spoofing service lazy initialized');
        }
        
        const { imageData } = data;
        const result = await antiSpoofingService.detectLiveness(imageData);
        
        self.postMessage({ 
          type: 'anti-spoofing-result', 
          data: result,
          id
        });
        break;
      }
        
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    self.postMessage({ 
      type: 'error', 
      data: { 
        message: error instanceof Error ? error.message : 'Unknown error' 
      },
      id
    });
  }
};
