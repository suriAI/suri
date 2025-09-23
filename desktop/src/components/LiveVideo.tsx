import { useState, useEffect, useRef, useCallback } from 'react';
import { BackendService } from '../services/BackendService';
import { Settings } from './Settings';
import type { 
  PersonInfo, 
  FaceRecognitionResponse,
} from '../types/recognition';

interface DetectionResult {
  faces: Array<{
    bbox: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    confidence: number;
    landmarks: {
      right_eye: { x: number; y: number };
      left_eye: { x: number; y: number };
      nose_tip: { x: number; y: number };
      right_mouth_corner: { x: number; y: number };
      left_mouth_corner: { x: number; y: number };
    };
    antispoofing?: {
      is_real: boolean | null;
      confidence: number;
      status: 'real' | 'fake' | 'error';
    };
  }>;
  model_used: string;
  processing_time: number;
}

interface LiveVideoProps {
  onBack?: () => void;
}

interface WebSocketFaceData {
  bbox?: number[];
  confidence?: number;
  landmarks?: number[][];
  antispoofing?: {
    is_real?: boolean | null;
    confidence?: number;
    status?: 'real' | 'fake' | 'error';
  };
}

interface WebSocketDetectionResponse {
  faces?: WebSocketFaceData[];
  model_used?: string;
  processing_time?: number;
}

interface WebSocketConnectionMessage {
  message?: string;
  status?: string;
}

interface WebSocketErrorMessage {
  message?: string;
  error?: string;
}

interface WebSocketPongMessage {
  timestamp?: number;
  message?: string;
}

