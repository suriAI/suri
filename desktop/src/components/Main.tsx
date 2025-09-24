import { useState, useRef, useCallback, useEffect } from "react";
import { WorkerManager } from "../services/WorkerManager";
import { faceLogService, type FaceLogEntry } from "../services/FaceLogService";
import { FaceDeduplicationService } from "../services/FaceDeduplicationService";
import { FaceTrackingService, type TrackedFace } from "../services/FaceTrackingService";
import { WebAntiSpoofingService, type AntiSpoofingResult } from "../services/WebAntiSpoofingService";
import { preprocessFaceForAntiSpoofing } from "../utils/faceUtils";
import { globalWorkerPool } from "../services/GlobalWorkerPool";

interface DetectionResult {
  bbox: [number, number, number, number];
  confidence: number;
  landmarks: number[][];
  recognition?: {
    personId: string | null;
    similarity: number;
  };
  antiSpoofing?: AntiSpoofingResult;
}

interface LiveCameraRecognitionProps {
  onMenuSelect: (menu: 'live-camera' | 'system-management' | 'live-video' | 'advanced-recognition') => void;
}

export default function LiveCameraRecognition({ onMenuSelect }: LiveCameraRecognitionProps) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [detectionResults, setDetectionResults] = useState<DetectionResult[]>(
    []
  );
  const [systemStats, setSystemStats] = useState({
    today_records: 0,
    total_people: 0,
  });
  const [cameraStatus, setCameraStatus] = useState<
    "stopped" | "starting" | "preview" | "recognition" | "initializing"
  >("stopped");
  const [processingTime, setProcessingTime] = useState(0);
  const [registrationMode, setRegistrationMode] = useState(false);
  const [newPersonId, setNewPersonId] = useState("");

  // Camera selection states
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [camerasLoaded, setCamerasLoaded] = useState(false);

  // New intelligent logging system states
  const [loggingMode, setLoggingMode] = useState<"auto" | "manual">("auto");
  const [recentLogs, setRecentLogs] = useState<FaceLogEntry[]>([]);
  const [autoLogCooldown, setAutoLogCooldown] = useState<Map<string, number>>(new Map());

  // Worker pool state tracking


  // Initialize advanced face deduplication service
  const deduplicationServiceRef = useRef<FaceDeduplicationService>(
    new FaceDeduplicationService({
      sessionTimeoutMs: 30000,      // 30 seconds between sessions
      minSessionDurationMs: 2000,   // 2 seconds minimum observation
      maxSessionDurationMs: 45000,  // 45 seconds maximum session
      minConfidence: 0.7,           // Higher confidence threshold
      minSimilarity: 0.75,          // Higher similarity threshold
      minDetectionsForLog: 3,       // Require 3+ detections for stability
      enableAdaptiveThresholds: true,
      enableQualityBasedSelection: true,
      enableTemporalSmoothing: true
    })
  );

  // Initialize face tracking service for multi-face scenarios
  const faceTrackingServiceRef = useRef<FaceTrackingService>(
    new FaceTrackingService({
      maxTrackingDistance: 80,      // Maximum pixel distance for face matching
      trackTimeoutMs: 1500,         // Remove tracks after 1.5 seconds
      minDetectionsForStability: 3, // Minimum detections for stability
      stabilityThreshold: 0.7,      // Stability score threshold
      positionWeight: 0.5,          // Weight for position matching
      sizeWeight: 0.3,              // Weight for size matching
      confidenceWeight: 0.2         // Weight for confidence matching
    })
  );

  // Enhanced detection states
  const [bestDetection, setBestDetection] = useState<DetectionResult | null>(null);
  const [isReadyToLog, setIsReadyToLog] = useState(false);
  const [trackedFaces, setTrackedFaces] = useState<TrackedFace[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const canvasInitializedRef = useRef(false);
  const lastCaptureRef = useRef(0);
  const captureIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Worker manager for face detection and recognition (non-blocking)
  const workerManagerRef = useRef<WorkerManager | null>(null);

  // Anti-spoofing service for liveness detection
  const antiSpoofingServiceRef = useRef<WebAntiSpoofingService | null>(null);

  // Helper function to refresh data from database
  const refreshDatabaseData = useCallback(async () => {
    try {
      const [logs, stats] = await Promise.all([
        faceLogService.getRecentLogs(10),
        faceLogService.getTodayStats()
      ]);
      
      setRecentLogs(logs);
      setSystemStats(prev => ({
        ...prev,
        today_records: stats.totalDetections
      }));
    } catch {
      // Silently fail - database might not be available
    }
  }, []);

  // Subscribe to global worker pool state changes for stats updates
  useEffect(() => {
    const unsubscribe = globalWorkerPool.subscribe((state) => {
      // Update system stats when worker pool is ready
      if (state.isInitialized && state.stats) {
        setSystemStats(prev => ({
          ...prev,
          total_people: state.stats?.totalPersons || 0
        }));
      }
    });

    return unsubscribe;
  }, []);

  // Function to enumerate available cameras
  const enumerateCameras = useCallback(async () => {
    try {
      // First request permission to access camera devices
      await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      
      // Now enumerate devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      
      setAvailableCameras(videoDevices);
      
      // Auto-select first camera if none selected
      if (videoDevices.length > 0 && !selectedCameraId) {
        setSelectedCameraId(videoDevices[0].deviceId);
      }
      
      setCamerasLoaded(true);
    } catch (error) {
      console.error('Failed to enumerate cameras:', error);
      setCamerasLoaded(true); // Still mark as loaded even if failed
    }
  }, [selectedCameraId]);

  // Processing state management
  const processingActiveRef = useRef(false);
  const acceptDetectionUpdatesRef = useRef(true);
  const cameraStatusRef = useRef<"stopped" | "starting" | "preview" | "recognition" | "initializing">("stopped");

  // Define startProcessing first (will be defined later with useCallback)
  const startProcessingRef = useRef<(() => void) | null>(null);

  // Keep cameraStatusRef in sync with cameraStatus state
  useEffect(() => {
    cameraStatusRef.current = cameraStatus;
  }, [cameraStatus]);

  // Fast pipeline initialization using pre-initialized global worker pool
  const initializePipeline = useCallback(async () => {
    try {
      // Check if global worker pool is ready
      if (globalWorkerPool.isReady()) {
        
        // Get pre-initialized services
        const workerManager = globalWorkerPool.getWorkerManager();
        const antiSpoofingService = globalWorkerPool.getAntiSpoofingService();
        
        // Verify services are actually available
        if (!workerManager) {
          throw new Error('Worker manager not available from global pool');
        }
        
        workerManagerRef.current = workerManager;
        antiSpoofingServiceRef.current = antiSpoofingService;
        
        // Update stats from pre-loaded data
        const stats = globalWorkerPool.getStats();
        if (stats) {
          setSystemStats((prev) => ({
            ...prev,
            total_people: stats.totalPersons,
          }));
        }
        
        setCameraStatus("recognition");
        
        // Start processing immediately - no delay needed!
        if (startProcessingRef.current) {
          startProcessingRef.current();
        } else {
          console.warn('⚠️ startProcessingRef.current is not available');
        }
        
        return; // Early return for instant startup
      }
      
      // Fallback: Initialize normally if worker pool not ready
      setCameraStatus("initializing");
      
      // Create and initialize worker manager
      if (!workerManagerRef.current) {
        workerManagerRef.current = new WorkerManager();
      }

      // Initialize the worker (this handles both SCRFD and EdgeFace initialization)
      await workerManagerRef.current.initialize();

      // Initialize anti-spoofing service
      if (!antiSpoofingServiceRef.current) {
        antiSpoofingServiceRef.current = new WebAntiSpoofingService();
        await antiSpoofingServiceRef.current.initialize();
      }

      // Load existing database and get stats
      const stats = await workerManagerRef.current.getStats();
      setSystemStats((prev) => ({
        ...prev,
        total_people: stats.totalPersons,
      }));

      setCameraStatus("recognition");

      // Start processing with slight delay for fallback initialization
      setTimeout(() => {
        if (startProcessingRef.current) {
          startProcessingRef.current();
        } else {
          console.warn('⚠️ startProcessingRef.current is not available (fallback path)');
        }
      }, 100);
      
    } catch (error) {
      console.error("❌ Failed to initialize worker pipeline:", error);
      console.error("📋 Detailed error:", error);
      setCameraStatus("stopped");

      // Show user-friendly error
      alert(
        `Worker initialization failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }, []);

  const startCamera = useCallback(async () => {
    try {
      // Re-enable detection updates
      acceptDetectionUpdatesRef.current = true;

      setIsStreaming(true);
      setCameraStatus("starting");

      // Get user media with MAXIMUM performance optimizations
      const constraints: MediaStreamConstraints = {
      video: {
        ...(selectedCameraId
          ? { deviceId: { exact: selectedCameraId } }
          : { facingMode: "user" })
      },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;

        videoRef.current.onloadedmetadata = () => {

          // Configure video for ultra-minimal latency
          if (videoRef.current) {
            const video = videoRef.current;

            try {
              // Ultra-low latency settings
              video.currentTime = 0;

              // Critical low-latency attributes
              video.setAttribute("playsinline", "true");
              video.setAttribute("webkit-playsinline", "true");
              video.muted = true;

              // Minimize buffering completely
              video.setAttribute("x5-video-player-type", "h5");
              video.setAttribute("x5-video-player-fullscreen", "false");
              video.setAttribute("x5-video-orientation", "portrait"); // Fixed typo: portraint → portrait

              // Set playback rate for minimal latency
              video.playbackRate = 1.0;

              // Start playback immediately
              video.play().catch((err) => {
                console.error("Video playback failed:", err);
              });
            } catch (err) {
              console.error("Error configuring video:", err);
            }
          }
          setCameraStatus("preview");
          // OPTIMIZED: Initialize canvas immediately for faster startup
          const initializeCanvas = () => {
            if (videoRef.current && canvasRef.current) {
              const video = videoRef.current;
              const canvas = canvasRef.current;

              // Get the actual display size of the video element
              const rect = video.getBoundingClientRect();

              // Set canvas to match video display size for perfect overlay (rounded for stability)
              const stableWidth = Math.round(rect.width || 640); // Fallback to default
              const stableHeight = Math.round(rect.height || 480);

              canvas.width = stableWidth;
              canvas.height = stableHeight;
              canvas.style.width = `${stableWidth}px`;
              canvas.style.height = `${stableHeight}px`;
              canvasInitializedRef.current = true;

              // Initialize pipeline immediately after canvas setup
              initializePipeline();
            }
          };
          
          // Try immediate initialization, fallback to minimal delay
          initializeCanvas();
          if (!canvasInitializedRef.current) {
            setTimeout(initializeCanvas, 50); // Reduced from 200ms to 50ms
          }
        };
      }
    } catch (error) {
      console.error("Failed to start camera:", error);
      setIsStreaming(false);
      setCameraStatus("stopped");
    }
  }, [initializePipeline, selectedCameraId]);

  const stopCamera = useCallback(() => {
    // Immediately disable detection updates
    acceptDetectionUpdatesRef.current = false;

    setIsStreaming(false);
    setCameraStatus("stopped");

    // Stop any active processing immediately
    processingActiveRef.current = false;

    // Clear detection results immediately and prevent any further updates
    setDetectionResults([]);

    // Clean up any remaining intervals and frames
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = undefined;
    }

    // Clear face tracking state
    faceTrackingServiceRef.current.clearTracks();
    setTrackedFaces([]);
    setBestDetection(null);
    setIsReadyToLog(false);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    // Clear the canvas completely when stopping camera
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }

    // Reset intelligent logging states
    setBestDetection(null);
    setIsReadyToLog(false);
    setAutoLogCooldown(new Map());

    // Reset canvas initialization flag for next session
    canvasInitializedRef.current = false;

    // Reset processing flag to prevent any lingering worker responses
    isProcessing.current = false;

    // Force a final clear after a short delay to ensure everything is cleaned up
    setTimeout(() => {
      setDetectionResults([]);
    }, 100);
  }, []);

  // Reuse canvases for better performance
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Enhanced capture with proper coordinate scaling for object-contain video
  const captureFrame = useCallback((): {
    imageData: ImageData;
    scaleX: number;
    scaleY: number;
  } | null => {
    if (!videoRef.current || videoRef.current.videoWidth === 0) {
      return null;
    }

    const video = videoRef.current;

    // Create a reusable canvas only once - use optimized resolution for processing
    if (!captureCanvasRef.current) {
      captureCanvasRef.current = document.createElement("canvas");
    }

    const tempCanvas = captureCanvasRef.current;
    
    // Set canvas size to match video resolution, scaled down for performance
    const maxWidth = 640;
    const maxHeight = 480;
    const videoAspectRatio = video.videoWidth / video.videoHeight;
    
    if (videoAspectRatio > 1) {
      // Landscape video
      tempCanvas.width = Math.min(maxWidth, video.videoWidth);
      tempCanvas.height = Math.round(tempCanvas.width / videoAspectRatio);
    } else {
      // Portrait video
      tempCanvas.height = Math.min(maxHeight, video.videoHeight);
      tempCanvas.width = Math.round(tempCanvas.height * videoAspectRatio);
    }

    const tempCtx = tempCanvas.getContext("2d", {
      willReadFrequently: true,
      alpha: false, // Disable alpha for performance
      desynchronized: true, // Allow async rendering
    });
    if (!tempCtx) return null;

    // Calculate scale factors for coordinate mapping back to original video
    const scaleX = video.videoWidth / tempCanvas.width;
    const scaleY = video.videoHeight / tempCanvas.height;

    // Optimize rendering for speed
    tempCtx.imageSmoothingEnabled = false; // Disable smoothing for speed

    // Draw the entire video frame to canvas
    tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

    // Get image data from temp canvas
    const imageData = tempCtx.getImageData(
      0,
      0,
      tempCanvas.width,
      tempCanvas.height
    );

    return { imageData, scaleX, scaleY };
  }, []);

  // Advanced intelligent logging with deduplication
  const handleAutoLog = useCallback(async (detection: DetectionResult) => {
    if (!detection.recognition?.personId) return;
    
    const personId = detection.recognition.personId;
    const confidence = detection.confidence;
    const similarity = detection.recognition.similarity;
    const bbox = detection.bbox;
    const timestamp = Date.now();

    try {
      // Use advanced deduplication service to determine if we should log
      const deduplicationResult = await deduplicationServiceRef.current.processDetection(
        personId,
        confidence,
        similarity,
        bbox,
        timestamp
      );

      if (deduplicationResult.shouldLog && deduplicationResult.bestDetection) {
        // Log the best detection from the session, not necessarily the current one
        const bestDetection = deduplicationResult.bestDetection;
        


        
        // Log to persistent SQLite database using the best detection
        await faceLogService.logAutoDetection(
          personId, 
          bestDetection.confidence, 
          bestDetection.bbox,
          bestDetection.similarity
        );
        
        // Update cooldown for legacy compatibility (though we now use session-based approach)
        setAutoLogCooldown(prev => new Map(prev).set(personId, timestamp));
        
        // Force immediate UI update
        setSystemStats(prev => ({
          ...prev,
          today_records: prev.today_records + 1
        }));
        
        // Refresh data from database (async, don't await to avoid blocking)
        refreshDatabaseData();
      } else {
        // Log why we didn't log for debugging

        
        // Show active session info for debugging
        const sessionInfo = deduplicationServiceRef.current.getSessionInfo(deduplicationResult.sessionId);
        if (sessionInfo) {
          // Session info available for debugging if needed
        }
      }
      
    } catch (error) {
      console.error("Advanced auto-log failed:", error);
      // Fallback to old cooldown system in case of errors
      const now = Date.now();
      const lastLogged = autoLogCooldown.get(personId) || 0;
      
      if ((now - lastLogged) > 30000) { // 30 second fallback cooldown
        await faceLogService.logAutoDetection(
          personId, 
          confidence, 
          bbox,
          similarity
        );
        setAutoLogCooldown(prev => new Map(prev).set(personId, now));
      }
    }
  }, [refreshDatabaseData, autoLogCooldown]);

  const handleManualLog = useCallback(async (detection: DetectionResult) => {
    if (!detection.recognition?.personId) return;
    
    const personId = detection.recognition.personId;

    try {
      // Log to persistent SQLite database
      await faceLogService.logManualDetection(
        personId, 
        detection.confidence, 
        detection.bbox,
        detection.recognition.similarity
      );
      
      // Force immediate UI update
      setSystemStats(prev => ({
        ...prev,
        today_records: prev.today_records + 1
      }));
      
      // Refresh data from database (async, don't await to avoid blocking)
      refreshDatabaseData();
      
    } catch (error) {
      console.error("Manual log failed:", error);
    }
  }, [refreshDatabaseData]);

  // Frame processing optimization - skip stale frames
  const isProcessing = useRef(false);
  const frameSkipCount = useRef(0);

  // Ultra-optimized frame processing using Web Worker - intelligent skipping for maximum performance
  const processFrameRealTime = useCallback(async () => {
    if (
      !isStreaming ||
      cameraStatusRef.current !== "recognition" ||
      !workerManagerRef.current
    ) {
      return;
    }

    // Skip frame if we're still processing the previous one (critical for performance)
    if (isProcessing.current) {
      frameSkipCount.current++;
      return;
    }

    isProcessing.current = true;

    try {
      // Double-check streaming status before proceeding (prevent race conditions)
      if (!isStreaming || cameraStatusRef.current !== "recognition") {
        isProcessing.current = false;
        return;
      }

      // Capture frame for detection (video element handles display)
      const captureResult = captureFrame();
      if (!captureResult) {
        isProcessing.current = false;
        return;
      }

      const { imageData } = captureResult;

      const startTime = performance.now();

      // Process frame through worker (ZERO main thread blocking!)
      const detections = await workerManagerRef.current.detectAndRecognizeFaces(
        imageData
      );
      
      // Final check before updating state - prevent race conditions after camera stop
      if (
        !isStreaming ||
        cameraStatusRef.current !== "recognition" ||
        !acceptDetectionUpdatesRef.current
      ) {
        isProcessing.current = false;
        return;
      }

      let validDetections = detections
      
      // Smart anti-spoofing: Only run on recognized faces with high similarity
      if (antiSpoofingServiceRef.current && validDetections.length > 0) {
        const detectionsWithAntiSpoofing = [];
        for (const detection of validDetections) {
          const isRecognized = detection.recognition?.personId; // Any recognized face

          if (isRecognized) {
            try {
              // Preprocess face for anti-spoofing
              const faceImageData = preprocessFaceForAntiSpoofing(
                imageData,
                detection.bbox
              );

              // Run anti-spoofing detection only on recognized faces
              const antiSpoofingResult =
                await antiSpoofingServiceRef.current!.detectLiveness(faceImageData);

              detectionsWithAntiSpoofing.push({
                ...detection,
                antiSpoofing: antiSpoofingResult,
              });
            } catch (error) {
              console.warn('Anti-spoofing failed for recognized face:', error);
              // Return detection without anti-spoofing data on error
              detectionsWithAntiSpoofing.push({
                ...detection,
                antiSpoofing: {
                  isLive: false,
                  confidence: 0,
                  score: 0,
                },
              });
            }
          } else {
            // Skip anti-spoofing for unrecognized faces
            detectionsWithAntiSpoofing.push({
              ...detection,
              antiSpoofing: undefined, // No anti-spoofing data
            });
          }
        }
        validDetections = detectionsWithAntiSpoofing;
      }

      const processingTime = performance.now() - startTime;

      // Only update state if still streaming, in recognition mode, and accepting updates
      if (
        isStreaming &&
        cameraStatusRef.current === "recognition" &&
        acceptDetectionUpdatesRef.current
      ) {
        setDetectionResults(validDetections);
        setProcessingTime(processingTime);

        // Intelligent face tracking and logging system
        if (validDetections.length > 0) {
          // Update face tracking with current detections
          const updatedTracks = faceTrackingServiceRef.current.updateTracks(
            validDetections.map(detection => ({
              bbox: detection.bbox,
              confidence: detection.confidence,
              recognition: detection.recognition
            }))
          );
          
          setTrackedFaces(updatedTracks);
          
          // Get the primary (most stable) tracked face for UI display
          const primaryTrack = faceTrackingServiceRef.current.getPrimaryTrack();
          
          if (primaryTrack) {
            // Find the corresponding detection for the primary track
            const primaryDetection = validDetections.find(detection => {
              // Match by position and confidence similarity
              const trackCenterX = primaryTrack.bbox[0] + primaryTrack.bbox[2] / 2;
              const trackCenterY = primaryTrack.bbox[1] + primaryTrack.bbox[3] / 2;
              const detectionCenterX = detection.bbox[0] + detection.bbox[2] / 2;
              const detectionCenterY = detection.bbox[1] + detection.bbox[3] / 2;
              
              const distance = Math.sqrt(
                Math.pow(trackCenterX - detectionCenterX, 2) +
                Math.pow(trackCenterY - detectionCenterY, 2)
              );
              
              return distance < 50 && Math.abs(primaryTrack.confidence - detection.confidence) < 0.2;
            });
            
            if (primaryDetection) {
              setBestDetection(primaryDetection);
              
              // Set ready to log based on track stability and confidence
              if (primaryTrack.isStable && primaryTrack.confidence > 0.6) {
                setIsReadyToLog(true);
              } else {
                setIsReadyToLog(false);
              }
            }
          } else {
            // Fallback to highest confidence detection if no stable track exists
            const fallbackDetection = validDetections.reduce((best, current) => {
              return current.confidence > best.confidence ? current : best;
            });
            setBestDetection(fallbackDetection);
            setIsReadyToLog(fallbackDetection.confidence > 0.6);
          }

          // Enhanced confidence-based filtering for multi-face scenarios
          if (loggingMode === "auto") {
            // Dynamic confidence threshold based on number of faces
            const baseConfidenceThreshold = 0.6;
            const multiFactorThreshold = validDetections.length > 1 ? 0.75 : baseConfidenceThreshold;
            
            // Filter recognized faces with enhanced criteria
            const recognizedFaces = validDetections.filter(detection => {
              if (!detection.recognition?.personId) return false;
              
              // Higher confidence threshold for multi-face scenarios
              if (detection.confidence < multiFactorThreshold) return false;
              
              // Additional quality checks for multi-face scenarios
              if (validDetections.length > 1) {
                // Face size check - ensure face is reasonably sized
                const faceArea = (detection.bbox[2] - detection.bbox[0]) * (detection.bbox[3] - detection.bbox[1]);
                const minFaceArea = 2500; // Minimum face area in pixels
                if (faceArea < minFaceArea) return false;
                
                // Ensure the face is not too close to image edges (partial faces)
                const margin = 20;
                if (detection.bbox[0] < margin || detection.bbox[1] < margin) return false;
              }
              
              return true;
            });
            
            // Only process high-quality recognized faces
            recognizedFaces.forEach(detection => {
              // Process each recognized face through deduplication service
              handleAutoLog(detection);
            });
          }
        } else {
          setBestDetection(null);
          setIsReadyToLog(false);
        }
      }
    } catch (error) {
      console.error("Worker-based frame processing error:", error);
    } finally {
      // Always reset processing flag to allow next frame
      isProcessing.current = false;
    }
  }, [isStreaming, captureFrame, loggingMode, handleAutoLog]);

  const startProcessing = useCallback(() => {
    // Clean up any existing intervals
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = undefined;
    }

    // Mark processing as active
    processingActiveRef.current = true;

    lastCaptureRef.current = 0;

    // Ultra-optimized processing loop with adaptive frame rate
    const processNextFrame = async () => {
      // Check if processing should continue
      if (!processingActiveRef.current || !isStreaming) {
        return; // Stop the loop completely
      }

      if (cameraStatusRef.current === "recognition") {
        // Process frame for detection (video element shows live feed)
        await processFrameRealTime();

        // ULTRA PERFORMANCE - immediate next frame processing
        // Use requestAnimationFrame for optimal browser performance
        if (
          processingActiveRef.current &&
          isStreaming &&
          cameraStatusRef.current === "recognition"
        ) {
          // Use requestAnimationFrame for smoother performance than setTimeout
          requestAnimationFrame(processNextFrame);
        }
      } else if (isStreaming) {
        // Camera is streaming but not in recognition mode (e.g., preview mode)
        setTimeout(() => {
          if (processingActiveRef.current && isStreaming) {
            processNextFrame();
          }
        }, 100);
      }
    };

    // Start optimized processing only if streaming
    if (isStreaming) {
      processNextFrame();
    }

  }, [processFrameRealTime, isStreaming]);

  // Set the ref after the function is defined
  useEffect(() => {
    startProcessingRef.current = startProcessing;
  }, [startProcessing]);

  const registerFace = useCallback(async () => {
    if (!newPersonId.trim()) {
      alert("Please enter a person ID");
      return;
    }

    if (!workerManagerRef.current) {
      alert("Worker manager not initialized");
      return;
    }

    try {
      const captureResult = captureFrame();
      if (!captureResult) {
        alert("Failed to capture frame");
        return;
      }

      const { imageData } = captureResult;

      // Find the largest face detection for registration
      // First check if we have any detections at all
      if (detectionResults.length === 0) {
        alert("No faces detected for registration");
        return;
      }

      const largestDetection = detectionResults.reduce((largest, current) => {
        const currentArea =
          (current.bbox[2] - current.bbox[0]) *
          (current.bbox[3] - current.bbox[1]);
        const largestArea = largest
          ? (largest.bbox[2] - largest.bbox[0]) *
            (largest.bbox[3] - largest.bbox[1])
          : 0;
        return currentArea > largestArea ? current : largest;
      }, detectionResults[0]); // Initialize with first detection to avoid null

      if (
        !largestDetection ||
        !largestDetection.landmarks ||
        largestDetection.landmarks.length < 5
      ) {
        alert("No face with sufficient landmarks detected for registration");
        return;
      }

      // Register face using worker manager
      const success = await workerManagerRef.current.registerPerson(
        newPersonId.trim(),
        imageData,
        largestDetection.landmarks
      );

      if (success) {
        alert(
          `✅ Successfully registered ${newPersonId} with EdgeFace (Research-Grade Accuracy)`
        );
        setNewPersonId("");
        setRegistrationMode(false);
        setSystemStats((prev) => ({
          ...prev,
          total_people: prev.total_people + 1,
        }));

      } else {
        alert(
          "❌ Registration failed - Please try again with better face positioning"
        );
      }
    } catch (error) {
      console.error("Registration error:", error);
      alert("Registration failed due to technical error");
    }
  }, [newPersonId, detectionResults, captureFrame]);

  const drawDetections = useCallback(() => {
    if (!canvasRef.current || !videoRef.current) return;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    // Clear canvas first
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Only draw HUD and detections when camera is actively streaming AND in recognition mode
    if (!isStreaming || cameraStatus !== "recognition") {
      return; // Exit early if camera is not active or not in recognition mode
    }

    // Additional check to ensure detection results are valid and current
    if (detectionResults.length === 0) {
      return; // No detections to draw
    }

    // CRITICAL: Always get fresh dimensions and recalculate for accuracy
    // Force layout recalculation to ensure accurate dimensions after resize
    void video.offsetHeight; // Force reflow
    const rect = video.getBoundingClientRect();
    const displayWidth = Math.round(rect.width);
    const displayHeight = Math.round(rect.height);

    // ENHANCED: Update canvas size to exactly match video display size
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
      
      // Clear canvas after size change
      ctx.clearRect(0, 0, displayWidth, displayHeight);
    }

    // ENHANCED: Calculate precise scale factors for coordinate transformation with object-contain
    // Detection coordinates are in capture canvas resolution (from SCRFD model)
    // We need to scale them to the actual video display area within the container

    // Get the capture canvas dimensions used for detection
    const captureWidth = captureCanvasRef.current?.width || 640;
    const captureHeight = captureCanvasRef.current?.height || 480;

    // CRITICAL: Calculate the actual video display size within the container (object-contain behavior)
    // This must match exactly how the video element displays the content
    const videoAspectRatio = video.videoWidth / video.videoHeight;
    const containerAspectRatio = displayWidth / displayHeight;
    
    let actualVideoWidth: number;
    let actualVideoHeight: number;
    let offsetX = 0;
    let offsetY = 0;
    
    if (videoAspectRatio > containerAspectRatio) {
      // Video is wider - fit to container width, add vertical padding
      actualVideoWidth = displayWidth;
      actualVideoHeight = displayWidth / videoAspectRatio;
      offsetY = (displayHeight - actualVideoHeight) / 2;
    } else {
      // Video is taller - fit to container height, add horizontal padding
      actualVideoHeight = displayHeight;
      actualVideoWidth = displayHeight * videoAspectRatio;
      offsetX = (displayWidth - actualVideoWidth) / 2;
    }
    
    // CRITICAL: Direct scaling from capture canvas to display area
    // This ensures landmarks align perfectly with the video content
    const scaleX = actualVideoWidth / captureWidth;
    const scaleY = actualVideoHeight / captureHeight;

    // Validate scale factors
    if (!isFinite(scaleX) || !isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
      return; // Skip drawing if scale factors are invalid
    }

    // Draw detections with futuristic sci-fi styling
    for (const detection of detectionResults) {
      const [x1, y1, x2, y2] = detection.bbox;

      // Validate bbox coordinates first
      if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) {
        continue; // Skip invalid detections
      }

      // Scale coordinates from capture canvas size to displayed video area
      // Add offset for object-contain positioning within container
      const scaledX1 = x1 * scaleX + offsetX;
      const scaledY1 = y1 * scaleY + offsetY;
      const scaledX2 = x2 * scaleX + offsetX;
      const scaledY2 = y2 * scaleY + offsetY;

      // Additional validation for scaled coordinates
      if (
        !isFinite(scaledX1) ||
        !isFinite(scaledY1) ||
        !isFinite(scaledX2) ||
        !isFinite(scaledY2)
      ) {
        continue; // Skip if scaling produced invalid values
      }

      const width = scaledX2 - scaledX1;
      const height = scaledY2 - scaledY1;

      // Determine colors based on recognition status
      const isRecognized = detection.recognition?.personId;
      const primaryColor = isRecognized ? "#00ffff" : "#ff6b6b"; // Cyan or red
      const secondaryColor = isRecognized ? "#0088ff" : "#ff8888";

      // Draw futuristic corner brackets instead of full box
      const cornerSize = Math.min(20, width * 0.2, height * 0.2);
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 3;
      ctx.shadowColor = primaryColor;
      ctx.shadowBlur = 10;

      // Top-left corner
      ctx.beginPath();
      ctx.moveTo(scaledX1, scaledY1 + cornerSize);
      ctx.lineTo(scaledX1, scaledY1);
      ctx.lineTo(scaledX1 + cornerSize, scaledY1);
      ctx.stroke();

      // Top-right corner
      ctx.beginPath();
      ctx.moveTo(scaledX2 - cornerSize, scaledY1);
      ctx.lineTo(scaledX2, scaledY1);
      ctx.lineTo(scaledX2, scaledY1 + cornerSize);
      ctx.stroke();

      // Bottom-left corner
      ctx.beginPath();
      ctx.moveTo(scaledX1, scaledY2 - cornerSize);
      ctx.lineTo(scaledX1, scaledY2);
      ctx.lineTo(scaledX1 + cornerSize, scaledY2);
      ctx.stroke();

      // Bottom-right corner
      ctx.beginPath();
      ctx.moveTo(scaledX2 - cornerSize, scaledY2);
      ctx.lineTo(scaledX2, scaledY2);
      ctx.lineTo(scaledX2, scaledY2 - cornerSize);
      ctx.stroke();

      // Reset shadow for text
      ctx.shadowBlur = 0;

      // Draw modern HUD-style label
      const personId = detection.recognition?.personId || "UNKNOWN";
      const confidence =
        detection.recognition?.similarity || detection.confidence;
      const label = personId.toUpperCase();
      const confidenceText = `${(confidence * 100).toFixed(1)}%`;

      // Set font for name measurement
      ctx.font = 'bold 16px "Courier New", monospace';

      // Validate coordinates
      const isValidCoord = (val: number) =>
        typeof val === "number" && isFinite(val);
      if (
        !isValidCoord(scaledX1) ||
        !isValidCoord(scaledY1)
      ) {
        continue; // Skip this detection if coordinates are invalid
      }

      // Draw name (no background)
      ctx.font = 'bold 16px "Courier New", monospace';
      ctx.fillStyle = primaryColor;
      ctx.shadowColor = primaryColor;
      ctx.shadowBlur = 10;
      ctx.fillText(label, scaledX1, scaledY1 - 10);
      ctx.shadowBlur = 0;

      // Draw confidence next to name (no background)
      ctx.font = 'normal 14px "Courier New", monospace';
      ctx.fillStyle = secondaryColor;
      const nameWidth = ctx.measureText(label).width;
      ctx.fillText(confidenceText, scaledX1 + nameWidth + 10, scaledY1 - 10);

      // Draw futuristic facial landmarks (neural nodes)
      if (detection.landmarks && detection.landmarks.length > 0) {
        const maxLandmarks = Math.min(detection.landmarks.length, 5);
        for (let i = 0; i < maxLandmarks; i++) {
          if (!detection.landmarks[i] || detection.landmarks[i].length < 2)
            continue;

          const [x, y] = detection.landmarks[i];
          if (isNaN(x) || isNaN(y)) continue;

          // ENHANCED: High-precision landmark coordinate transformation
          // Landmarks come from SCRFD in the same coordinate system as bbox (capture canvas)
          // Apply identical transformation as bbox coordinates for perfect alignment
          const scaledLandmarkX = x * scaleX + offsetX;
          const scaledLandmarkY = y * scaleY + offsetY;

          // Enhanced validation for scaled landmark coordinates
          if (!isFinite(scaledLandmarkX) || !isFinite(scaledLandmarkY) || 
              scaledLandmarkX < 0 || scaledLandmarkY < 0 ||
              scaledLandmarkX > displayWidth || scaledLandmarkY > displayHeight)
            continue;

          // Draw neural node with glow effect
          ctx.fillStyle = primaryColor;
          ctx.shadowColor = primaryColor;
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(scaledLandmarkX, scaledLandmarkY, 4, 0, 2 * Math.PI);
          ctx.fill();

          // Inner core
          ctx.fillStyle = "#ffffff";
          ctx.shadowBlur = 2;
          ctx.beginPath();
          ctx.arc(scaledLandmarkX, scaledLandmarkY, 2, 0, 2 * Math.PI);
          ctx.fill();

          // Pulse effect for recognized faces
          if (isRecognized) {
            const pulseRadius = 6 + Math.sin(Date.now() / 200 + i) * 2;
            ctx.strokeStyle = `${primaryColor}60`;
            ctx.lineWidth = 1;
            ctx.shadowBlur = 5;
            ctx.beginPath();
            ctx.arc(
              scaledLandmarkX,
              scaledLandmarkY,
              pulseRadius,
              0,
              2 * Math.PI
            );
            ctx.stroke();
          }
        }
        ctx.shadowBlur = 0;
      }

      // Add status indicator
      const statusText = isRecognized ? "Face Recognized" : "";
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillStyle = isRecognized ? "#00ff00" : "#ffaa00";
      ctx.fillText(statusText, scaledX1 + 10, scaledY2 + 15);

      // Add animated border glow for recognized faces
      if (isRecognized) {
        const glowIntensity = 0.5 + Math.sin(Date.now() / 300) * 0.3;
        ctx.strokeStyle = `${primaryColor}${Math.floor(glowIntensity * 255)
          .toString(16)
          .padStart(2, "0")}`;
        ctx.lineWidth = 1;
        ctx.shadowColor = primaryColor;
        ctx.shadowBlur = 15;
        ctx.strokeRect(scaledX1 - 2, scaledY1 - 2, width + 4, height + 4);
        ctx.shadowBlur = 0;
      }
    }
  }, [detectionResults, isStreaming, cameraStatus]);

  // Draw detections overlay - optimized approach
  useEffect(() => {
    if (
      isStreaming &&
      cameraStatus === "recognition" &&
      detectionResults.length > 0
    ) {
      // Use requestAnimationFrame for smooth 60fps drawing
      const frameId = requestAnimationFrame(() => {
        drawDetections();
      });

      return () => cancelAnimationFrame(frameId);
    } else {
      // Always clear canvas when not streaming or not in recognition mode
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext("2d");
        if (ctx) {
          ctx.clearRect(
            0,
            0,
            canvasRef.current.width,
            canvasRef.current.height
          );
        }
      }
    }
  }, [detectionResults, isStreaming, cameraStatus, drawDetections]);

  // Force clear detection results when camera stops
  useEffect(() => {
    if (cameraStatus === "stopped") {
      setDetectionResults([]);
    }
  }, [cameraStatus]);

  // Additional cleanup effect to monitor detection results changes
  useEffect(() => {
    if (cameraStatus === "stopped" && detectionResults.length > 0) {
      setDetectionResults([]);
    }
  }, [detectionResults, cameraStatus]);

  // Handle window resize to keep canvas aligned
  useEffect(() => {
    let resizeTimeout: NodeJS.Timeout;

    const handleResize = () => {
      // Debounce resize events to prevent constant recalculation
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (
          videoRef.current &&
          canvasRef.current &&
          canvasInitializedRef.current
        ) {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          
          // CRITICAL: Force a layout recalculation before getting dimensions
          // This ensures we get the most up-to-date dimensions after resize
          void video.offsetHeight; // Force reflow
          
          const rect = video.getBoundingClientRect();

          // Update canvas size to match current video display size (with stability threshold)
          const newWidth = Math.round(rect.width);
          const newHeight = Math.round(rect.height);
          const sizeDiffThreshold = 5; // Reduced threshold for more responsive updates

          const widthDiff = Math.abs(canvas.width - newWidth);
          const heightDiff = Math.abs(canvas.height - newHeight);

          if (widthDiff > sizeDiffThreshold || heightDiff > sizeDiffThreshold) {
            // ENHANCED: Update both canvas dimensions and style for perfect alignment
            canvas.width = newWidth;
            canvas.height = newHeight;
            canvas.style.width = `${newWidth}px`;
            canvas.style.height = `${newHeight}px`;

            // CRITICAL: Clear any existing drawings before redrawing
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.clearRect(0, 0, newWidth, newHeight);
            }

            // Force immediate redraw with fresh coordinates
            requestAnimationFrame(() => {
              drawDetections();
            });
          }
        }
      }, 150); // Reduced debounce time for more responsive updates
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(resizeTimeout);
    };
  }, [drawDetections]);

  // Initialize data from persistent database (run once on mount)
  useEffect(() => {
    const initializeData = async () => {
        // Check if database is available
        const isAvailable = await faceLogService.isAvailable();
        
        if (isAvailable) {
          // Load recent logs
          const logs = await faceLogService.getRecentLogs(10);
          setRecentLogs(logs);
          
          // Load today's stats
          const stats = await faceLogService.getTodayStats();
          setSystemStats(prev => ({
            ...prev,
            today_records: stats.totalDetections
          }));
        }
        
        // Initialize WorkerManager to get face recognition database count
        try {
    
          if (!workerManagerRef.current) {
            workerManagerRef.current = new WorkerManager();
          }
          await workerManagerRef.current.initialize();
          const faceStats = await workerManagerRef.current.getStats();
    
          setSystemStats(prev => ({
            ...prev,
            total_people: faceStats.totalPersons
          }));
    
        } catch (error) {
          console.error('❌ Failed to initialize face recognition database:', error);
        }
    };

    initializeData();
  }, []); // Run only once on mount

  // Initialize cameras (separate effect)
  useEffect(() => {
    enumerateCameras();
  }, [enumerateCameras]);

  // When SystemManagement deletes a person, refresh the in-memory embeddings
  useEffect(() => {
    const handler = async () => {
      try {
        if (workerManagerRef.current) {
          await workerManagerRef.current.reloadDatabaseFromLocalStorage?.();
        }
      } catch (err) {
        console.error('Failed to reload recognition database after deletion:', err);
      }
    };
    window.addEventListener('edgeface-person-removed', handler as EventListener);
    return () => window.removeEventListener('edgeface-person-removed', handler as EventListener);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    const deduplicationService = deduplicationServiceRef.current;
    
    return () => {
      stopCamera();

      // Clean up any canvas references
      if (captureCanvasRef.current) {
        captureCanvasRef.current = null;
      }

      // Release worker manager
      if (workerManagerRef.current) {
        workerManagerRef.current.dispose();
        workerManagerRef.current = null;
      }

      // Cleanup anti-spoofing service
      if (antiSpoofingServiceRef.current) {
        antiSpoofingServiceRef.current.dispose();
        antiSpoofingServiceRef.current = null;
      }

      // Cleanup deduplication service
      if (deduplicationService) {
        deduplicationService.destroy();
      }
    };
  }, [stopCamera]);

  return (
    <div className= "text-white flex flex-col h-screen pt-6">

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        {/* Video Section */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Video Container */}
          <div className="relative flex flex-1 min-h-0 items-center justify-center px-4 pt-4">
            <div className="relative w-full h-full min-h-[260px] overflow-hidden rounded-lg bg-white/[0.02] border border-white/[0.08]">
              <video
                ref={videoRef}
                className="absolute inset-0 w-full h-full object-contain"
                autoPlay
                muted
                playsInline
              />
              <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 w-full h-full pointer-events-none"
                style={{
                  zIndex: 10,
                  mixBlendMode: "normal",
                }}
              />
              
              {/* Detection Overlay */}
              {detectionResults.length > 0 && (
                <div className="absolute top-2 left-2 bg-black/80 rounded px-3 py-2">
                  <div className="text-sm text-green-400">
                    {detectionResults.length} face{detectionResults.length > 1 ? 's' : ''} detected
                  </div>
                </div>
              )}

              {/* Manual Log Button */}
              {loggingMode === 'manual' && bestDetection && isReadyToLog && (
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2">
                  <button
                    onClick={() => handleManualLog(bestDetection)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors duration-150"
                  >
                    Log Detection
                  </button>
                </div>
              )}

              {/* Registration Input */}
              {registrationMode && (
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black/90 rounded-lg p-4">
                  <div className="flex items-center space-x-3">
                    <input
                      type="text"
                      value={newPersonId}
                      onChange={(e) => setNewPersonId(e.target.value)}
                      placeholder="Enter person name"
                      className="bg-white/[0.05] text-white px-3 py-2 rounded border border-white/[0.1] focus:border-blue-500 focus:outline-none placeholder-white/50 transition-colors duration-150"
                    />
                    <button
                      onClick={registerFace}
                      disabled={!newPersonId.trim() || detectionResults.length === 0}
                      className="bg-green-600 hover:bg-green-700 disabled:bg-white/[0.05] disabled:text-white/40 text-white px-4 py-2 rounded font-medium transition-colors duration-150"
                    >
                      Register
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Controls Bar */}
          <div className="px-4 pt-2 pb-2">
            <div className="bg-white/[0.02] border border-white/[0.08] rounded-lg p-4 flex items-center justify-between">
              <div className="flex items-center space-x-6">
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${
                    cameraStatus === 'recognition' ? 'bg-green-500' : 
                    cameraStatus === 'initializing' ? 'bg-orange-500 animate-pulse' :
                    'bg-white/40'
                  }`}></div>
                  <span className="text-sm text-white/60">
                    {cameraStatus === 'recognition' ? 'Detection: Active' : 
                     cameraStatus === 'initializing' ? 'Detection: Initializing...' :
                     'Detection: Inactive'}
                  </span>
                </div>

                <div className="text-sm text-white/60">
                  Processing: {processingTime.toFixed(1)}ms
                </div>
                
                {/* Camera Selection */}
                {camerasLoaded && availableCameras.length > 0 && (
                  <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    <span className="text-sm text-white/60">Camera: {isStreaming ? 'Active' : 'Stopped'}</span>
                    
                    <select
                      value={selectedCameraId}
                      onChange={(e) => setSelectedCameraId(e.target.value)}
                      disabled={isStreaming || availableCameras.length <= 1}
                      className="bg-white/[0.05] text-white text-sm border border-white/[0.1] rounded px-2 py-1 focus:border-blue-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
                    >
                      {availableCameras.map((camera, index) => (
                        <option key={camera.deviceId} value={camera.deviceId} className="bg-black text-white">
                          {camera.label || `Camera ${index + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              
              <div className="flex items-center space-x-3">
                <button
                  onClick={isStreaming ? stopCamera : startCamera}
                  disabled={!camerasLoaded}
                  className={`px-4 py-2 rounded font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${
                    isStreaming
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : 'bg-green-600 hover:bg-green-700 text-white'
                  }`}
                >
                  {isStreaming ? 'Stop' : 'Start Scan'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="sidebar w-80 my-3 bg-white/[0.02] border-l border-white/[0.08] flex flex-col max-h-full overflow-hidden">
          {/* Stats Panel */}
          <div className="px-4 pt-2 pb-4 border-b border-white/[0.08]">
            <h3 className="text-lg font-light mb-3">System Status</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-white/60">Connection Status</span>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full bg-white animate-pulse"></div>
                  <span className="text-xs font-light tracking-wider uppercase text-white">Online</span>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/60">People in DB</span>
                <span className="font-mono">{systemStats.total_people}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/60">Today's Records</span>
                <span className="font-mono">{systemStats.today_records}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/60">Tracked Faces</span>
                <span className="font-mono">{trackedFaces.length}</span>
              </div>

              {/* Settings Button */}
              <div className="pt-2 border-t border-white/[0.05] space-y-2">
                <button
                  onClick={() => onMenuSelect('system-management')}
                  className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-white/[0.03] hover:bg-white/[0.08] backdrop-blur-xl border border-white/[0.08] text-white/80 hover:text-white rounded-xl font-light transition-all duration-300"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="text-sm font-light tracking-wider uppercase">Settings</span>
                </button>
                
                {/* Live Video Button */}
                <button
                  onClick={() => onMenuSelect('live-video')}
                  className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-purple-600/20 hover:bg-purple-600/30 backdrop-blur-xl border border-purple-500/30 text-purple-200 hover:text-purple-100 rounded-xl font-light transition-all duration-300"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                  <span className="text-sm font-light tracking-wider uppercase">Live Video</span>
                </button>
                
                {/* Advanced Recognition Button */}
                <button
                  onClick={() => onMenuSelect('advanced-recognition')}
                  className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-gradient-to-r from-blue-600/20 to-cyan-600/20 hover:from-blue-600/30 hover:to-cyan-600/30 backdrop-blur-xl border border-blue-500/30 text-blue-200 hover:text-blue-100 rounded-xl font-light transition-all duration-300"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423L16.5 15.75l.394 1.183a2.25 2.25 0 001.423 1.423L19.5 18.75l-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                  </svg>
                  <span className="text-sm font-light tracking-wider uppercase">Advanced AI</span>
                </button>
              </div>

              {/* Mode and Register controls moved from header */}
              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-white/60">Mode:</span>
                  <button
                    onClick={() => setLoggingMode(loggingMode === 'auto' ? 'manual' : 'auto')}
                    className={`px-3 py-1 rounded text-sm font-medium transition-colors duration-150 ${
                      loggingMode === 'auto'
                        ? 'bg-green-600 text-white'
                        : 'bg-white/[0.05] text-white/70 hover:bg-white/[0.08] border border-white/[0.1]'
                    }`}
                  >
                    {loggingMode === 'auto' ? 'Auto' : 'Manual'}
                  </button>
                </div>
                <button
                  onClick={() => setRegistrationMode(!registrationMode)}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors duration-150 ${
                    registrationMode 
                      ? 'bg-orange-600 text-white' 
                      : 'bg-white/[0.05] text-white/70 hover:bg-white/[0.08] border border-white/[0.1]'
                  }`}
                >
                  Register Face
                </button>
              </div>
            </div>
          </div>

          {/* Live Detections */}
          <div className="p-4 border-b border-white/[0.08]">
            <h3 className="text-lg font-light mb-4">Live Detections</h3>
            <div className="live-detections space-y-2 live-detections-scroll h-20 overflow-auto">
              {detectionResults.length === 0 ? (
                <div className="text-white/50 text-sm text-center py-4">
                  No faces detected
                </div>
              ) : (
                detectionResults.map((detection, index) => (
                  <div key={index} className="bg-white/[0.05] border border-white/[0.08] rounded p-2">
                    <div className="flex justify-between items-center">
                      <span className="font-medium">
                        {detection.recognition?.personId || 'Unknown'}
                      </span>
                      <span className="text-sm text-white/60">
                        {(detection.confidence * 100).toFixed(1)}%
                      </span>
                    </div>
                    {detection.recognition?.personId && detection.recognition?.similarity && (
                      <div className="text-xs text-white/50 mt-1">
                        Similarity: {(detection.recognition.similarity * 100).toFixed(1)}%
                      </div>
                    )}
                    {detection.recognition?.personId && detection.antiSpoofing && (
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/[0.08]">
                        <span className={`text-xs px-2 py-1 rounded ${
                          detection.antiSpoofing.isLive 
                            ? 'bg-green-900 text-green-300' 
                            : 'bg-red-900 text-red-300'
                        }`}>
                          {detection.antiSpoofing.isLive ? '✓ Live' : '⚠ Spoof'}
                        </span>
                        <div className="flex flex-col items-end">
                          <span className="text-xs text-white/50">
                            Conf: {(detection.antiSpoofing.confidence * 100).toFixed(1)}%
                          </span>
                          <span className="text-xs text-white/40">
                            Score: {detection.antiSpoofing.score.toFixed(3)}
                          </span>
                        </div>
                      </div>
                    )}
                    {detection.recognition?.personId && !detection.antiSpoofing && (
                      <div className="flex items-center justify-center mt-2 pt-2 border-t border-white/[0.08]">
                        <span className="text-xs px-2 py-1 rounded bg-blue-900 text-blue-300">
                          ⚡ Verified Identity
                        </span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Recent Logs */}
          <div className="flex-1 p-4  min-h-0 h-full">
            <h3 className="text-lg font-light mb-4">Recent Logs</h3>
            <div className="space-y-2 h-full overflow-y-auto recent-logs-scroll">
              {recentLogs.length === 0 ? (
                <div className="text-white/50 text-sm text-center py-4">
                  No logs yet
                </div>
              ) : (
                recentLogs.map((log, index) => (
                  <div key={index} className="bg-white/[0.05] border border-white/[0.08] rounded p-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-medium">{log.personId}</div>
                        <div className="text-xs text-white/60">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-xs px-2 py-1 rounded ${
                          log.mode === 'auto' ? 'bg-blue-900 text-blue-300' : 'bg-orange-900 text-orange-300'
                        }`}>
                          {log.mode}
                        </div>
                        <div className="text-xs text-white/60 mt-1">
                          {(log.confidence * 100).toFixed(0)}%
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
