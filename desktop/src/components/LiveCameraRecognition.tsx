import { useState, useRef, useCallback, useEffect } from "react";
import { WorkerManager } from "../services/WorkerManager";
import { sqliteFaceLogService, type FaceLogEntry } from "../services/SqliteFaceLogService";

interface DetectionResult {
  bbox: [number, number, number, number];
  confidence: number;
  landmarks: number[][];
  recognition?: {
    personId: string | null;
    similarity: number;
  };
}

export default function LiveCameraRecognition() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [detectionResults, setDetectionResults] = useState<DetectionResult[]>(
    []
  );
  const [systemStats, setSystemStats] = useState({
    today_records: 0,
    total_people: 0,
  });
  const [cameraStatus, setCameraStatus] = useState<
    "stopped" | "starting" | "preview" | "recognition"
  >("stopped");
  const [processingTime, setProcessingTime] = useState(0);
  const [registrationMode, setRegistrationMode] = useState(false);
  const [newPersonId, setNewPersonId] = useState("");

  // New intelligent logging system states
  const [loggingMode, setLoggingMode] = useState<"auto" | "manual">("auto");
  const [recentLogs, setRecentLogs] = useState<FaceLogEntry[]>([]);
  const [autoLogCooldown, setAutoLogCooldown] = useState<Map<string, number>>(new Map());
  const [dbConnected, setDbConnected] = useState(false);

  // Enhanced detection states
  const [bestDetection, setBestDetection] = useState<DetectionResult | null>(null);
  const [isReadyToLog, setIsReadyToLog] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const canvasInitializedRef = useRef(false);
  const lastCaptureRef = useRef(0);
  const captureIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Worker manager for face detection and recognition (non-blocking)
  const workerManagerRef = useRef<WorkerManager | null>(null);

  // Helper function to refresh data from database
  const refreshDatabaseData = useCallback(async () => {
    try {
      const [logs, stats] = await Promise.all([
        sqliteFaceLogService.getRecentLogs(10),
        sqliteFaceLogService.getTodayStats()
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

  // Processing state management
  const processingActiveRef = useRef(false);
  const acceptDetectionUpdatesRef = useRef(true);

  // Define startProcessing first (will be defined later with useCallback)
  const startProcessingRef = useRef<(() => void) | null>(null);

  // Initialize worker-based face detection and recognition pipeline
  const initializePipeline = useCallback(async () => {
    try {

      // Create and initialize worker manager
      if (!workerManagerRef.current) {
        workerManagerRef.current = new WorkerManager();
      }

      // Initialize the worker (this handles both SCRFD and EdgeFace initialization)
      await workerManagerRef.current.initialize();

      // Load existing database and get stats
      const stats = await workerManagerRef.current.getStats();
      setSystemStats((prev) => ({
        ...prev,
        total_people: stats.totalPersons,
      }));

      setCameraStatus("recognition");

      // Start processing immediately
      setTimeout(() => {
        if (startProcessingRef.current) {
          startProcessingRef.current();
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

      // Get user media with high frame rate for smooth display
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          // Disable ALL video processing that can cause delays
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        audio: false,
      });

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

          // Initialize canvas size once when video loads - delay to ensure video is rendered
          setTimeout(() => {
            if (videoRef.current && canvasRef.current) {
              const video = videoRef.current;
              const canvas = canvasRef.current;

              // Get the actual display size of the video element
              const rect = video.getBoundingClientRect();

              // Set canvas to match video display size for perfect overlay (rounded for stability)
              const stableWidth = Math.round(rect.width);
              const stableHeight = Math.round(rect.height);

              canvas.width = stableWidth;
              canvas.height = stableHeight;
              canvas.style.width = `${stableWidth}px`;
              canvas.style.height = `${stableHeight}px`;
              canvasInitializedRef.current = true;

            }
          }, 200); // Slightly longer delay to ensure video is fully rendered

          // Initialize pipeline (it will start processing automatically)
          initializePipeline();
        };
      }
    } catch (error) {
      console.error("Failed to start camera:", error);
      setIsStreaming(false);
      setCameraStatus("stopped");
    }
  }, [initializePipeline]);

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

  // Enhanced capture with proper coordinate scaling
  const captureFrame = useCallback((): {
    imageData: ImageData;
    scaleX: number;
    scaleY: number;
  } | null => {
    if (!videoRef.current || videoRef.current.videoWidth === 0) return null;

    const video = videoRef.current;

    // Create a reusable canvas only once - use optimized resolution for processing
    if (!captureCanvasRef.current) {
      captureCanvasRef.current = document.createElement("canvas");
      // Dynamically set capture resolution based on actual video resolution
      // Keep aspect ratio but scale down for performance
      const maxWidth = 640; // Increased for better accuracy with dynamic resolutions
      const maxHeight = 480; // Increased for better accuracy
      const aspectRatio = video.videoWidth / video.videoHeight;

      if (aspectRatio > 1) {
        // Landscape - fit to width
        captureCanvasRef.current.width = Math.min(maxWidth, video.videoWidth);
        captureCanvasRef.current.height = Math.round(captureCanvasRef.current.width / aspectRatio);
      } else {
        // Portrait - fit to height
        captureCanvasRef.current.height = Math.min(maxHeight, video.videoHeight);
        captureCanvasRef.current.width = Math.round(captureCanvasRef.current.height * aspectRatio);
      }
    }

    const tempCanvas = captureCanvasRef.current;
    const tempCtx = tempCanvas.getContext("2d", {
      willReadFrequently: true,
      alpha: false, // Disable alpha for performance
      desynchronized: true, // Allow async rendering
    });
    if (!tempCtx) return null;

    // Update canvas size only if video dimensions changed significantly
    const currentAspectRatio = video.videoWidth / video.videoHeight;
    const canvasAspectRatio = tempCanvas.width / tempCanvas.height;

    if (Math.abs(currentAspectRatio - canvasAspectRatio) > 0.1) {
      const maxWidth = 640; // Updated to match initialization
      const maxHeight = 480; // Updated to match initialization

      if (currentAspectRatio > 1) {
        tempCanvas.width = Math.min(maxWidth, video.videoWidth);
        tempCanvas.height = Math.round(tempCanvas.width / currentAspectRatio);
      } else {
        tempCanvas.height = Math.min(maxHeight, video.videoHeight);
        tempCanvas.width = Math.round(tempCanvas.height * currentAspectRatio);
      }
    }

    // Calculate scale factors for coordinate mapping back to original video
    const scaleX = video.videoWidth / tempCanvas.width;
    const scaleY = video.videoHeight / tempCanvas.height;

    // Optimize rendering for speed
    tempCtx.imageSmoothingEnabled = false; // Disable smoothing for speed

    // Draw video frame to temp canvas at reduced resolution (major speed boost)
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

  // Intelligent logging handlers
  const handleAutoLog = useCallback(async (detection: DetectionResult) => {
    if (!detection.recognition?.personId) return;
    
    const personId = detection.recognition.personId;

    try {
      // Log to persistent SQLite database
      await sqliteFaceLogService.logAutoDetection(
        personId, 
        detection.confidence, 
        detection.bbox,
        detection.recognition.similarity
      );
      
      // Update cooldown
      setAutoLogCooldown(prev => new Map(prev).set(personId, Date.now()));
      
      // Force immediate UI update
      setSystemStats(prev => ({
        ...prev,
        today_records: prev.today_records + 1
      }));
      
      // Refresh data from database (async, don't await to avoid blocking)
      refreshDatabaseData();
      
      // Refresh data from database
      await refreshDatabaseData();
      
    } catch (error) {
      console.error("Auto-log failed:", error);
    }
  }, [refreshDatabaseData]);

  const handleManualLog = useCallback(async (detection: DetectionResult) => {
    if (!detection.recognition?.personId) return;
    
    const personId = detection.recognition.personId;

    try {
      // Log to persistent SQLite database
      await sqliteFaceLogService.logManualDetection(
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
      cameraStatus !== "recognition" ||
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
      if (!isStreaming || cameraStatus !== "recognition") {
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
        cameraStatus !== "recognition" ||
        !acceptDetectionUpdatesRef.current
      ) {
        isProcessing.current = false;
        return;
      }

      // Filter out low confidence detections to reduce false positives
      const minDisplayConfidence = 0.5;
      const validDetections = detections.filter(
        (det) => det.confidence >= minDisplayConfidence
      );

      const processingTime = performance.now() - startTime;

      // Only update state if still streaming, in recognition mode, and accepting updates
      if (
        isStreaming &&
        cameraStatus === "recognition" &&
        acceptDetectionUpdatesRef.current
      ) {
        setDetectionResults(validDetections);
        setProcessingTime(processingTime);

        // Intelligent face logging system
        if (validDetections.length > 0) {
          // Find the best detection (highest confidence, largest face)
          const bestDetection = validDetections.reduce((best, current) => {
            const currentScore = current.confidence * 
              ((current.bbox[2] - current.bbox[0]) * (current.bbox[3] - current.bbox[1]));
            const bestScore = best.confidence * 
              ((best.bbox[2] - best.bbox[0]) * (best.bbox[3] - best.bbox[1]));
            return currentScore > bestScore ? current : best;
          });

          // Update best detection for UI
          setBestDetection(bestDetection);
          
          // Immediate auto-logging for reliable detections
          if (bestDetection.confidence > 0.7) {
            setIsReadyToLog(true);

            // Immediate auto-logging - no stability delay needed
            if (loggingMode === "auto" && bestDetection.recognition?.personId) {
              const personId = bestDetection.recognition.personId;
              const now = Date.now();
              const lastLogged = autoLogCooldown.get(personId) || 0;
              

              // Auto-log immediately if cooldown period passed (10 seconds)
              if ((now - lastLogged) > 10000) {
                handleAutoLog(bestDetection);
              }
            }
          } else {
            setIsReadyToLog(false);
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
  }, [
    isStreaming,
    cameraStatus,
    captureFrame,
    loggingMode,
    autoLogCooldown,
    handleAutoLog,
  ]);

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

      if (cameraStatus === "recognition") {
        // Process frame for detection (video element shows live feed)
        await processFrameRealTime();

        // Maximum performance - no artificial delays for potato machines
        // Let the hardware run at its natural speed without throttling
        setTimeout(() => {
          if (
            processingActiveRef.current &&
            isStreaming &&
            cameraStatus === "recognition"
          ) {
            processNextFrame();
          }
        }, 0); // No delay - run as fast as possible
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

  }, [processFrameRealTime, isStreaming, cameraStatus]);

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

    // Always get fresh dimensions and recalculate for accuracy
    const rect = video.getBoundingClientRect();
    const displayWidth = Math.round(rect.width);
    const displayHeight = Math.round(rect.height);

    // Update canvas size to exactly match video display size
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
    }

    // Calculate scale factors for coordinate transformation
    // Detection coordinates are in capture canvas resolution (640x480 or smaller)
    // We need to scale them to display canvas resolution

    // Get the capture canvas dimensions used for detection
    const captureWidth = captureCanvasRef.current?.width || 640;
    const captureHeight = captureCanvasRef.current?.height || 480;

    // Map capture coordinates to the displayed video area considering object-cover
    const videoAspectRatio = video.videoWidth / video.videoHeight;
    const containerAspectRatio = displayWidth / displayHeight;

    let actualVideoWidth: number;
    let actualVideoHeight: number;
    let offsetX = 0;
    let offsetY = 0;

    if (videoAspectRatio > containerAspectRatio) {
      // Video is wider - fit height, crop left/right
      actualVideoHeight = displayHeight;
      actualVideoWidth = Math.round(displayHeight * videoAspectRatio);
      offsetX = Math.round((actualVideoWidth - displayWidth) / 2);
    } else {
      // Video is taller - fit width, crop top/bottom
      actualVideoWidth = displayWidth;
      actualVideoHeight = Math.round(displayWidth / videoAspectRatio);
      offsetY = Math.round((actualVideoHeight - displayHeight) / 2);
    }

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

      // Scale coordinates from capture canvas size to displayed video area (with cropping offsets)
      const scaledX1 = (x1 * scaleX) - offsetX;
      const scaledY1 = (y1 * scaleY) - offsetY;
      const scaledX2 = (x2 * scaleX) - offsetX;
      const scaledY2 = (y2 * scaleY) - offsetY;

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

      // Main label styling
      ctx.font = 'bold 16px "Courier New", monospace';
      const labelMetrics = ctx.measureText(label);

      // Confidence styling
      ctx.font = 'normal 12px "Courier New", monospace';
      const confMetrics = ctx.measureText(confidenceText);

      const maxTextWidth = Math.max(labelMetrics.width, confMetrics.width);
      const bgWidth = maxTextWidth + 20;
      const bgHeight = 45;

      // Validate coordinates before creating gradient (fix for createLinearGradient error)
      const isValidCoord = (val: number) =>
        typeof val === "number" && isFinite(val);
      if (
        !isValidCoord(scaledX1) ||
        !isValidCoord(scaledY1) ||
        !isValidCoord(bgWidth) ||
        !isValidCoord(bgHeight)
      ) {
        continue; // Skip this detection if coordinates are invalid
      }

      // Draw HUD background with gradient
      const gradient = ctx.createLinearGradient(
        scaledX1,
        scaledY1 - bgHeight - 10,
        scaledX1 + bgWidth,
        scaledY1 - 10
      );
      gradient.addColorStop(0, isRecognized ? "#00ffff20" : "#ff6b6b20");
      gradient.addColorStop(1, isRecognized ? "#0088ff40" : "#ff888840");

      ctx.fillStyle = gradient;
      ctx.fillRect(scaledX1, scaledY1 - bgHeight - 10, bgWidth, bgHeight);

      // Draw HUD border
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 1;
      ctx.shadowColor = primaryColor;
      ctx.shadowBlur = 3;
      ctx.strokeRect(scaledX1, scaledY1 - bgHeight - 10, bgWidth, bgHeight);
      ctx.shadowBlur = 0;

      // Draw main label
      ctx.font = 'bold 16px "Courier New", monospace';
      ctx.fillStyle = primaryColor;
      ctx.shadowColor = primaryColor;
      ctx.shadowBlur = 10;
      ctx.fillText(label, scaledX1 + 10, scaledY1 - 25);
      ctx.shadowBlur = 0;

      // Draw confidence
      ctx.font = 'normal 12px "Courier New", monospace';
      ctx.fillStyle = secondaryColor;
      ctx.fillText(`CONF: ${confidenceText}`, scaledX1 + 10, scaledY1 - 10);

      // Draw futuristic facial landmarks (neural nodes)
      if (detection.landmarks && detection.landmarks.length > 0) {
        const maxLandmarks = Math.min(detection.landmarks.length, 5);
        for (let i = 0; i < maxLandmarks; i++) {
          if (!detection.landmarks[i] || detection.landmarks[i].length < 2)
            continue;

          const [x, y] = detection.landmarks[i];
          if (isNaN(x) || isNaN(y)) continue;

          // Landmarks are in capture coordinate space; map using same scaling and offsets
          const scaledLandmarkX = (x * scaleX) - offsetX;
          const scaledLandmarkY = (y * scaleY) - offsetY;

          // Validate scaled landmark coordinates
          if (!isFinite(scaledLandmarkX) || !isFinite(scaledLandmarkY))
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
          const rect = video.getBoundingClientRect();

          // Update canvas size to match current video display size (with stability threshold)
          const newWidth = Math.round(rect.width);
          const newHeight = Math.round(rect.height);
          const sizeDiffThreshold = 10; // Increased threshold to prevent micro-adjustments

          const widthDiff = Math.abs(canvas.width - newWidth);
          const heightDiff = Math.abs(canvas.height - newHeight);

          if (widthDiff > sizeDiffThreshold || heightDiff > sizeDiffThreshold) {
            canvas.width = newWidth;
            canvas.height = newHeight;
            canvas.style.width = `${newWidth}px`;
            canvas.style.height = `${newHeight}px`;

            // Redraw detections with new size
            drawDetections();
          }
        }
      }, 200); // Increased debounce time
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(resizeTimeout);
    };
  }, [drawDetections]);

  // Initialize data from persistent database
  useEffect(() => {
    const initializeData = async () => {
      try {
        // Check if database is available
        const isAvailable = await sqliteFaceLogService.isAvailable();
        setDbConnected(isAvailable);
        
        if (isAvailable) {
          // Load recent logs
          const logs = await sqliteFaceLogService.getRecentLogs(10);
          setRecentLogs(logs);
          
          // Load today's stats
          const stats = await sqliteFaceLogService.getTodayStats();
          setSystemStats(prev => ({
            ...prev,
            today_records: stats.totalDetections
          }));
        }
      } catch {
        setDbConnected(false);
      }
    };

    initializeData();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
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
    };
  }, [stopCamera]);

  return (
    <div className="bg-black text-white flex flex-col">

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        {/* Video Section */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Video Container */}
          <div className="relative flex flex-1 min-h-0 items-center justify-center px-4 pt-4">
            <div className="relative w-full h-full min-h-[260px] overflow-hidden rounded-lg bg-white/[0.02] backdrop-blur-xl border border-white/[0.08]">
              <video
                ref={videoRef}
                className="absolute inset-0 w-full h-full object-cover"
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
                <div className="absolute top-2 left-2 bg-black/70 backdrop-blur-sm rounded px-3 py-2">
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
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
                  >
                    Log Detection
                  </button>
                </div>
              )}

              {/* Registration Input */}
              {registrationMode && (
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black/80 backdrop-blur-sm rounded-lg p-4">
                  <div className="flex items-center space-x-3">
                    <input
                      type="text"
                      value={newPersonId}
                      onChange={(e) => setNewPersonId(e.target.value)}
                      placeholder="Enter person name"
                      className="bg-white/[0.05] text-white px-3 py-2 rounded border border-white/[0.1] focus:border-blue-500 focus:outline-none placeholder-white/50"
                    />
                    <button
                      onClick={registerFace}
                      disabled={!newPersonId.trim() || detectionResults.length === 0}
                      className="bg-green-600 hover:bg-green-700 disabled:bg-white/[0.05] disabled:text-white/40 text-white px-4 py-2 rounded font-medium transition-colors"
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
            <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-lg p-4 flex items-center justify-between">
              <div className="flex items-center space-x-6">
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${cameraStatus === 'recognition' ? 'bg-green-500' : 'bg-white/40'}`}></div>
                  <span className="text-sm text-white/60">
                    {cameraStatus === 'recognition' ? 'Detection: Active' : 'Detection: Inactive'}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  <span className="text-sm text-white/60">
                    Camera: {isStreaming ? 'Active' : 'Stopped'}
                  </span>
                </div>
                <div className="text-sm text-white/60">
                  Processing: {processingTime.toFixed(1)}ms
                </div>
              </div>
              
              <div className="flex items-center space-x-3">
                <button
                  onClick={isStreaming ? stopCamera : startCamera}
                  className={`px-4 py-2 rounded font-medium transition-colors ${
                    isStreaming
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : 'bg-green-600 hover:bg-green-700 text-white'
                  }`}
                >
                  {isStreaming ? 'Stop Camera' : 'Start Camera'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-80 pb-2 bg-white/[0.02] backdrop-blur-xl border-l border-white/[0.08] flex flex-col h-[84vh]">
          {/* Stats Panel */}
          <div className="px-4 pt-2 pb-4 border-b border-white/[0.08]">
            <h3 className="text-lg font-light mb-3">System Status</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-white/60">Database</span>
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${dbConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  <span className="text-sm">{dbConnected ? 'Connected' : 'Error'}</span>
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

              {/* Mode and Register controls moved from header */}
              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-white/60">Mode:</span>
                  <button
                    onClick={() => setLoggingMode(loggingMode === 'auto' ? 'manual' : 'auto')}
                    className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                      loggingMode === 'auto' 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-white/[0.05] text-white/70 hover:bg-white/[0.08] border border-white/[0.1]'
                    }`}
                  >
                    {loggingMode === 'auto' ? 'Auto' : 'Manual'}
                  </button>
                </div>
                <button
                  onClick={() => setRegistrationMode(!registrationMode)}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
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
            <div className="space-y-2">
              {detectionResults.length === 0 ? (
                <div className="text-white/50 text-sm text-center py-4">
                  No faces detected
                </div>
              ) : (
                detectionResults.map((detection, index) => (
                  <div key={index} className="bg-white/[0.05] backdrop-blur-xl border border-white/[0.08] rounded p-3">
                    <div className="flex justify-between items-center">
                      <span className="font-medium">
                        {detection.recognition?.personId || 'Unknown'}
                      </span>
                      <span className="text-sm text-white/60">
                        {(detection.confidence * 100).toFixed(1)}%
                      </span>
                    </div>
                    {detection.recognition?.similarity && (
                      <div className="text-xs text-white/50 mt-1">
                        Similarity: {(detection.recognition.similarity * 100).toFixed(1)}%
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Recent Logs */}
          <div className="flex-1 p-4 overflow-hidden min-h-0">
            <h3 className="text-lg font-light mb-4">Recent Logs</h3>
            <div className="space-y-2 h-full overflow-y-auto recent-logs-scroll">
              {recentLogs.length === 0 ? (
                <div className="text-white/50 text-sm text-center py-4">
                  No logs yet
                </div>
              ) : (
                recentLogs.map((log, index) => (
                  <div key={index} className="bg-white/[0.05] backdrop-blur-xl border border-white/[0.08] rounded p-3">
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