export default function LiveVideo({ onBack }: LiveVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const detectionIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const detectionEnabledRef = useRef<boolean>(false);
  const backendServiceRef = useRef<BackendService | null>(null);
  const isProcessingRef = useRef<boolean>(false);
  
  // Performance optimization refs
  const lastCanvasSizeRef = useRef<{width: number, height: number}>({width: 0, height: 0});
  const lastVideoSizeRef = useRef<{width: number, height: number}>({width: 0, height: 0});
  const scaleFactorsRef = useRef<{scaleX: number, scaleY: number, offsetX: number, offsetY: number}>({scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0});
  const lastDetectionHashRef = useRef<string>('');

  const [isStreaming, setIsStreaming] = useState(false);
  const [detectionEnabled, setDetectionEnabled] = useState(false);
  const [currentDetections, setCurrentDetections] = useState<DetectionResult | null>(null);
  const [detectionFps, setDetectionFps] = useState<number>(0);
  const [websocketStatus, setWebsocketStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [backendServiceReady, setBackendServiceReady] = useState(false);
  const lastDetectionRef = useRef<DetectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('');
  
  // Anti-spoofing settings
  const [antispoofingEnabled, setAntispoofingEnabled] = useState(true);

  // Face recognition settings
  const [recognitionEnabled, setRecognitionEnabled] = useState(true);
  const [registeredPersons, setRegisteredPersons] = useState<PersonInfo[]>([]);

  const [newPersonId, setNewPersonId] = useState<string>('');
  const [showRegistrationDialog, setShowRegistrationDialog] = useState(false);
  const [currentRecognitionResults, setCurrentRecognitionResults] = useState<Map<number, FaceRecognitionResponse>>(new Map());

  // Performance tracking - throttled updates
  const detectionCounterRef = useRef({ detections: 0, lastTime: Date.now() });

  // Settings view state
  const [showSettings, setShowSettings] = useState(false);

  // Optimized capture frame with reduced logging
  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas || video.videoWidth === 0) {
      return null;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    // Only resize canvas if video dimensions changed
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    // Draw current video frame
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert to base64 with reduced quality for better performance
    const base64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
    return base64;
  }, []);

  // Face recognition function
  const performFaceRecognition = useCallback(async (detectionResult: DetectionResult) => {
    try {
      const frameData = captureFrame();
      if (!frameData) {
        console.warn('⚠️ Failed to capture frame for face recognition');
        return;
      }

      // Process each detected face for recognition
      const recognitionPromises = detectionResult.faces.map(async (face, index) => {
        try {
          // Convert landmarks to the format expected by backend: [[x1,y1], [x2,y2], ...]
          const landmarks = [
            [face.landmarks.right_eye.x, face.landmarks.right_eye.y],
            [face.landmarks.left_eye.x, face.landmarks.left_eye.y],
            [face.landmarks.nose_tip.x, face.landmarks.nose_tip.y],
            [face.landmarks.right_mouth_corner.x, face.landmarks.right_mouth_corner.y],
            [face.landmarks.left_mouth_corner.x, face.landmarks.left_mouth_corner.y]
          ];
          
          if (!backendServiceRef.current) {
            console.error('Backend service not initialized');
            return null;
          }
          
          const response = await backendServiceRef.current.recognizeFace(
            frameData,
            landmarks
          );

          if (response.success && response.person_id) {
            console.log(`🎯 Face ${index} recognized as: ${response.person_id} (${((response.similarity || 0) * 100).toFixed(1)}%)`);
            return { index, result: response };
          } else if (response.success) {
            console.log(`👤 Face ${index} not recognized (similarity: ${((response.similarity || 0) * 100).toFixed(1)}%)`);
          }
        } catch (error) {
          console.warn(`⚠️ Face recognition failed for face ${index}:`, error);
        }
        return null;
      });

      const recognitionResults = await Promise.all(recognitionPromises);
      
      // Update recognition results map
      const newRecognitionResults = new Map(currentRecognitionResults);
      recognitionResults.forEach((result) => {
        if (result) {
          newRecognitionResults.set(result.index, result.result);
        }
      });
      
      setCurrentRecognitionResults(newRecognitionResults);

      if (process.env.NODE_ENV === 'development') {
        const recognizedCount = recognitionResults.filter(r => r?.result.person_id).length;
        if (recognizedCount > 0) {
          console.log(`🎯 Face recognition: ${recognizedCount}/${detectionResult.faces.length} faces recognized`);
        }
      }
    } catch (error) {
      console.error('❌ Face recognition processing failed:', error);
    }
  }, [captureFrame, currentRecognitionResults]);

  // Initialize WebSocket connection
  const initializeWebSocket = useCallback(async () => {
    try {
      if (!backendServiceRef.current) {
        backendServiceRef.current = new BackendService();
      }

      // Connect to WebSocket
      await backendServiceRef.current.connectWebSocket();
      
      // Mark backend service as ready
      setBackendServiceReady(true);
        
        // Register message handler for detection responses
        backendServiceRef.current.onMessage('detection_response', (data: WebSocketDetectionResponse) => {
        // Reduced logging for performance
        if (process.env.NODE_ENV === 'development') {
          console.log('📨 Detection response received');
        }
        
        // Update detection FPS - throttled
        detectionCounterRef.current.detections++;
        const now = Date.now();
        const elapsed = now - detectionCounterRef.current.lastTime;
        
        if (elapsed >= 1000) {
          setDetectionFps(Math.round((detectionCounterRef.current.detections * 1000) / elapsed));
          detectionCounterRef.current.detections = 0;
          detectionCounterRef.current.lastTime = now;
        }

        // Process the detection result
        if (data.faces && Array.isArray(data.faces)) {
          const detectionResult: DetectionResult = {
            faces: data.faces.map((face: WebSocketFaceData) => {
              // Safe extraction of face data with fallbacks
              const bbox = face.bbox || [0, 0, 0, 0];
              const landmarks = face.landmarks || [];
              
              return {
                bbox: {
                  x: bbox[0] || 0,
                  y: bbox[1] || 0,
                  width: bbox[2] || 0,
                  height: bbox[3] || 0
                },
                confidence: face.confidence || 0,
                landmarks: {
                  right_eye: { 
                    x: (landmarks[0] && landmarks[0][0]) || 0, 
                    y: (landmarks[0] && landmarks[0][1]) || 0 
                  },
                  left_eye: { 
                    x: (landmarks[1] && landmarks[1][0]) || 0, 
                    y: (landmarks[1] && landmarks[1][1]) || 0 
                  },
                  nose_tip: { 
                    x: (landmarks[2] && landmarks[2][0]) || 0, 
                    y: (landmarks[2] && landmarks[2][1]) || 0 
                  },
                  right_mouth_corner: { 
                    x: (landmarks[3] && landmarks[3][0]) || 0, 
                    y: (landmarks[3] && landmarks[3][1]) || 0 
                  },
                  left_mouth_corner: { 
                    x: (landmarks[4] && landmarks[4][0]) || 0, 
                    y: (landmarks[4] && landmarks[4][1]) || 0 
                  }
                },
                antispoofing: face.antispoofing ? {
                  is_real: face.antispoofing.is_real ?? null,
                  confidence: face.antispoofing.confidence || 0,
                  status: face.antispoofing.status || 'error'
                } : undefined
              };
            }),
            model_used: data.model_used || 'unknown',
            processing_time: data.processing_time || 0
          };

          setCurrentDetections(detectionResult);
          lastDetectionRef.current = detectionResult;

          // Perform face recognition if enabled
          if (recognitionEnabled && detectionResult.faces.length > 0) {
            performFaceRecognition(detectionResult);
          }
        }

        // Mark processing as complete - interval will handle next frame
        isProcessingRef.current = false;
      });

      // Handle connection messages
      backendServiceRef.current.onMessage('connection', (data: WebSocketConnectionMessage) => {
        if (process.env.NODE_ENV === 'development') {
          console.log('🔗 WebSocket connection message:', data);
        }
      });

      // Handle error messages
      backendServiceRef.current.onMessage('error', (data: WebSocketErrorMessage) => {
        console.error('❌ WebSocket error message:', data);
        setError(`Detection error: ${data.message || 'Unknown error'}`);
        isProcessingRef.current = false;
        // Don't immediately process next frame on error to prevent infinite loops
        // The interval will handle the next frame
      });

      // Handle pong messages
      backendServiceRef.current.onMessage('pong', (data: WebSocketPongMessage) => {
        if (process.env.NODE_ENV === 'development') {
          console.log('🏓 WebSocket pong received:', data);
        }
      });

      // Status will be managed by polling the actual WebSocket state
      if (process.env.NODE_ENV === 'development') {
        console.log('✅ WebSocket initialized');
      }
      
    } catch (error) {
      console.error('❌ WebSocket initialization failed:', error);
      setError('Failed to connect to real-time detection service');
      setBackendServiceReady(false);
    }
  }, [recognitionEnabled, performFaceRecognition]);

  // Process current frame directly without queue
  const processCurrentFrame = useCallback(() => {
    // Ensure we're in a valid state and not already processing
    if (isProcessingRef.current || 
        !backendServiceRef.current?.isWebSocketReady() || 
        !detectionEnabledRef.current ||
        !isStreaming) {
      return;
    }

    try {
      const frameData = captureFrame();
      if (!frameData || !backendServiceRef.current) {
        return;
      }

      isProcessingRef.current = true;
      
      backendServiceRef.current.sendDetectionRequest(frameData, {
        model_type: 'yunet',
        confidence_threshold: 0.5,
        nms_threshold: 0.3,
        enable_antispoofing: antispoofingEnabled
      }).catch(error => {
        console.error('❌ WebSocket detection request failed:', error);
        isProcessingRef.current = false;
      });
    } catch (error) {
      console.error('❌ Frame capture failed:', error);
      isProcessingRef.current = false;
    }
  }, [antispoofingEnabled, isStreaming, captureFrame]);

  // Get available camera devices
  const getCameraDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      setCameraDevices(videoDevices);
      if (videoDevices.length > 0 && !selectedCamera) {
        setSelectedCamera(videoDevices[0].deviceId);
      }
    } catch (err) {
      console.error('Error getting camera devices:', err);
      setError('Failed to get camera devices');
    }
  }, [selectedCamera]);

  // Direct frame processing without queuing for real-time detection
  const processFrameForDetection = useCallback(() => {
    // Simply call processCurrentFrame directly - no queuing needed
    processCurrentFrame();
  }, [processCurrentFrame]);

  // Start detection interval helper
  const startDetectionInterval = useCallback(() => {
    if (detectionEnabledRef.current && 
        backendServiceRef.current?.isWebSocketReady() && 
        !detectionIntervalRef.current) {
      // Optimized frequency based on processing time (~70ms)
      detectionIntervalRef.current = setInterval(processFrameForDetection, 100); // 100ms = 10 FPS
      if (process.env.NODE_ENV === 'development') {
        console.log('🎯 Detection interval started');
      }
    }
  }, [processFrameForDetection]);

  // Start camera stream
  const startCamera = useCallback(async () => {
    try {
      setError(null);
      
      // Refresh camera devices list to ensure we have current devices
      await getCameraDevices();
      
      // Stop existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: selectedCamera ? { exact: selectedCamera } : undefined,
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setIsStreaming(true);
        
        // Automatically start detection when camera starts
        setDetectionEnabled(true);
        detectionEnabledRef.current = true;
        
        if (websocketStatus === 'disconnected') {
          try {
            await initializeWebSocket();
            // Detection interval will be started by the useEffect that monitors websocketStatus
          } catch (error) {
            console.error('❌ Failed to initialize WebSocket:', error);
            setDetectionEnabled(false);
            detectionEnabledRef.current = false;
            setError('Failed to connect to detection service');
          }
        } else if (websocketStatus === 'connected') {
          // WebSocket is already connected, start detection immediately
          startDetectionInterval();
        }
        // If websocketStatus is 'connecting', the useEffect will handle starting detection when connected
      }
    } catch (err) {
      console.error('Error starting camera:', err);
      setError('Failed to start camera. Please check permissions.');
    }
  }, [selectedCamera, websocketStatus, initializeWebSocket, startDetectionInterval, getCameraDevices]);

  // Stop camera stream
  const stopCamera = useCallback(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('🛑 stopCamera called - cleaning up all resources');
    }
    
    // Stop media stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop();
      });
      streamRef.current = null;
    }
    
    // Clear video element srcObject
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    // Stop detection
    setDetectionEnabled(false);
    detectionEnabledRef.current = false;
    setIsStreaming(false);
    
    // Reset processing state
    isProcessingRef.current = false;
    
    // Disconnect WebSocket
    if (backendServiceRef.current) {
      backendServiceRef.current.disconnect();
    }
    setWebsocketStatus('disconnected');
    
    // Clear all intervals and animation frames
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }
    
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = undefined;
    }
    
    // Clear detection results
    setCurrentDetections(null);
    
    // Clear overlay canvas immediately
    const overlayCanvas = overlayCanvasRef.current;
    if (overlayCanvas) {
      const ctx = overlayCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
    }
    
    if (process.env.NODE_ENV === 'development') {
      console.log('✅ Camera stopped successfully');
    }
  }, []);



  // Memoized scale calculation to avoid recalculation
  const calculateScaleFactors = useCallback(() => {
    const video = videoRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    
    if (!video || !overlayCanvas) return null;

    // Check if video dimensions changed
    const currentVideoWidth = video.videoWidth;
    const currentVideoHeight = video.videoHeight;
    
    if (lastVideoSizeRef.current.width === currentVideoWidth && 
        lastVideoSizeRef.current.height === currentVideoHeight &&
        lastCanvasSizeRef.current.width === overlayCanvas.width &&
        lastCanvasSizeRef.current.height === overlayCanvas.height) {
      return scaleFactorsRef.current; // Return cached values
    }

    // Update cached sizes
    lastVideoSizeRef.current = { width: currentVideoWidth, height: currentVideoHeight };
    lastCanvasSizeRef.current = { width: overlayCanvas.width, height: overlayCanvas.height };

    const displayWidth = overlayCanvas.width;
    const displayHeight = overlayCanvas.height;

    const videoAspectRatio = currentVideoWidth / currentVideoHeight;
    const containerAspectRatio = displayWidth / displayHeight;
    
    let actualVideoWidth: number;
    let actualVideoHeight: number;
    let offsetX = 0;
    let offsetY = 0;
    
    if (videoAspectRatio > containerAspectRatio) {
      actualVideoWidth = displayWidth;
      actualVideoHeight = displayWidth / videoAspectRatio;
      offsetY = (displayHeight - actualVideoHeight) / 2;
    } else {
      actualVideoHeight = displayHeight;
      actualVideoWidth = displayHeight * videoAspectRatio;
      offsetX = (displayWidth - actualVideoWidth) / 2;
    }
    
    const scaleX = actualVideoWidth / currentVideoWidth;
    const scaleY = actualVideoHeight / currentVideoHeight;

    // Cache the calculated values
    scaleFactorsRef.current = { scaleX, scaleY, offsetX, offsetY };
    return scaleFactorsRef.current;
  }, []);

  // Advanced futuristic drawing system (adapted from Main.tsx)
  const drawOverlays = useCallback(() => {
    const video = videoRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    
    if (!video || !overlayCanvas || !currentDetections) return;

    const ctx = overlayCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // Clear canvas first
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    // Only draw when streaming and have detections
    if (!isStreaming || !currentDetections.faces || currentDetections.faces.length === 0) {
      return;
    }

    // CRITICAL: Always get fresh dimensions and recalculate for accuracy
    // Force layout recalculation to ensure accurate dimensions after resize
    void video.offsetHeight; // Force reflow
    const rect = video.getBoundingClientRect();
    const displayWidth = Math.round(rect.width);
    const displayHeight = Math.round(rect.height);

    // ENHANCED: Update canvas size to exactly match video display size
    if (overlayCanvas.width !== displayWidth || overlayCanvas.height !== displayHeight) {
      overlayCanvas.width = displayWidth;
      overlayCanvas.height = displayHeight;
      overlayCanvas.style.width = `${displayWidth}px`;
      overlayCanvas.style.height = `${displayHeight}px`;
      
      // Clear canvas after size change
      ctx.clearRect(0, 0, displayWidth, displayHeight);
    }

    // Get cached scale factors
    const scaleFactors = calculateScaleFactors();
    if (!scaleFactors) return;

    const { scaleX, scaleY, offsetX, offsetY } = scaleFactors;

    // Validate scale factors
    if (!isFinite(scaleX) || !isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
      return;
    }

    // Draw detections with futuristic sci-fi styling
    currentDetections.faces.forEach((face, index) => {
      const { bbox, confidence, antispoofing } = face;
      
      const x1 = bbox.x;
      const y1 = bbox.y;
      const x2 = bbox.x + bbox.width;
      const y2 = bbox.y + bbox.height;

      // Validate bbox coordinates first
      if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) {
        return;
      }

      // Scale coordinates from capture canvas size to displayed video area
      const scaledX1 = x1 * scaleX + offsetX;
      const scaledY1 = y1 * scaleY + offsetY;
      const scaledX2 = x2 * scaleX + offsetX;
      const scaledY2 = y2 * scaleY + offsetY;

      // Additional validation for scaled coordinates
      if (!isFinite(scaledX1) || !isFinite(scaledY1) || !isFinite(scaledX2) || !isFinite(scaledY2)) {
        return;
      }

      const width = scaledX2 - scaledX1;
      const height = scaledY2 - scaledY1;

      // Get recognition result for this face
      const recognitionResult = currentRecognitionResults.get(index);

      // Determine colors based on recognition status
       const isRecognized = recognitionEnabled && recognitionResult?.person_id;
       let primaryColor: string;

       if (isRecognized) {
         primaryColor = "#00ffff"; // Cyan for recognized
       } else if (antispoofing) {
         if (antispoofing.status === 'real') {
           primaryColor = "#00ff41"; // Green for real
         } else if (antispoofing.status === 'fake') {
           primaryColor = "#ff0000"; // Red for fake
         } else {
           primaryColor = "#ff8800"; // Orange for unknown
         }
       } else {
         primaryColor = confidence > 0.8 ? "#00ffff" : "#ff6b6b";
       }

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

      // Draw modern HUD-style label (without percentage/similarity - moved to detection results)
       let label = "UNKNOWN";
       
       if (isRecognized && recognitionResult?.person_id) {
         label = recognitionResult.person_id.toUpperCase();
       } else if (antispoofing?.status === 'fake') {
         label = "⚠ SPOOF";
       } else if (antispoofing?.status === 'real') {
         label = "UNKNOWN";
       }

      // Validate coordinates
      const isValidCoord = (val: number) => typeof val === "number" && isFinite(val);
      if (!isValidCoord(scaledX1) || !isValidCoord(scaledY1)) {
        return;
      }

      // Draw name with glow effect
      ctx.font = 'bold 16px "Courier New", monospace';
      ctx.fillStyle = primaryColor;
      ctx.shadowColor = primaryColor;
      ctx.shadowBlur = 10;
      ctx.fillText(label, scaledX1, scaledY1 - 10);
      ctx.shadowBlur = 0;

      // Draw futuristic facial landmarks (neural nodes)
      const { landmarks } = face;
      if (landmarks) {
        const landmarkPoints = [
          landmarks.right_eye,
          landmarks.left_eye,
          landmarks.nose_tip,
          landmarks.right_mouth_corner,
          landmarks.left_mouth_corner
        ];
        
        const maxLandmarks = Math.min(landmarkPoints.length, 5);
        for (let i = 0; i < maxLandmarks; i++) {
          const point = landmarkPoints[i];
          if (!point || !isFinite(point.x) || !isFinite(point.y)) continue;

          // ENHANCED: High-precision landmark coordinate transformation
          const scaledLandmarkX = point.x * scaleX + offsetX;
          const scaledLandmarkY = point.y * scaleY + offsetY;

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
            ctx.arc(scaledLandmarkX, scaledLandmarkY, pulseRadius, 0, 2 * Math.PI);
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
    });
  }, [currentDetections, calculateScaleFactors, currentRecognitionResults, recognitionEnabled, isStreaming]);

  // Optimized animation loop with reduced frequency
  const animate = useCallback(() => {

    
    // Update FPS counter less frequently


    // Clear canvas when there are no detections
    const overlayCanvas = overlayCanvasRef.current;
    if (overlayCanvas && (!currentDetections || !isStreaming)) {
      const ctx = overlayCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
    }

    // Only redraw if detection results changed
    const currentHash = currentDetections ? JSON.stringify(currentDetections.faces.map(f => f.bbox)) : '';
    if (currentHash !== lastDetectionHashRef.current && currentDetections) {
      drawOverlays();
      lastDetectionHashRef.current = currentHash;
    }

    if (isStreaming) {
      animationFrameRef.current = requestAnimationFrame(animate);
    }
  }, [isStreaming, drawOverlays, currentDetections]);





  // Face recognition utility functions
  const loadRegisteredPersons = useCallback(async () => {
    try {
      if (!backendServiceRef.current) {
        console.warn('⚠️ Backend service not initialized, skipping load registered persons');
        return;
      }
      const persons = await backendServiceRef.current.getAllPersons();
      setRegisteredPersons(persons);
    } catch (error) {
      console.error('❌ Failed to load registered persons:', error);
      setError('Failed to load registered persons');
    }
  }, []);

  const loadDatabaseStats = useCallback(async () => {
    try {
      if (!backendServiceRef.current) {
        console.warn('⚠️ Backend service not initialized, skipping load database stats');
        return;
      }
    } catch (error) {
      console.error('❌ Failed to load database stats:', error);
    }
  }, []);

  const handleRegisterFace = useCallback(async (faceIndex: number) => {
    if (!currentDetections?.faces?.[faceIndex] || !newPersonId.trim()) {
      setError('Please enter a person ID and select a valid face');
      return;
    }

    try {
      if (!backendServiceRef.current) {
        setError('Backend service not initialized');
        return;
      }

      const frameData = captureFrame();
      if (!frameData) {
        setError('Failed to capture frame for registration');
        return;
      }

      const face = currentDetections.faces[faceIndex];
      
      // Convert landmarks to the format expected by backend: [[x1,y1], [x2,y2], ...]
      const landmarks = [
        [face.landmarks.right_eye.x, face.landmarks.right_eye.y],
        [face.landmarks.left_eye.x, face.landmarks.left_eye.y],
        [face.landmarks.nose_tip.x, face.landmarks.nose_tip.y],
        [face.landmarks.right_mouth_corner.x, face.landmarks.right_mouth_corner.y],
        [face.landmarks.left_mouth_corner.x, face.landmarks.left_mouth_corner.y]
      ];
      
      const response = await backendServiceRef.current.registerFace(
        frameData,
        newPersonId.trim(),
        landmarks
      );

      if (response.success) {
        setNewPersonId('');
        setShowRegistrationDialog(false);
        await loadRegisteredPersons();
        await loadDatabaseStats();
        
        // Trigger immediate face recognition on current detections
        if (currentDetections && currentDetections.faces.length > 0) {
          await performFaceRecognition(currentDetections);
        }
        
        console.log('✅ Face registered successfully:', `Person "${response.person_id}" added to database (${response.total_persons} total persons)`);
      } else {
        setError(response.error || 'Failed to register face');
      }
    } catch (error) {
      console.error('❌ Face registration failed:', error);
      setError('Failed to register face');
    }
  }, [currentDetections, newPersonId, captureFrame, loadRegisteredPersons, loadDatabaseStats, performFaceRecognition]);

  const handleRemovePerson = useCallback(async (personId: string) => {
    try {
      if (!backendServiceRef.current) {
        setError('Backend service not initialized');
        return;
      }
      const response = await backendServiceRef.current.removePerson(personId);
      if (response.success) {
        await loadRegisteredPersons();
        await loadDatabaseStats();
        console.log('✅ Person removed successfully:', response.message);
      } else {
        setError(response.message || 'Failed to remove person');
      }
    } catch (error) {
      console.error('❌ Failed to remove person:', error);
      setError('Failed to remove person');
    }
  }, [loadRegisteredPersons, loadDatabaseStats]);

  const handleClearDatabase = useCallback(async () => {
    try {
      if (!backendServiceRef.current) {
        setError('Backend service not initialized');
        return;
      }
      const response = await backendServiceRef.current.clearDatabase();
      if (response.success) {
        await loadRegisteredPersons();
        await loadDatabaseStats();
        setCurrentRecognitionResults(new Map());
        console.log('✅ Database cleared successfully:', response.message);
      } else {
        setError(response.message || 'Failed to clear database');
      }
    } catch (error) {
      console.error('❌ Failed to clear database:', error);
      setError('Failed to clear database');
    }
  }, [loadRegisteredPersons, loadDatabaseStats]);



  // Initialize
  useEffect(() => {
    getCameraDevices();
    return () => {
      stopCamera();
    };
  }, [getCameraDevices, stopCamera]);

  // Start animation loop when streaming starts
  useEffect(() => {
    if (isStreaming) {
      animate();
    }
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isStreaming, animate]);

  // Poll WebSocket status from BackendService
  useEffect(() => {
    const pollWebSocketStatus = () => {
      if (backendServiceRef.current) {
        const actualStatus = backendServiceRef.current.getWebSocketStatus();
        if (actualStatus !== websocketStatus) {
          setWebsocketStatus(actualStatus);
        }
      }
    };

    // Poll every 100ms for responsive status updates
    const statusInterval = setInterval(pollWebSocketStatus, 100);

    return () => {
      clearInterval(statusInterval);
    };
  }, [websocketStatus]);

  // Load face recognition data when backend service becomes ready
  useEffect(() => {
    if (backendServiceReady && recognitionEnabled) {
      loadRegisteredPersons();
      loadDatabaseStats();
    }
  }, [backendServiceReady, recognitionEnabled, loadRegisteredPersons, loadDatabaseStats]);

  // Monitor WebSocket status and start detection when connected
  useEffect(() => {
    if (websocketStatus === 'connected' && detectionEnabledRef.current && !detectionIntervalRef.current) {
      // Poll for WebSocket readiness with exponential backoff
      let attempts = 0;
      const maxAttempts = 10;
      const checkReadiness = () => {
        if (backendServiceRef.current?.isWebSocketReady() && 
            detectionEnabledRef.current && 
            !detectionIntervalRef.current) {
          startDetectionInterval();
        } else if (attempts < maxAttempts) {
          attempts++;
          const delay = Math.min(100 * Math.pow(1.5, attempts), 1000); // Exponential backoff, max 1s
          setTimeout(checkReadiness, delay);
        } else {
          console.warn('⚠️ WebSocket readiness check timed out after', maxAttempts, 'attempts');
        }
      };
      
      // Start checking immediately
      checkReadiness();
    }
  }, [websocketStatus, startDetectionInterval]);

  // Monitor detectionEnabled state changes
  useEffect(() => {
    console.log('🔍 detectionEnabled state changed to:', detectionEnabled);
  }, [detectionEnabled]);

  // Load face recognition data when recognition is enabled and backend service is ready
  useEffect(() => {
    if (recognitionEnabled && backendServiceReady) {
      loadRegisteredPersons();
      loadDatabaseStats();
    }
  }, [recognitionEnabled, backendServiceReady, loadRegisteredPersons, loadDatabaseStats]);

  return (
    <div className="h-screen bg-black text-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.08] flex items-center justify-between">
        <h1 className="text-xl font-light">Live Video Detection</h1>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-white/[0.03] hover:bg-white/[0.08] backdrop-blur-xl border border-white/[0.08] text-white/80 hover:text-white rounded-xl font-light transition-all duration-300"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-sm font-light tracking-wider uppercase">Settings</span>
          </button>
          {onBack && (
            <button
              onClick={onBack}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded transition-colors"
            >
              ← Back
            </button>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mx-4 mt-3 bg-red-900 border border-red-600 p-3 rounded text-red-200">
          {error}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main Video Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Video Container */}
          <div className="flex-1 p-4 flex items-center justify-center bg-white/[0.01]">
            <div className="relative max-w-full max-h-full">
              <video
                ref={videoRef}
                className="max-w-full max-h-full object-contain rounded border border-white/[0.1]"
                playsInline
                muted
              />
              <canvas
                ref={overlayCanvasRef}
                className="absolute top-0 left-0 pointer-events-none"
                style={{
                  width: '100%',
                  height: '100%'
                }}
              />
              
              {/* Hidden canvas for frame capture */}
              <canvas ref={canvasRef} className="hidden" />
            </div>
          </div>

          {/* Controls Bar */}
          <div className="px-4 pt-2 pb-2">
            <div className="bg-white/[0.02] border border-white/[0.08] rounded-lg p-4 flex items-center justify-between">
              <div className="flex items-center space-x-6">
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${
                    isStreaming ? 'bg-green-500' : 'bg-red-500'
                  }`}></div>
                  <span className="text-sm text-white/60">
                    Camera: {isStreaming ? 'Active' : 'Stopped'}
                  </span>
                </div>

                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${
                    websocketStatus === 'connected' ? 'bg-green-500' : 
                    websocketStatus === 'connecting' ? 'bg-orange-500 animate-pulse' :
                    'bg-white/40'
                  }`}></div>
                  <span className="text-sm text-white/60">
                    WebSocket: {websocketStatus === 'connected' ? 'Connected' : 
                               websocketStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
                  </span>
                </div>

                <div className="text-sm text-white/60">
                  FPS: {detectionFps}
                </div>
                
                {/* Camera Selection */}
                {cameraDevices.length > 0 && (
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-white/60">Camera:</span>
                    <select
                      value={selectedCamera}
                      onChange={(e) => setSelectedCamera(e.target.value)}
                      disabled={isStreaming || cameraDevices.length <= 1}
                      className="bg-white/[0.05] text-white text-sm border border-white/[0.1] rounded px-2 py-1 focus:border-blue-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
                    >
                      {cameraDevices.map((device, index) => (
                        <option key={device.deviceId} value={device.deviceId} className="bg-black text-white">
                          {device.label || `Camera ${index + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              
              <div className="flex items-center space-x-3">
                <button
                  onClick={isStreaming ? stopCamera : startCamera}
                  className={`px-4 py-2 rounded font-medium transition-colors duration-150 ${
                    isStreaming
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : 'bg-green-600 hover:bg-green-700 text-white'
                  }`}
                >
                  {isStreaming ? 'Stop' : 'Start Detection'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="sidebar w-80 my-3 bg-white/[0.02] border-l border-white/[0.08] flex flex-col max-h-full overflow-hidden">
          {/* System Status */}
          <div className="px-4 pt-2 pb-4 border-b border-white/[0.08]">
            <h3 className="text-lg font-light mb-3">System Status</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-white/60">Detection Status</span>
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${
                    detectionEnabled ? 'bg-green-500' : 'bg-white/40'
                  }`}></div>
                  <span className="text-xs font-light tracking-wider uppercase text-white">
                    {detectionEnabled ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/60">Faces Detected</span>
                <span className="font-mono">{currentDetections?.faces?.length || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/60">Registered Persons</span>
                <span className="font-mono">{registeredPersons.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/60">Processing Time</span>
                <span className="font-mono">{currentDetections?.processing_time?.toFixed(1) || 0}ms</span>
              </div>
            </div>
          </div>

          {/* Detection Settings */}
          <div className="px-4 py-4 border-b border-white/[0.08]">
            <h3 className="text-lg font-light mb-3">Detection Settings</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-white/60">Anti-Spoofing</span>
                <button
                  onClick={() => setAntispoofingEnabled(!antispoofingEnabled)}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors duration-150 ${
                    antispoofingEnabled
                      ? 'bg-green-600 text-white'
                      : 'bg-white/[0.05] text-white/70 hover:bg-white/[0.08] border border-white/[0.1]'
                  }`}
                >
                  {antispoofingEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/60">Face Recognition</span>
                <button
                  onClick={() => setRecognitionEnabled(!recognitionEnabled)}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors duration-150 ${
                    recognitionEnabled
                      ? 'bg-purple-600 text-white'
                      : 'bg-white/[0.05] text-white/70 hover:bg-white/[0.08] border border-white/[0.1]'
                  }`}
                >
                  {recognitionEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            </div>
          </div>

          {/* Recognition Controls */}
          {recognitionEnabled && (
            <div className="px-4 py-4 border-b border-white/[0.08]">
              <h3 className="text-lg font-light mb-3">Recognition Controls</h3>
              <div className="space-y-2">
                <button
                  onClick={() => setShowRegistrationDialog(true)}
                  disabled={!currentDetections?.faces?.length}
                  className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-green-600/20 hover:bg-green-600/30 disabled:bg-white/[0.05] disabled:text-white/40 backdrop-blur-xl border border-green-500/30 text-green-200 hover:text-green-100 rounded-xl font-light transition-all duration-300"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  <span className="text-sm font-light tracking-wider uppercase">Register Face</span>
                </button>
                
                <button
                  onClick={handleClearDatabase}
                  className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 backdrop-blur-xl border border-red-500/30 text-red-200 hover:text-red-100 rounded-xl font-light transition-all duration-300"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                  <span className="text-sm font-light tracking-wider uppercase">Clear Database</span>
                </button>
              </div>
            </div>
          )}

          {/* Live Detections */}
           <div className="p-4 border-b border-white/[0.08]">
             <h3 className="text-lg font-light mb-4">Live Detections</h3>
             <div className="space-y-2 h-32 overflow-y-auto recent-logs-scroll">
              {!currentDetections?.faces?.length ? (
                <div className="text-white/50 text-sm text-center py-4">
                  No faces detected
                </div>
              ) : (
                currentDetections.faces.map((face, index) => {
                  const recognitionResult = currentRecognitionResults.get(index);
                  const isRecognized = recognitionEnabled && recognitionResult?.person_id;
                  
                  return (
                    <div key={index} className="bg-white/[0.05] border border-white/[0.08] rounded p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-medium">
                            {isRecognized && recognitionResult?.person_id ? 
                              recognitionResult.person_id.toUpperCase() : 
                              `Face ${index + 1}`
                            }
                          </div>
                          <div className="text-xs text-white/60">
                            Confidence: {(face.confidence * 100).toFixed(1)}%
                          </div>
                        </div>
                        <div className="text-right">
                          {isRecognized && recognitionResult?.similarity && (
                            <div className="text-xs text-green-300">
                              {(recognitionResult.similarity * 100).toFixed(1)}% match
                            </div>
                          )}
                          {face.antispoofing && (
                            <div className={`text-xs px-2 py-1 rounded mt-1 ${
                              face.antispoofing.status === 'real' ? 'bg-green-900 text-green-300' : 
                              face.antispoofing.status === 'fake' ? 'bg-red-900 text-red-300' : 
                              'bg-yellow-900 text-yellow-300'
                            }`}>
                              {face.antispoofing.status === 'real' ? '✓ Live' : 
                               face.antispoofing.status === 'fake' ? '⚠ Spoof' : '? Unknown'}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
               )}
             </div>
           </div>

           {/* Recent Logs */}
           <div className="flex-1 p-4 min-h-0 h-full">
             <h3 className="text-lg font-light mb-4">Recent Logs</h3>
             <div className="space-y-2 h-full overflow-y-auto recent-logs-scroll">
               <div className="text-white/50 text-sm text-center py-4">
                 No logs yet
               </div>
             </div>
           </div>
         </div>

       {/* Face Registration Dialog */}
        {showRegistrationDialog && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 p-6 rounded-lg max-w-md w-full mx-4">
              <h3 className="text-xl font-bold mb-4">Register Face</h3>
              
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">Person ID:</label>
                <input
                  type="text"
                  value={newPersonId}
                  onChange={(e) => setNewPersonId(e.target.value)}
                  placeholder="Enter person ID (e.g., john_doe)"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                />
              </div>

              {currentDetections?.faces && currentDetections.faces.length > 0 && (
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2">Select Face:</label>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {currentDetections.faces.map((face, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-2 bg-gray-700 rounded cursor-pointer hover:bg-gray-600"
                        onClick={() => handleRegisterFace(index)}
                      >
                        <span className="text-sm">
                          Face {index + 1} (Confidence: {(face.confidence * 100).toFixed(1)}%)
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRegisterFace(index);
                          }}
                          disabled={!newPersonId.trim()}
                          className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded text-sm transition-colors"
                        >
                          Register
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {registeredPersons.length > 0 && (
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2">Registered Persons:</label>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {registeredPersons.map((person) => (
                      <div key={person.person_id} className="flex items-center justify-between p-2 bg-gray-700 rounded">
                        <span className="text-sm">{person.person_id} ({person.embedding_count} embeddings)</span>
                        <button
                          onClick={() => handleRemovePerson(person.person_id)}
                          className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-xs transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowRegistrationDialog(false);
                    setNewPersonId('');
                  }}
                  className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (currentDetections?.faces && currentDetections.faces.length > 0) {
                      handleRegisterFace(0);
                    }
                  }}
                  disabled={!newPersonId.trim() || !currentDetections?.faces?.length}
                  className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded transition-colors"
                >
                  Register
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Settings Modal */}
        {showSettings && (
          <Settings onBack={() => setShowSettings(false)} isModal={true} />
        )}
      </div>
    </div>
  );
}