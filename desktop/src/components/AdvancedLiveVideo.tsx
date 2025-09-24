/**
 * Advanced Live Video Component
 * State-of-the-art dual-mode face recognition system with intelligent capture and registration
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { BackendService } from '../services/BackendService';
import DualModeRecognitionManager, { 
  type RecognitionMode, 
  type RecognitionSettings, 
  type CaptureResult, 
  type SystemStatus,
  type FeedbackEvent 
} from '../services/DualModeRecognitionManager';
import { 
  enhancedFaceRegistration, 
  type RegistrationSession, 
  type RegistrationGuidance
} from '../services/EnhancedFaceRegistration';
import { advancedComputerVision } from '../services/AdvancedComputerVision';

interface AdvancedLiveVideoProps {
  onBack?: () => void;
}

interface DetectionResult {
  faces: Array<{
    bbox: [number, number, number, number];
    confidence: number;
    landmarks: number[][];
    antispoofing?: {
      is_real: boolean | null;
      confidence: number;
      status: 'real' | 'fake' | 'error';
    };
  }>;
  model_used: string;
  processing_time: number;
}

export default function AdvancedLiveVideo({ onBack }: AdvancedLiveVideoProps) {
  // Core refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const backendServiceRef = useRef<BackendService | null>(null);
  const recognitionManagerRef = useRef<DualModeRecognitionManager | null>(null);

  // Core state
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
  const [showRegistration, setShowRegistration] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentDetections, setCurrentDetections] = useState<DetectionResult | null>(null);
  // Debug: log every detection result
  useEffect(() => {
    if (currentDetections) {
      console.log('Detection faces (global effect):', currentDetections.faces);
    }
  }, [currentDetections]);
  const [websocketStatus, setWebsocketStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [error, setError] = useState<string | null>(null);

  // Camera settings

  // Recognition system state
  const [recognitionMode, setRecognitionMode] = useState<RecognitionMode>('auto');
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [recognitionSettings, setRecognitionSettings] = useState<RecognitionSettings | null>(null);
  const [captureHistory, setCaptureHistory] = useState<CaptureResult[]>([]);

  // UI state
  const [showSettings, setShowSettings] = useState(false);
  const [feedbackMessages, setFeedbackMessages] = useState<FeedbackEvent[]>([]);

  // Registration state
  const [registrationSession, setRegistrationSession] = useState<RegistrationSession | null>(null);
  const [registrationGuidance, setRegistrationGuidance] = useState<RegistrationGuidance | null>(null);
  const [newPersonId, setNewPersonId] = useState('');

  // Manual capture state
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureButtonEnabled, setCaptureButtonEnabled] = useState(true);

  // Quality indicators
  const [qualityIndicators, setQualityIndicators] = useState<{
    sharpness: number;
    lighting: number;
    pose: number;
    overall: number;
  }>({ sharpness: 0, lighting: 0, pose: 0, overall: 0 });

  /**
   * Initialize camera and backend services
   */
  useEffect(() => {
    initializeServices();
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Initialize all services
   */
  const initializeServices = useCallback(async () => {
    try {
      // Initialize backend service
      backendServiceRef.current = new BackendService();
      
      // Initialize recognition manager
      recognitionManagerRef.current = new DualModeRecognitionManager(backendServiceRef.current);
      
      // Set up event handlers
      recognitionManagerRef.current.onCapture((result: CaptureResult) => {
        setCaptureHistory(prev => [result, ...prev.slice(0, 49)]); // Keep last 50
        
        // Show feedback
        addFeedbackMessage({
          type: 'visual',
          message: result.success 
            ? `${result.faces_recognized} face(s) recognized (${result.mode} mode)`
            : `Capture failed: ${result.error}`,
          level: result.success ? 'success' : 'error'
        });
      });

      recognitionManagerRef.current.onFeedback((event: FeedbackEvent) => {
        addFeedbackMessage(event);
      });

      recognitionManagerRef.current.onStatusUpdate((status: SystemStatus) => {
        setSystemStatus(status);
      });

      // Get initial settings
      const settings = recognitionManagerRef.current.getSettings();
      setRecognitionSettings(settings);

      // Initialize camera
      await initializeCamera();
      
      // Connect to backend
      await connectToBackend();

    } catch (error) {
      console.error('Failed to initialize services:', error);
      setError(error instanceof Error ? error.message : 'Initialization failed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Initialize camera
   */
  const initializeCamera = useCallback(async () => {
    try {
      // Get available cameras
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
  // Optionally use videoDevices for camera selection UI

      if (videoDevices.length > 0) {
  const defaultCamera = videoDevices[0].deviceId;
  setSelectedCamera(defaultCamera);
  await startCamera(defaultCamera);
      }
    } catch (error) {
      console.error('Camera initialization failed:', error);
      setError('Failed to access camera');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Start camera stream
   */
  const startCamera = useCallback(async (deviceId: string) => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        }
      });

      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          setIsStreaming(true);
          startProcessing();
        };
      }
    } catch (error) {
      console.error('Failed to start camera:', error);
      setError('Failed to start camera stream');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Connect to backend
   */
  const connectToBackend = useCallback(async () => {
    try {
      setWebsocketStatus('connecting');
      
      if (backendServiceRef.current) {
        await backendServiceRef.current.connectWebSocket();
        
        // Set up message handlers
        backendServiceRef.current.onMessage('detection_response', (data) => {
          if (data.faces && Array.isArray(data.faces)) {
            const detectionResult: DetectionResult = {
              faces: data.faces.map((face) => {
                let antispoofing = undefined;
                if (face.antispoofing) {
                  antispoofing = {
                    is_real: typeof face.antispoofing.is_real === 'boolean' || face.antispoofing.is_real === null ? face.antispoofing.is_real : null,
                    confidence: typeof face.antispoofing.confidence === 'number' ? face.antispoofing.confidence : 0,
                    status: face.antispoofing.status === 'real' || face.antispoofing.status === 'fake' || face.antispoofing.status === 'error' ? face.antispoofing.status : 'error'
                  };
                }
                return {
                  bbox: (face.bbox && face.bbox.length >= 4 ? [face.bbox[0], face.bbox[1], face.bbox[2], face.bbox[3]] : [0, 0, 0, 0]) as [number, number, number, number],
                  confidence: face.confidence || 0,
                  landmarks: face.landmarks || [],
                  antispoofing
                };
              }),
              model_used: data.model_used || 'unknown',
              processing_time: data.processing_time || 0
            };
  // Example usage to avoid unused variable errors
  // Render selected camera and registration modal if needed
  // ...existing code...
  // At the end of your component's return:
  // <div>Selected Camera: {selectedCamera}</div>
  // {showRegistration && <div>Registration Modal</div>}
            
            setCurrentDetections(detectionResult);
            processDetectionResult(detectionResult);
          }
        });

        setWebsocketStatus('connected');
      }
    } catch (error) {
      console.error('Backend connection failed:', error);
      setWebsocketStatus('disconnected');
      setError('Failed to connect to backend');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Start video processing
   */
  const startProcessing = useCallback(() => {
    if (!isStreaming || !recognitionManagerRef.current) return;

    recognitionManagerRef.current.start();

    const processFrame = () => {
      if (!isStreaming || !videoRef.current || !canvasRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      if (!ctx || video.videoWidth === 0) {
        animationFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }

      // Resize canvas if needed
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      // Draw current frame
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Send frame for detection if WebSocket is ready
      if (websocketStatus === 'connected' && backendServiceRef.current?.isWebSocketReady()) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        backendServiceRef.current.sendDetectionRequest(imageData, {
          enable_antispoofing: true,
          confidence_threshold: recognitionSettings?.confidence_threshold || 0.7
        });
      }

      animationFrameRef.current = requestAnimationFrame(processFrame);
    };

    processFrame();
  }, [isStreaming, websocketStatus, recognitionSettings]);

  /**
   * Process detection result
   */
  const processDetectionResult = useCallback(async (detectionResult: DetectionResult) => {
  // Debug: log detection results
  console.log('Detection faces:', detectionResult.faces);
    if (!recognitionManagerRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // Process with recognition manager
    await recognitionManagerRef.current.processFrame(imageData, detectionResult);

    // Update quality indicators
    if (detectionResult.faces.length > 0) {
      const frameAnalysis = advancedComputerVision.analyzeFrame(imageData, detectionResult);
      if (frameAnalysis.faces.length > 0) {
        const bestFace = frameAnalysis.faces.reduce((best, current) => 
          current.quality_metrics.overall_quality > best.quality_metrics.overall_quality ? current : best
        );
        
        setQualityIndicators({
          sharpness: bestFace.quality_metrics.sharpness,
          lighting: 1 - Math.abs(bestFace.quality_metrics.brightness - 0.5) * 2,
          pose: bestFace.quality_metrics.pose_quality,
          overall: bestFace.quality_metrics.overall_quality
        });
      }
    }

    // Draw overlays
    drawOverlays(detectionResult);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Draw detection overlays
   */
  const drawOverlays = useCallback((detectionResult: DetectionResult) => {
  // Debug: log overlay draw event
  console.log('drawOverlays called', detectionResult.faces);
    // Debug: log video/canvas dimensions
    if (videoRef.current) {
      console.log('Video dimensions:', videoRef.current.videoWidth, videoRef.current.videoHeight);
    }
    if (overlayCanvasRef.current) {
      console.log('Overlay canvas dimensions:', overlayCanvasRef.current.width, overlayCanvasRef.current.height);
    }
    const overlayCanvas = overlayCanvasRef.current;
    const video = videoRef.current;
    
    if (!overlayCanvas || !video) return;

    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;

    // Resize overlay canvas to match video
    if (overlayCanvas.width !== video.videoWidth || overlayCanvas.height !== video.videoHeight) {
      overlayCanvas.width = video.videoWidth;
      overlayCanvas.height = video.videoHeight;
    }

    // Clear previous drawings
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    // Draw face detections
    detectionResult.faces.forEach((face) => {
  console.log('Drawing bbox:', face.bbox);
      const [x, y, width, height] = face.bbox;
      
      // Determine color based on confidence and antispoofing
      let color = '#00ff00'; // Green for good detection
      if (face.confidence < 0.7) color = '#ffff00'; // Yellow for low confidence
      if (face.antispoofing?.status === 'fake') color = '#ff0000'; // Red for fake
      
      // Draw bounding box
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width, height);
      
      // Draw confidence
      ctx.fillStyle = color;
      ctx.font = '14px Arial';
      ctx.fillText(`${(face.confidence * 100).toFixed(1)}%`, x, y - 5);
      
      // Draw landmarks
      if (face.landmarks && face.landmarks.length >= 5) {
        ctx.fillStyle = color;
        face.landmarks.forEach(([lx, ly]) => {
          ctx.beginPath();
          ctx.arc(lx, ly, 2, 0, 2 * Math.PI);
          ctx.fill();
        });
      }
    });

    // Draw mode indicator
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(10, 10, 120, 30);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px Arial';
    ctx.fillText(`${recognitionMode.toUpperCase()} MODE`, 15, 30);
  }, [recognitionMode]);

  /**
   * Manual capture trigger
   */
  const triggerManualCapture = useCallback(async () => {
    if (!recognitionManagerRef.current || !canvasRef.current || !currentDetections) {
      addFeedbackMessage({
        type: 'visual',
        message: 'No detection data available for capture',
        level: 'warning'
      });
      return;
    }

    setIsCapturing(true);
    setCaptureButtonEnabled(false);

    try {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context not available');

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = await recognitionManagerRef.current.triggerManualCapture(imageData, currentDetections);
      
      // Visual feedback
      if (result.success) {
        // Flash green border
        const overlay = overlayCanvasRef.current;
        if (overlay) {
          const overlayCtx = overlay.getContext('2d');
          if (overlayCtx) {
            overlayCtx.strokeStyle = '#00ff00';
            overlayCtx.lineWidth = 8;
            overlayCtx.strokeRect(0, 0, overlay.width, overlay.height);
            setTimeout(() => {
              overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
              drawOverlays(currentDetections);
            }, 200);
          }
        }
      }

    } catch (error) {
      console.error('Manual capture failed:', error);
      addFeedbackMessage({
        type: 'visual',
        message: `Capture failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        level: 'error'
      });
    } finally {
      setIsCapturing(false);
      setTimeout(() => setCaptureButtonEnabled(true), 1000); // Prevent spam clicking
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDetections]);

  /**
   * Start face registration
   */
  const startRegistration = useCallback(() => {
    if (!newPersonId.trim()) {
      addFeedbackMessage({
        type: 'visual',
        message: 'Please enter a person ID',
        level: 'warning'
      });
      return;
    }

    const validation = enhancedFaceRegistration.validatePersonId(newPersonId);
    if (!validation.valid) {
      addFeedbackMessage({
        type: 'visual',
        message: validation.error || 'Invalid person ID',
        level: 'error'
      });
      return;
    }

    const session = enhancedFaceRegistration.startRegistration(newPersonId);
    setRegistrationSession(session);
    setShowRegistration(true);
    
    addFeedbackMessage({
      type: 'visual',
      message: `Registration started for ${newPersonId}`,
      level: 'success'
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newPersonId]);

  /**
   * Process registration capture
   */
  const processRegistrationCapture = useCallback(async () => {
    if (!registrationSession || !canvasRef.current || !currentDetections) return;

    try {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context not available');

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = await enhancedFaceRegistration.processCaptureAttempt(
        registrationSession.session_id,
        imageData,
        currentDetections
      );

      setRegistrationSession(result.session);
      setRegistrationGuidance(result.guidance);

      if (result.step_completed) {
        addFeedbackMessage({
          type: 'visual',
          message: 'Step completed successfully!',
          level: 'success'
        });
      } else if (result.error) {
        addFeedbackMessage({
          type: 'visual',
          message: result.error,
          level: 'warning'
        });
      }

    } catch (error) {
      console.error('Registration capture failed:', error);
      addFeedbackMessage({
        type: 'visual',
        message: `Registration failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        level: 'error'
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registrationSession, currentDetections]);

  /**
   * Complete registration
   */
  const completeRegistration = useCallback(async () => {
    if (!registrationSession) return;

    try {
      const result = await enhancedFaceRegistration.completeRegistration(registrationSession.session_id);
      
      if (result.success) {
        addFeedbackMessage({
          type: 'visual',
          message: `Registration completed for ${result.person_id}!`,
          level: 'success'
        });
        
        setRegistrationSession(null);
        setRegistrationGuidance(null);
        setShowRegistration(false);
        setNewPersonId('');
      } else {
        addFeedbackMessage({
          type: 'visual',
          message: `Registration failed: ${result.error}`,
          level: 'error'
        });
      }
    } catch (error) {
      console.error('Registration completion failed:', error);
      addFeedbackMessage({
        type: 'visual',
        message: `Registration failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        level: 'error'
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registrationSession]);

  /**
   * Add feedback message
   */
  const addFeedbackMessage = useCallback((message: FeedbackEvent) => {
    const messageWithTimestamp = { ...message, timestamp: Date.now() };
    setFeedbackMessages(prev => [
      messageWithTimestamp,
      ...prev.slice(0, 4) // Keep last 5 messages
    ]);

    // Auto-remove message after duration
    const duration = message.duration || 3000;
    setTimeout(() => {
      setFeedbackMessages(prev => prev.filter(m => 
        (m as typeof messageWithTimestamp).timestamp !== messageWithTimestamp.timestamp
      ));
    }, duration);
  }, []);

  /**
   * Cleanup function
   */
  const cleanup = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    
    if (recognitionManagerRef.current) {
      recognitionManagerRef.current.stop();
    }
    
    if (backendServiceRef.current) {
      backendServiceRef.current.disconnect();
    }
  }, []);

  /**
   * Quality indicator component
   */
  const QualityIndicator = ({ label, value, color }: { label: string; value: number; color: string }) => (
    <div className="flex items-center space-x-2">
      <span className="text-sm text-gray-300 w-16">{label}:</span>
      <div className="flex-1 bg-gray-700 rounded-full h-2">
        <div 
          className="h-2 rounded-full transition-all duration-300"
          style={{ 
            width: `${value * 100}%`, 
            backgroundColor: color 
          }}
        />
      </div>
      <span className="text-sm text-gray-300 w-8">{Math.round(value * 100)}%</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Show selected camera for debugging or UI */}
      <div className="absolute top-4 right-4 bg-gray-800 p-2 rounded text-xs z-50">
        Selected Camera: {selectedCamera ?? 'None'}
      </div>
      {/* Show registration modal if needed */}
      {showRegistration && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-gray-900 p-8 rounded-lg shadow-lg text-center">
            <h2 className="text-lg font-bold mb-4">Registration In Progress</h2>
            <p className="mb-4">Please follow the instructions to complete registration.</p>
            <button
              className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded"
              onClick={() => setShowRegistration(false)}
            >Close</button>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="bg-gray-900 p-4 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center space-x-4">
          {onBack && (
            <button
              onClick={onBack}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
            >
              ← Back
            </button>
          )}
          <h1 className="text-xl font-bold">Advanced Face Recognition</h1>
          <div className={`px-3 py-1 rounded-full text-sm ${
            websocketStatus === 'connected' ? 'bg-green-600' : 
            websocketStatus === 'connecting' ? 'bg-yellow-600' : 'bg-red-600'
          }`}>
            {websocketStatus.toUpperCase()}
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Mode Selector */}
          <select
            value={recognitionMode}
            onChange={(e) => {
              const mode = e.target.value as RecognitionMode;
              setRecognitionMode(mode);
              if (recognitionManagerRef.current) {
                recognitionManagerRef.current.updateSettings({ mode });
              }
            }}
            className="bg-gray-700 text-white px-3 py-2 rounded-lg border border-gray-600"
          >
            <option value="auto">Auto Mode</option>
            <option value="manual">Manual Mode</option>
            <option value="hybrid">Hybrid Mode</option>
          </select>

          {/* Manual Capture Button */}
          {(recognitionMode === 'manual' || recognitionMode === 'hybrid') && (
            <button
              onClick={triggerManualCapture}
              disabled={!captureButtonEnabled || isCapturing}
              className={`px-6 py-2 rounded-lg font-semibold transition-all ${
                captureButtonEnabled && !isCapturing
                  ? 'bg-blue-600 hover:bg-blue-500 text-white'
                  : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              }`}
            >
              {isCapturing ? 'Capturing...' : 'Capture'}
            </button>
          )}

          <button
            onClick={() => setShowSettings(!showSettings)}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          >
            Settings
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-600 text-white p-4 text-center">
          {error}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Video Section */}
        <div className="flex-1 relative">
          <div className="relative w-full h-full flex items-center justify-center bg-gray-900">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="max-w-full max-h-full object-contain"
            />
            <canvas
              ref={canvasRef}
              className="hidden"
            />
            <canvas
              ref={overlayCanvasRef}
              className="absolute top-0 left-0 w-full h-full object-contain pointer-events-none"
            />
          </div>

          {/* Feedback Messages */}
          <div className="absolute top-4 left-4 space-y-2">
            {feedbackMessages.map((message, index) => (
              <div
                key={index}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${
                  message.level === 'success' ? 'bg-green-600' :
                  message.level === 'warning' ? 'bg-yellow-600' :
                  message.level === 'error' ? 'bg-red-600' : 'bg-blue-600'
                }`}
              >
                {message.message}
              </div>
            ))}
          </div>

          {/* Quality Indicators */}
          <div className="absolute bottom-4 left-4 bg-black bg-opacity-70 p-4 rounded-lg space-y-2">
            <h3 className="text-sm font-semibold mb-2">Quality Metrics</h3>
            <QualityIndicator 
              label="Sharpness" 
              value={qualityIndicators.sharpness} 
              color={qualityIndicators.sharpness > 0.7 ? '#10b981' : qualityIndicators.sharpness > 0.5 ? '#f59e0b' : '#ef4444'} 
            />
            <QualityIndicator 
              label="Lighting" 
              value={qualityIndicators.lighting} 
              color={qualityIndicators.lighting > 0.7 ? '#10b981' : qualityIndicators.lighting > 0.5 ? '#f59e0b' : '#ef4444'} 
            />
            <QualityIndicator 
              label="Pose" 
              value={qualityIndicators.pose} 
              color={qualityIndicators.pose > 0.7 ? '#10b981' : qualityIndicators.pose > 0.5 ? '#f59e0b' : '#ef4444'} 
            />
            <QualityIndicator 
              label="Overall" 
              value={qualityIndicators.overall} 
              color={qualityIndicators.overall > 0.7 ? '#10b981' : qualityIndicators.overall > 0.5 ? '#f59e0b' : '#ef4444'} 
            />
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-80 bg-gray-900 border-l border-gray-700 p-4 space-y-4 overflow-y-auto">
          {/* System Status */}
          {systemStatus && (
            <div className="bg-gray-800 p-4 rounded-lg">
              <h3 className="font-semibold mb-3">System Status</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Mode:</span>
                  <span className="font-medium">{systemStatus.mode.toUpperCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span>FPS:</span>
                  <span className="font-medium">{systemStatus.current_fps}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Captures:</span>
                  <span className="font-medium">{systemStatus.total_captures}</span>
                </div>
                <div className="flex justify-between">
                  <span>Recognition Rate:</span>
                  <span className="font-medium">{Math.round(systemStatus.recognition_rate * 100)}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Tracking:</span>
                  <span className="font-medium">{systemStatus.faces_being_tracked} faces</span>
                </div>
              </div>
            </div>
          )}

          {/* Face Registration */}
          <div className="bg-gray-800 p-4 rounded-lg">
            <h3 className="font-semibold mb-3">Face Registration</h3>
            
            {!registrationSession ? (
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Enter Person ID"
                  value={newPersonId}
                  onChange={(e) => setNewPersonId(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                />
                <button
                  onClick={startRegistration}
                  className="w-full px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg transition-colors"
                >
                  Start Registration
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm">
                  <div className="font-medium">Registering: {registrationSession.person_id}</div>
                  <div className="text-gray-400">
                    Step {registrationSession.current_step + 1} of {registrationSession.steps.length}
                  </div>
                  <div className="text-gray-400">
                    Progress: {Math.round(registrationSession.overall_progress)}%
                  </div>
                </div>
                
                {registrationGuidance && (
                  <div className="space-y-2">
                    <div className="text-sm bg-gray-700 p-2 rounded">
                      {registrationGuidance.current_instruction}
                    </div>
                    
                    {registrationGuidance.quality_feedback.length > 0 && (
                      <div className="text-sm text-yellow-400">
                        {registrationGuidance.quality_feedback.join(', ')}
                      </div>
                    )}
                    
                    <div className="flex space-x-2">
                      {registrationGuidance.next_action === 'capture' && (
                        <button
                          onClick={processRegistrationCapture}
                          className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm transition-colors"
                        >
                          Capture
                        </button>
                      )}
                      
                      {registrationGuidance.next_action === 'complete' && (
                        <button
                          onClick={completeRegistration}
                          className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-500 rounded text-sm transition-colors"
                        >
                          Complete
                        </button>
                      )}
                      
                      <button
                        onClick={() => {
                          enhancedFaceRegistration.cancelRegistration(registrationSession.session_id);
                          setRegistrationSession(null);
                          setRegistrationGuidance(null);
                        }}
                        className="px-3 py-2 bg-red-600 hover:bg-red-500 rounded text-sm transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Recent Captures */}
          <div className="bg-gray-800 p-4 rounded-lg">
            <h3 className="font-semibold mb-3">Recent Captures</h3>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {captureHistory.slice(0, 10).map((capture, index) => (
                <div key={index} className="text-sm bg-gray-700 p-2 rounded">
                  <div className="flex justify-between items-center">
                    <span className={`font-medium ${capture.success ? 'text-green-400' : 'text-red-400'}`}>
                      {capture.mode.toUpperCase()}
                    </span>
                    <span className="text-gray-400">
                      {new Date(capture.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-gray-300">
                    {capture.faces_recognized > 0 
                      ? `${capture.faces_recognized} recognized`
                      : capture.success 
                        ? `${capture.faces_detected} detected`
                        : capture.error
                    }
                  </div>
                  <div className="text-gray-400">
                    Quality: {Math.round(capture.quality_score * 100)}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}