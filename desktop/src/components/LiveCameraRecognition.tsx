import { useState, useRef, useCallback, useEffect } from "react";
import { FaceRecognitionWorkerManager } from "../services/FaceRecognitionWorkerManager";

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

  // Attendance tracking states
  const [attendanceMode, setAttendanceMode] = useState(false);
  const [currentDetectedPerson, setCurrentDetectedPerson] = useState<
    string | null
  >(null);
  const [stableDetectionCount, setStableDetectionCount] = useState(0);
  const [attendanceStatus, setAttendanceStatus] = useState<
    "waiting" | "detecting" | "confirmed" | "recorded"
  >("waiting");

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const canvasInitializedRef = useRef(false);
  const lastCaptureRef = useRef(0);
  const captureIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Worker manager for face detection and recognition (non-blocking)
  const workerManagerRef = useRef<FaceRecognitionWorkerManager | null>(null);

  // Processing state management
  const processingActiveRef = useRef(false);
  const acceptDetectionUpdatesRef = useRef(true);

  // Define startProcessing first (will be defined later with useCallback)
  const startProcessingRef = useRef<(() => void) | null>(null);

  // Initialize worker-based face detection and recognition pipeline
  const initializePipeline = useCallback(async () => {
    try {
      console.log(
        "Initializing worker-based face detection and recognition..."
      );

      // Create and initialize worker manager
      if (!workerManagerRef.current) {
        workerManagerRef.current = new FaceRecognitionWorkerManager();
      }

      // Initialize the worker (this handles both SCRFD and EdgeFace initialization)
      console.log("🔄 Initializing worker pipeline...");
      await workerManagerRef.current.initialize();

      // Load existing database and get stats
      const stats = await workerManagerRef.current.getStats();
      setSystemStats((prev) => ({
        ...prev,
        total_people: stats.totalPersons,
      }));

      console.log("✅ Worker pipeline ready - RESEARCH-GRADE ACCURACY!");
      console.log(`📊 Database loaded: ${stats.totalPersons} persons`);

      setCameraStatus("recognition");

      // Start processing immediately
      setTimeout(() => {
        console.log(
          "Starting real-time processing with worker-based face recognition"
        );
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
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
          frameRate: { ideal: 60, min: 30 }, // High FPS for smooth display
          facingMode: "user",
          // Disable ALL video processing that can cause delays
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        audio: false,
      });

      console.log("Camera stream obtained");

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;

        videoRef.current.onloadedmetadata = () => {
          console.log("Video metadata loaded, starting playback");

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

              console.log(
                "Canvas initialized with stable size:",
                canvas.width,
                "x",
                canvas.height
              );
              console.log(
                "Video natural size:",
                video.videoWidth,
                "x",
                video.videoHeight
              );
              console.log(
                "Video display size:",
                stableWidth,
                "x",
                stableHeight
              );
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

    // Reset attendance tracking states
    setCurrentDetectedPerson(null);
    setStableDetectionCount(0);
    setAttendanceStatus("waiting");

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
      // Use even smaller resolution for faster processing (480x360 max for real-time)
      const maxWidth = 480; // Reduced from 640
      const maxHeight = 360; // Reduced from 480
      const aspectRatio = video.videoWidth / video.videoHeight;

      if (aspectRatio > 1) {
        // Landscape
        captureCanvasRef.current.width = Math.min(maxWidth, video.videoWidth);
        captureCanvasRef.current.height = Math.min(
          maxHeight,
          captureCanvasRef.current.width / aspectRatio
        );
      } else {
        // Portrait
        captureCanvasRef.current.height = Math.min(
          maxHeight,
          video.videoHeight
        );
        captureCanvasRef.current.width = Math.min(
          maxWidth,
          captureCanvasRef.current.height * aspectRatio
        );
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
      const maxWidth = 480; // Reduced from 640
      const maxHeight = 360; // Reduced from 480

      if (currentAspectRatio > 1) {
        tempCanvas.width = Math.min(maxWidth, video.videoWidth);
        tempCanvas.height = tempCanvas.width / currentAspectRatio;
      } else {
        tempCanvas.height = Math.min(maxHeight, video.videoHeight);
        tempCanvas.width = tempCanvas.height * currentAspectRatio;
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
      // Log frame skips every 20 skips to monitor performance
      if (frameSkipCount.current % 20 === 0) {
        console.log(
          `⚡ Skipped ${frameSkipCount.current} frames for optimal performance`
        );
      }
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

        // Attendance tracking logic - enhanced with real recognition
        if (attendanceMode && validDetections.length > 0) {
          // Find the largest detection for attendance tracking
          const largestDetection = validDetections.reduce(
            (largest, current) => {
              const currentArea =
                (current.bbox[2] - current.bbox[0]) *
                (current.bbox[3] - current.bbox[1]);
              const largestArea = largest
                ? (largest.bbox[2] - largest.bbox[0]) *
                  (largest.bbox[3] - largest.bbox[1])
                : 0;
              return currentArea > largestArea ? current : largest;
            },
            validDetections[0]
          );

          // Check if face is centered and stable
          if (imageData && largestDetection) {
            const [x1, y1, x2, y2] = largestDetection.bbox;
            const centerX = (x1 + x2) / 2;
            const centerY = (y1 + y2) / 2;
            const imgCenterX = (videoRef.current?.videoWidth || 640) / 2;
            const imgCenterY = (videoRef.current?.videoHeight || 480) / 2;

            // Check if face is reasonably centered (within 20% of center)
            const isCentered =
              Math.abs(centerX - imgCenterX) <
                (videoRef.current?.videoWidth || 640) * 0.2 &&
              Math.abs(centerY - imgCenterY) <
                (videoRef.current?.videoHeight || 480) * 0.2;

            if (isCentered && largestDetection.confidence > 0.5) {
              const recognizedId =
                largestDetection.recognition?.personId || "unknown";

              if (
                currentDetectedPerson === recognizedId ||
                currentDetectedPerson === null
              ) {
                setCurrentDetectedPerson(recognizedId);
                setStableDetectionCount((prev) => prev + 1);

                if (stableDetectionCount < 10) {
                  setAttendanceStatus("detecting");
                } else if (
                  stableDetectionCount >= 10 &&
                  stableDetectionCount < 30
                ) {
                  setAttendanceStatus("confirmed");
                } else if (stableDetectionCount >= 30) {
                  setAttendanceStatus("recorded");
                  // Auto-record attendance after 2 seconds of stable detection
                  setTimeout(() => {
                    console.log(`📝 Attendance recorded for ${recognizedId}`);
                    setSystemStats((prev) => ({
                      ...prev,
                      today_records: prev.today_records + 1,
                    }));
                    setAttendanceStatus("waiting");
                    setStableDetectionCount(0);
                    setCurrentDetectedPerson(null);
                  }, 1000);
                }
              } else {
                // Different person detected, reset counter
                setStableDetectionCount(0);
                setAttendanceStatus("waiting");
                setCurrentDetectedPerson(recognizedId);
              }
            } else {
              // Reset if face moves or confidence drops
              setStableDetectionCount(0);
              setAttendanceStatus("waiting");
              setCurrentDetectedPerson(null);
            }
          }
        } else if (attendanceMode) {
          // No detections - reset
          setStableDetectionCount(0);
          setAttendanceStatus("waiting");
          setCurrentDetectedPerson(null);
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
    attendanceMode,
    stableDetectionCount,
    currentDetectedPerson,
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

    console.log(
      "Ultra-optimized processing started - adaptive frame rate (20-30 FPS max) for optimal CPU usage"
    );
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

        console.log(
          `🎉 ${newPersonId} registered in EdgeFace database and persisted to localStorage`
        );
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
    // Detection coordinates are in capture canvas resolution (480x360 or smaller)
    // We need to scale them to display canvas resolution

    // Get the capture canvas dimensions used for detection
    const captureWidth = captureCanvasRef.current?.width || 480;
    const captureHeight = captureCanvasRef.current?.height || 360;

    // Scale from capture canvas coordinates to display canvas coordinates
    const scaleX = displayWidth / captureWidth;
    const scaleY = displayHeight / captureHeight;

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

      // Scale coordinates from capture canvas size to display canvas size
      const scaledX1 = x1 * scaleX;
      const scaledY1 = y1 * scaleY;
      const scaledX2 = x2 * scaleX;
      const scaledY2 = y2 * scaleY;

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

          // Scale landmarks from video natural size to display size
          const scaledLandmarkX = x * scaleX;
          const scaledLandmarkY = y * scaleY;

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
            console.log(
              `Resize: Canvas ${canvas.width}x${canvas.height} → ${newWidth}x${newHeight}`
            );
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
    <div className="bg-black text-white mt-10 pb-2">
      {/* Main Content */}
      <div className="flex justify-evenly">
        <div className="flex flex-col justify-between">
          {/* Video Stream */}
          <div className="flex-1 relative flex items-center justify-center">
            <div className="relative w-full max-w-4xl aspect-video overflow-hidden rounded-lg">
              {/* Video element - primary display */}
              <video
                ref={videoRef}
                className="w-full h-full object-cover block"
                style={{
                  display: "block",
                  maxWidth: "100%",
                  maxHeight: "100%",
                }}
                autoPlay
                playsInline
                muted
              />

              {/* Canvas overlay for detections only */}
              <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 w-full h-full pointer-events-none"
                style={{
                  zIndex: 10,
                  mixBlendMode: "normal",
                }}
              />

              {/* Status Overlay */}
              {cameraStatus === "starting" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
                    <div className="text-white text-lg">Starting Camera...</div>
                  </div>
                </div>
              )}

              {cameraStatus === "preview" && (
                <div className="absolute top-4 left-4 bg-black/50 px-3 py-1 rounded text-sm">
                  Preview Mode - Loading Recognition...
                </div>
              )}

              {cameraStatus === "recognition" && (
                <div className="absolute top-4 left-4 bg-green-500/50 px-3 py-1 rounded text-sm">
                  Recognition Active
                </div>
              )}

              {/* Attendance Mode Overlay */}
              {attendanceMode && (
                <div className="absolute inset-0 pointer-events-none">
                  {/* Center guide */}
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                    <div className="w-64 h-64 border-2 border-dashed border-white/50 rounded-lg flex items-center justify-center">
                      <div className="text-center">
                        <div className="text-white/70 text-sm mb-2">
                          Position your face here
                        </div>
                        <div className="w-4 h-4 bg-white/50 rounded-full mx-auto"></div>
                      </div>
                    </div>
                  </div>

                  {/* Attendance Status */}
                  <div className="absolute top-4 right-4 bg-black/70 px-4 py-2 rounded-lg">
                    <div className="text-white text-sm font-medium mb-1">
                      Attendance Mode
                    </div>
                    <div
                      className={`text-sm ${
                        attendanceStatus === "waiting"
                          ? "text-gray-400"
                          : attendanceStatus === "detecting"
                          ? "text-yellow-400"
                          : attendanceStatus === "confirmed"
                          ? "text-blue-400"
                          : "text-green-400"
                      }`}
                    >
                      {attendanceStatus === "waiting" &&
                        "👀 Looking for face..."}
                      {attendanceStatus === "detecting" &&
                        `🎯 Detecting... ${stableDetectionCount}/10`}
                      {attendanceStatus === "confirmed" &&
                        `✅ Confirmed! ${stableDetectionCount}/30`}
                      {attendanceStatus === "recorded" &&
                        "📝 Recording attendance..."}
                    </div>
                  </div>

                  {/* Instructions */}
                  <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black/70 px-6 py-3 rounded-lg">
                    <div className="text-white text-sm text-center">
                      <div className="font-medium mb-1">Instructions:</div>
                      <div>1. Position face in center box</div>
                      <div>2. Stay still for 2 seconds</div>
                      <div>3. Wait for green confirmation</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-center space-x-6 mt-2 flex-row-reverse">
            <button
              onClick={isStreaming ? stopCamera : startCamera}
              className={`px-8 py-3 rounded-xl text-sm font-light backdrop-blur-xl border transition-all duration-500 ${
                isStreaming
                  ? "bg-white/[0.08] border-white/[0.15] text-white hover:bg-white/[0.12]"
                  : "bg-white/[0.05] border-white/[0.10] text-white/80 hover:bg-white/[0.08]"
              }`}
            >
              {isStreaming ? "⏹ Stop Camera" : "▶ Start Camera"}
            </button>

            <button
              onClick={() => setRegistrationMode(!registrationMode)}
              className={`px-6 py-3 rounded-xl text-sm font-light backdrop-blur-xl border transition-all duration-500 ${
                registrationMode
                  ? "bg-blue-500/20 border-blue-400/30 text-blue-300"
                  : "bg-white/[0.05] border-white/[0.10] text-white/80 hover:bg-white/[0.08]"
              }`}
            >
              {registrationMode ? "✕ Cancel" : "👤 Register Face"}
            </button>

            <button
              onClick={() => setAttendanceMode(!attendanceMode)}
              className={`px-6 py-3 rounded-xl text-sm font-light backdrop-blur-xl border transition-all duration-500 ${
                attendanceMode
                  ? "bg-green-500/20 border-green-400/30 text-green-300"
                  : "bg-white/[0.05] border-white/[0.10] text-white/80 hover:bg-white/[0.08]"
              }`}
            >
              {attendanceMode ? "✅ Stop Attendance" : "📝 Mark Attendance"}
            </button>

            <div className="flex items-center space-x-4 mr-5 text-sm">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 rounded-full bg-green-400"></div>
                <span>Camera: {cameraStatus}</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 rounded-full bg-purple-400"></div>
                <span>Processing: <span className="font-mono w-16 inline-block text-right">{processingTime.toFixed(2)}ms</span></span>
              </div>
            </div>
          </div>
        </div>
        {/* Sidebar */}
        <div className="w-80 bg-white/[0.02] border-l border-white/[0.1] p-6">
          {/* Registration Form */}
          {registrationMode && (
            <div className="mb-6 p-4 bg-white/[0.05] rounded-lg border border-white/[0.1]">
              <h3 className="text-lg font-medium mb-4">Register New Person</h3>
              <div className="space-y-4">
                <input
                  type="text"
                  value={newPersonId}
                  onChange={(e) => setNewPersonId(e.target.value)}
                  placeholder="Enter Person ID"
                  className="w-full px-3 py-2 bg-white/[0.05] border border-white/[0.1] rounded text-white placeholder-white/50"
                />
                <div className="flex space-x-2">
                  <button
                    onClick={registerFace}
                    className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                  >
                    Register
                  </button>
                  <button
                    onClick={() => setRegistrationMode(false)}
                    className="px-4 py-2 bg-white/[0.1] text-white rounded hover:bg-white/[0.2] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Attendance Status */}
          {attendanceMode && (
            <div className="mb-6 p-4 bg-green-500/10 rounded-lg border border-green-500/30">
              <h3 className="text-lg font-medium mb-4 text-green-300">
                Attendance Mode Active
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-white/70">Status:</span>
                  <span
                    className={`font-medium ${
                      attendanceStatus === "waiting"
                        ? "text-gray-400"
                        : attendanceStatus === "detecting"
                        ? "text-yellow-400"
                        : attendanceStatus === "confirmed"
                        ? "text-blue-400"
                        : "text-green-400"
                    }`}
                  >
                    {attendanceStatus === "waiting" && "Waiting for face"}
                    {attendanceStatus === "detecting" && "Detecting face"}
                    {attendanceStatus === "confirmed" && "Face confirmed"}
                    {attendanceStatus === "recorded" && "Attendance recorded"}
                  </span>
                </div>
                {attendanceStatus !== "waiting" && (
                  <div className="flex justify-between">
                    <span className="text-white/70">Progress:</span>
                    <span className="text-white">
                      {stableDetectionCount}/
                      {attendanceStatus === "detecting" ? "10" : "30"}
                    </span>
                  </div>
                )}
                {currentDetectedPerson && (
                  <div className="flex justify-between">
                    <span className="text-white/70">Person:</span>
                    <span className="text-white">{currentDetectedPerson}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Detection Results */}
          <div className="mb-6">
            <h3 className="text-lg font-medium mb-4">Live Detections</h3>
            <div className="max-h-56 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-white/5 space-y-2">
              {detectionResults.length === 0 ? (
                <div className="text-white/50 text-sm">No faces detected</div>
              ) : (
                detectionResults.map((detection, index) => (
                  <div
                    key={index}
                    className="p-3 bg-white/[0.05] rounded border border-white/[0.1]"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">
                        {detection.recognition?.personId || "Unknown"}
                      </span>
                      <span className="text-xs text-white/60">
                        {detection.confidence.toFixed(2)}
                      </span>
                    </div>
                    {detection.recognition?.personId && (
                      <div className="text-xs text-green-400">
                        Similarity:{" "}
                        {(detection.recognition.similarity * 100).toFixed(1)}%
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* System Stats */}
          <div className="mb-6">
            <h3 className="text-lg font-medium mb-4">System Status</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-white/70">People in DB:</span>
                <span className="text-white">{systemStats.total_people}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/70">Today's Records:</span>
                <span className="text-white">{systemStats.today_records}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/70">Processing Time:</span>
                <span className="text-purple-400">
                  {processingTime.toFixed(2)}ms
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
