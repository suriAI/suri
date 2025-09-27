import { useState, useEffect, useRef, useCallback } from 'react';
import { BackendService } from '../services/BackendService';
import { Settings } from './Settings';
import { attendanceManager } from '../services/AttendanceManager';
import { AttendanceDashboard } from './AttendanceDashboard';
import type { 
  PersonInfo, 
  FaceRecognitionResponse,
  AttendanceGroup,
  AttendanceMember,
  AttendanceStats,
  AttendanceRecord,
  GroupType
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

export default function LiveVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const detectionEnabledRef = useRef<boolean>(false);
  const backendServiceRef = useRef<BackendService | null>(null);
  const isProcessingRef = useRef<boolean>(false);
  const isStreamingRef = useRef<boolean>(false);
  
  // Performance optimization refs
  const lastCanvasSizeRef = useRef<{width: number, height: number}>({width: 0, height: 0});
  const lastVideoSizeRef = useRef<{width: number, height: number}>({width: 0, height: 0});
  const scaleFactorsRef = useRef<{scaleX: number, scaleY: number, offsetX: number, offsetY: number}>({scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0});
  const lastDetectionHashRef = useRef<string>('');
  
  // OPTIMIZATION: Cache video rect to avoid repeated getBoundingClientRect calls
  const videoRectRef = useRef<DOMRect | null>(null);
  const lastVideoRectUpdateRef = useRef<number>(0);

  const [isStreaming, setIsStreaming] = useState(false);
  const [detectionEnabled, setDetectionEnabled] = useState(false);
  const [currentDetections, setCurrentDetections] = useState<DetectionResult | null>(null);
  const [detectionFps, setDetectionFps] = useState<number>(0);
  const [websocketStatus, setWebsocketStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [backendServiceReady, setBackendServiceReady] = useState(false);
  const backendServiceReadyRef = useRef(false);
  const lastDetectionRef = useRef<DetectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('');
  
  // Anti-spoofing settings

  // Face recognition settings
  const [registeredPersons, setRegisteredPersons] = useState<PersonInfo[]>([]);

  const [selectedPersonForRegistration, setSelectedPersonForRegistration] = useState<string>('');
  const [showRegistrationDialog, setShowRegistrationDialog] = useState(false);
  const [currentRecognitionResults, setCurrentRecognitionResults] = useState<Map<number, FaceRecognitionResponse>>(new Map());

  // ACCURATE FPS tracking with rolling average
  const fpsTrackingRef = useRef({
    timestamps: [] as number[],
    maxSamples: 10, // Track last 10 detections for smooth average
    lastUpdateTime: Date.now()
  });

  // Settings view state
  const [showSettings, setShowSettings] = useState(false);

  // Attendance system state
  const attendanceEnabled = true;
  const [currentGroup, setCurrentGroup] = useState<AttendanceGroup | null>(null);
  
  // Recognition is enabled when backend is ready (removed group dependency for instant recognition)
  const recognitionEnabled = true;
  
  // Store last detection result for delayed recognition
  const [lastDetectionForRecognition, setLastDetectionForRecognition] = useState<any>(null);
  
  // Elite Tracking System States
  const [trackingMode, setTrackingMode] = useState<'auto' | 'manual'>('auto');
  const [trackedFaces, setTrackedFaces] = useState<Map<string, {
    id: string;
    bbox: { x: number; y: number; width: number; height: number };
    confidence: number;
    lastSeen: number;
    trackingHistory: Array<{ timestamp: number; bbox: { x: number; y: number; width: number; height: number }; confidence: number }>;
    isLocked: boolean;
    personId?: string;
    occlusionCount: number;
    angleConsistency: number;
  }>>(new Map());
  const [selectedTrackingTarget, setSelectedTrackingTarget] = useState<string | null>(null);

  const [pendingAttendance, setPendingAttendance] = useState<Array<{
    id: string;
    personId: string;
    confidence: number;
    timestamp: number;
    faceData: any;
  }>>([]);
  const [attendanceGroups, setAttendanceGroups] = useState<AttendanceGroup[]>([]);
  const [groupMembers, setGroupMembers] = useState<AttendanceMember[]>([]);
  const [attendanceStats, setAttendanceStats] = useState<AttendanceStats | null>(null);
  const [recentAttendance, setRecentAttendance] = useState<AttendanceRecord[]>([]);
  const [showGroupManagement, setShowGroupManagement] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<AttendanceGroup | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupType, setNewGroupType] = useState<GroupType>('general');


  const [showAttendanceDashboard, setShowAttendanceDashboard] = useState(false);

  // OPTIMIZED: Capture frame with reduced canvas operations and better context settings
  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('⚠️ captureFrame: Missing video or canvas element');
      }
      return null;
    }
    
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('⚠️ captureFrame: Video dimensions not ready:', video.videoWidth, 'x', video.videoHeight);
      }
      return null;
    }

    // OPTIMIZATION: Get context with optimized settings
    const ctx = canvas.getContext('2d', { 
      alpha: false, // No transparency needed for capture
      willReadFrequently: false // We don't read pixels frequently
    });
    if (!ctx) {
      console.warn('⚠️ captureFrame: Failed to get canvas context');
      return null;
    }

    // OPTIMIZATION: Only resize canvas if video dimensions changed
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    try {
      // Draw current video frame
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // OPTIMIZATION: Use lower quality for better performance (0.4 instead of 0.6)
      const base64 = canvas.toDataURL('image/jpeg', 0.4).split(',')[1];
      return base64;
    } catch (error) {
      console.error('❌ captureFrame: Failed to capture frame:', error);
      return null;
    }
  }, []);

  // Face recognition function
  const performFaceRecognition = useCallback(async (detectionResult: DetectionResult) => {
    try {
      const frameData = captureFrame();
      if (!frameData) {
        console.warn('⚠️ Failed to capture frame for face recognition');
        return;
      }

      // Capture current group at start of processing to validate later
      const processingGroup = currentGroup;
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`🎯 Starting face recognition for group: ${processingGroup?.name || 'null'} (ID: ${processingGroup?.id || 'null'})`);
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
            landmarks,
            currentGroup?.id
          );

          if (response.success && response.person_id) {
            console.log(`🎯 Face ${index} recognized as: ${response.person_id} (${((response.similarity || 0) * 100).toFixed(1)}%)`);
            
            // Group-based filtering: Only process faces that belong to the current group (by name)
            let memberName = response.person_id; // Default to person_id if no member found
            if (currentGroup) {
              try {
                const member = await attendanceManager.getMember(response.person_id);
                if (!member) {
                  console.log(`🚫 Face ${index} filtered out: ${response.person_id} not registered as a member`);
                  return null; // Filter out this face completely
                }
                
                // Store the member's name for display
                memberName = member.name || response.person_id;
                
                // Compare group IDs directly for reliable filtering
                if (member.group_id !== currentGroup.id) {
                  // Get the member's group information for logging purposes
                  try {
                    const memberGroup = await attendanceManager.getGroup(member.group_id);
                    const memberGroupName = memberGroup ? memberGroup.name : 'unknown group';
                    console.log(`🚫 Face ${index} filtered out: ${memberName} belongs to group "${memberGroupName}" (ID: ${member.group_id}), not current group "${currentGroup.name}" (ID: ${currentGroup.id})`);
                  } catch (groupError) {
                    console.warn(groupError)
                  }
                  return null; // Filter out this face completely
                }
                console.log(`✅ Face ${index} belongs to current group "${currentGroup.name}" (ID: ${currentGroup.id}): ${memberName}`);
              } catch (error) {
                console.warn(`⚠️ Error validating group membership for ${response.person_id}:`, error);
                return null; // Filter out on error
              }
            } else {
              // When no group is selected, still try to get the member name for display
              try {
                const member = await attendanceManager.getMember(response.person_id);
                if (member && member.name) {
                  memberName = member.name;
                }
              } catch {
                // Silently fail and use person_id as fallback
              }
            }
            
            // Elite Tracking System - Update tracked face with recognition data
            const faceId = `face_${index}_${Date.now()}`;
            const currentTime = Date.now();
            
            // Update tracking data
            setTrackedFaces(prev => {
              const newTracked = new Map(prev);
              const existingTrack = Array.from(newTracked.values()).find(
                track => track.personId === response.person_id && 
                Math.abs(track.bbox.x - face.bbox.x) < 50 && 
                Math.abs(track.bbox.y - face.bbox.y) < 50
              );
              
              if (existingTrack) {
                // Update existing track
                existingTrack.lastSeen = currentTime;
                existingTrack.confidence = Math.max(existingTrack.confidence, face.confidence);
                existingTrack.trackingHistory.push({
                  timestamp: currentTime,
                  bbox: face.bbox,
                  confidence: face.confidence
                });
                existingTrack.occlusionCount = 0; // Reset occlusion count
                existingTrack.angleConsistency = calculateAngleConsistency(existingTrack.trackingHistory);
                newTracked.set(existingTrack.id, existingTrack);
              } else {
                // Create new track
                newTracked.set(faceId, {
                  id: faceId,
                  bbox: face.bbox,
                  confidence: face.confidence,
                  lastSeen: currentTime,
                  trackingHistory: [{ timestamp: currentTime, bbox: face.bbox, confidence: face.confidence }],
                  isLocked: trackingMode === 'auto',
                  personId: response.person_id,
                  occlusionCount: 0,
                  angleConsistency: 1.0
                });
              }
              
              return newTracked;
            });
            
            // Enhanced Attendance Processing with comprehensive error handling
            if (attendanceEnabled && currentGroup && response.person_id) {
              console.log(`🔍 Processing attendance for ${memberName} in group ${currentGroup.name}`);
              console.log(`📊 Recognition details:`, {
                person_id: response.person_id,
                similarity: response.similarity,
                confidence: face.confidence,
                antispoofing: face.antispoofing,
                trackingMode: trackingMode
              });
              
              try {
                // Note: Group validation is now done at recognition level
                // Backend handles all confidence thresholding - frontend processes all valid responses
                const actualConfidence = response.similarity || 0;
                
                // Anti-spoofing validation is handled by optimized backend
                console.log(`✅ Processing attendance event (backend handles anti-spoofing validation)...`);
                
                if (trackingMode === 'auto') {
                  // AUTO MODE: Process attendance event immediately
                  try {
                    const attendanceEvent = await attendanceManager.processAttendanceEvent(
                      response.person_id,
                      actualConfidence,
                      'LiveVideo Camera', // location
                      face.antispoofing?.status,
                      face.antispoofing?.confidence
                    );
                    
                    console.log(`📋 ✅ Attendance automatically recorded: ${response.person_id} - ${attendanceEvent.type} at ${attendanceEvent.timestamp}`);
                    

                    
                    // Refresh attendance data
                    await loadAttendanceData();
                    
                    // Show success notification
                    setError(null);
                  } catch (attendanceError: any) {
                    console.error(`❌ Attendance event processing failed for ${response.person_id}:`, attendanceError.message);
                    setError(attendanceError.message || `Failed to record attendance for ${response.person_id}`);
                  }
                } else {
                  // MANUAL MODE: Add to pending queue for manual confirmation
                  const pendingId = `${response.person_id}_${Date.now()}`;
                  const pendingItem = {
                    id: pendingId,
                    personId: response.person_id,
                    confidence: actualConfidence,
                    timestamp: Date.now(),
                    faceData: face
                  };
                  
                  setPendingAttendance(prev => {
                    // Check if this person is already in pending queue (avoid duplicates)
                    const existingIndex = prev.findIndex(item => item.personId === response.person_id);
                    if (existingIndex >= 0) {
                      // Update existing entry with latest data
                      const updated = [...prev];
                      updated[existingIndex] = pendingItem;
                      return updated;
                    } else {
                      // Add new entry
                      return [...prev, pendingItem];
                    }
                  });
                  
                  console.log(`⏳ Manual mode: Added ${response.person_id} to pending attendance queue`);
                }
                
              } catch (error) {
                console.error('❌ Attendance processing failed:', error);
                setError(`Attendance error: ${error instanceof Error ? error.message : 'Unknown error'}`);
              }
            } else {
              if (!attendanceEnabled) console.log(`ℹ️ Attendance is disabled`);
              if (!currentGroup) console.log(`ℹ️ No current group selected`);
              if (!response.person_id) console.log(`ℹ️ No person ID in response`);
            }
            
            return { index, result: { ...response, memberName } };
          } else if (response.success) {
            console.log(`👤 Face ${index} not recognized (similarity: ${((response.similarity || 0) * 100).toFixed(1)}%)`);
            
            // Track unrecognized faces for potential manual registration
            const faceId = `unknown_${index}_${Date.now()}`;
            const currentTime = Date.now();
            
            setTrackedFaces(prev => {
              const newTracked = new Map(prev);
              newTracked.set(faceId, {
                id: faceId,
                bbox: face.bbox,
                confidence: face.confidence,
                lastSeen: currentTime,
                trackingHistory: [{ timestamp: currentTime, bbox: face.bbox, confidence: face.confidence }],
                isLocked: false,
                personId: undefined,
                occlusionCount: 0,
                angleConsistency: 1.0
              });
              return newTracked;
            });
          }
        } catch (error) {
          console.warn(`⚠️ Face recognition failed for face ${index}:`, error);
        }
        return null;
      });

      const recognitionResults = await Promise.all(recognitionPromises);
      
      // Validate that group hasn't changed during processing
      if (processingGroup?.id !== currentGroup?.id) {
        console.log(`🚫 Discarding recognition results - group changed during processing (was: ${processingGroup?.name}, now: ${currentGroup?.name})`);
        return;
      }
      
      // Update recognition results map - start fresh to avoid persisting old group results
      const newRecognitionResults = new Map<number, FaceRecognitionResponse>();
      recognitionResults.forEach((result) => {
        if (result) {
          newRecognitionResults.set(result.index, result.result);
        }
      });
      
      setCurrentRecognitionResults(newRecognitionResults);

    } catch (error) {
      console.error('❌ Face recognition processing failed:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureFrame, currentRecognitionResults]);

  // Initialize WebSocket connection
  const initializeWebSocket = useCallback(async () => {
    try {
      if (!backendServiceRef.current) {
        backendServiceRef.current = new BackendService();
      }

      // Check backend readiness before connecting WebSocket with retry logic
      console.log('🔍 Checking backend readiness before WebSocket connection...');
      
      const waitForBackendReady = async (maxAttempts = 5, baseDelay = 300) => {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          console.log(`🔍 WebSocket backend readiness check attempt ${attempt}/${maxAttempts}`);
          
          const readinessCheck = await window.electronAPI?.backend.checkReadiness();
          
          if (readinessCheck?.ready && readinessCheck?.modelsLoaded) {
            return true;
          }
          
          if (attempt < maxAttempts) {
            const delay = baseDelay * Math.pow(1.3, attempt - 1); // Smaller exponential backoff for WebSocket
            console.log(`⏳ Backend not ready for WebSocket (${readinessCheck?.error || 'models loading'}), retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
        
        console.warn('⚠️ Backend readiness timeout for WebSocket after all attempts');
        return false;
      };
      
      const isBackendReady = await waitForBackendReady();
      
      if (!isBackendReady) {
        throw new Error('Backend not ready: Models still loading after retries');
      }


      // Connect to WebSocket
      await backendServiceRef.current.connectWebSocket();
      
      // Backend service ready state will be set when connection confirmation is received
        
        // Register message handler for detection responses
        backendServiceRef.current.onMessage('detection_response', (data: WebSocketDetectionResponse) => {
        // Reduced logging for performance
        if (process.env.NODE_ENV === 'development') {
          console.log('📨 Detection response received');
        }
        
        // ACCURATE FPS calculation with rolling average
        const now = Date.now();
        const fpsTracking = fpsTrackingRef.current;
        
        // Add current timestamp
        fpsTracking.timestamps.push(now);
        
        // Keep only the last N samples for rolling average
        if (fpsTracking.timestamps.length > fpsTracking.maxSamples) {
          fpsTracking.timestamps.shift();
        }
        
        // Calculate FPS every 500ms for smooth updates
        if (now - fpsTracking.lastUpdateTime >= 500 && fpsTracking.timestamps.length >= 2) {
          const timeSpan = fpsTracking.timestamps[fpsTracking.timestamps.length - 1] - fpsTracking.timestamps[0];
          const frameCount = fpsTracking.timestamps.length - 1;
          
          if (timeSpan > 0) {
            const accurateFps = (frameCount * 1000) / timeSpan;
            setDetectionFps(Math.round(accurateFps * 10) / 10); // Round to 1 decimal place
          }
          
          fpsTracking.lastUpdateTime = now;
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

          // Reset processing flag immediately to allow next frame processing
          isProcessingRef.current = false;

          // Perform face recognition if enabled
          if (process.env.NODE_ENV === 'development') {
            console.log('🔍 Recognition check:', {
              recognitionEnabled,
              backendServiceReady: backendServiceReadyRef.current,
              currentGroup: currentGroup?.name || 'null',
              facesDetected: detectionResult.faces.length
            });
          }
          
          if (recognitionEnabled && backendServiceReadyRef.current && detectionResult.faces.length > 0) {
            // Perform face recognition asynchronously without blocking next frame processing
            performFaceRecognition(detectionResult).catch(error => {
              console.error('❌ Face recognition failed:', error);
            });
          } else {
            if (!recognitionEnabled && detectionResult.faces.length > 0) {
              // Store detection result for delayed recognition when recognition becomes enabled
              console.log('💾 Storing detection result for delayed recognition');
              setLastDetectionForRecognition(detectionResult);
            }
            // Backend controls the adaptive processing flow
          }
        } else {
          // No faces detected, reset processing flag - backend will request next frame
          isProcessingRef.current = false;
          // Backend controls the adaptive processing flow
        }
      });

      // Handle connection messages
      backendServiceRef.current.onMessage('connection', (data: WebSocketConnectionMessage) => {
        if (process.env.NODE_ENV === 'development') {
          console.log('🔗 WebSocket connection message:', data);
        }
        // Set backend service as ready when connection is confirmed
        if (data.status === 'connected') {
          setBackendServiceReady(true);
          backendServiceReadyRef.current = true;
          console.log('✅ Backend service marked as ready after connection confirmation');
        }
      });

      // Handle error messages
      backendServiceRef.current.onMessage('error', (data: WebSocketErrorMessage) => {
        console.error('❌ WebSocket error message:', data);
        setError(`Detection error: ${data.message || 'Unknown error'}`);
        isProcessingRef.current = false;
        // Backend will handle error recovery and request next frame when ready
        // No manual intervention needed - adaptive processing will resume automatically
      });

      // Handle pong messages
      backendServiceRef.current.onMessage('pong', (data: WebSocketPongMessage) => {
        if (process.env.NODE_ENV === 'development') {
          console.log('🏓 WebSocket pong received:', data);
        }
      });

      // Handle next frame requests from adaptive backend
      backendServiceRef.current.onMessage('request_next_frame', (data: any) => {
        if (process.env.NODE_ENV === 'development') {
          console.log('🎯 Backend requesting next frame for adaptive processing', {
            detectionEnabled: detectionEnabledRef.current,
            websocketReady: backendServiceRef.current?.isWebSocketReady(),
            isProcessing: isProcessingRef.current,
            isStreaming: isStreamingRef.current
          });
        }
        // Backend is ready for next frame - send it immediately
        if (detectionEnabledRef.current && backendServiceRef.current?.isWebSocketReady()) {
          processFrameForDetection();
        } else {
          if (process.env.NODE_ENV === 'development') {
            console.warn('⚠️ Cannot process next frame:', {
              detectionEnabled: detectionEnabledRef.current,
              websocketReady: backendServiceRef.current?.isWebSocketReady()
            });
          }
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
      backendServiceReadyRef.current = false;
    }
  }, [recognitionEnabled, performFaceRecognition]);

  // Process current frame directly without queue
  const processCurrentFrame = useCallback(() => {
    // OPTIMIZATION: Enhanced frame skipping logic
    if (isProcessingRef.current || 
        !backendServiceRef.current?.isWebSocketReady() || 
        !detectionEnabledRef.current ||
        !isStreamingRef.current) {
      return;
    }

    try {
      const frameData = captureFrame();
      if (!frameData || !backendServiceRef.current) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('⚠️ processCurrentFrame: No frame data or backend service');
        }
        return;
      }

      isProcessingRef.current = true;
      
      // Backend handles all threshold configuration
      backendServiceRef.current.sendDetectionRequest(frameData, {
        model_type: 'yunet',
        nms_threshold: 0.3,
        enable_antispoofing: true
      }).catch(error => {
        console.error('❌ WebSocket detection request failed:', error);
        isProcessingRef.current = false;
      });
    } catch (error) {
      console.error('❌ Frame capture failed:', error);
      isProcessingRef.current = false;
    }
  }, [captureFrame]);

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

  // Start detection interval helper - now triggers initial frame only
  const startDetectionInterval = useCallback(() => {
    if (detectionEnabledRef.current && 
        backendServiceRef.current?.isWebSocketReady()) {
      // Send initial frame to start the adaptive processing chain
      processFrameForDetection();
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
          deviceId: selectedCamera ? { exact: selectedCamera } : undefined
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        // Wait for video to be ready before starting detection
        const waitForVideoReady = () => {
          return new Promise<void>((resolve) => {
            const video = videoRef.current;
            if (!video) {
              resolve();
              return;
            }

            const checkVideoReady = () => {
              if (video.videoWidth > 0 && video.videoHeight > 0) {
                resolve();
              } else {
                setTimeout(checkVideoReady, 16);
              }
            };

            // Start playing and check readiness
            video.play().then(() => {
              checkVideoReady();
            }).catch((error) => {
              console.warn('Video play failed, but continuing:', error);
              checkVideoReady();
            });
          });
        };

        await waitForVideoReady();
        
        // Set streaming state and refs immediately
        setIsStreaming(true);
        isStreamingRef.current = true; // Set ref immediately for synchronous access
        
        try {
          // Wait for backend to be ready with retry logic
          const waitForBackendReady = async (maxAttempts = 10, baseDelay = 500) => {
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {       
              const readinessCheck = await window.electronAPI?.backend.checkReadiness();
            
              if (readinessCheck?.ready && readinessCheck?.modelsLoaded) {
                return true;
              }
              
              if (attempt < maxAttempts) {
                const delay = baseDelay * Math.pow(1.5, attempt - 1); // Exponential backoff
                await new Promise(resolve => setTimeout(resolve, delay));
              }
            }
            
            console.warn('⚠️ Backend readiness timeout after all attempts');
            return false;
          };
          
          const isBackendReady = await waitForBackendReady();
          
          if (!isBackendReady) {
            console.warn('⚠️ Backend not ready for face recognition after retries');
            setError('Backend models are still loading. Please wait and try again.');
            
            // Still allow camera to start but don't enable detection
            setDetectionEnabled(false);
            detectionEnabledRef.current = false;
            return;
          }
                
          // Automatically start detection when camera starts
          setDetectionEnabled(true);
          detectionEnabledRef.current = true;
          
          if (websocketStatus === 'disconnected') {
            try {
              await initializeWebSocket();
              // Wait for WebSocket to be fully ready before starting detection
              let attempts = 0;
              const maxAttempts = 20; // Increased attempts for better reliability
              const waitForReady = () => {
                return new Promise<void>((resolve, reject) => {
                  const checkReady = () => {
                    if (backendServiceRef.current?.isWebSocketReady()) {
                      console.log('✅ WebSocket is ready, starting detection interval');
                      startDetectionInterval();
                      resolve();
                    } else if (attempts < maxAttempts) {
                      attempts++;
                      setTimeout(checkReady, 100); // Check every 100ms
                    } else {
                      reject(new Error('WebSocket readiness timeout'));
                    }
                  };
                  checkReady();
                });
              };
              
              await waitForReady();
            } catch (error) {
              console.error('❌ Failed to initialize WebSocket or start detection:', error);
              setDetectionEnabled(false);
              detectionEnabledRef.current = false;
              setError('Failed to connect to detection service');
            }
          } else if (websocketStatus === 'connected') {
            // WebSocket is already connected, start detection immediately
            startDetectionInterval();
          }
        } catch (error) {
          console.error('❌ Failed to check backend readiness:', error);
          setError('Failed to check backend readiness');
          setDetectionEnabled(false);
          detectionEnabledRef.current = false;
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
    isStreamingRef.current = false;
    
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
    
    // No longer using detectionIntervalRef for setInterval - adaptive processing instead
    
    // Clear detection results
    setCurrentDetections(null);
    lastDetectionRef.current = null;
    
    // Reset ACCURATE FPS tracking
    setDetectionFps(0);
    fpsTrackingRef.current = {
      timestamps: [],
      maxSamples: 10,
      lastUpdateTime: Date.now()
    };
    
    // Reset performance tracking refs
    lastDetectionHashRef.current = '';
    lastVideoSizeRef.current = {width: 0, height: 0};
    lastCanvasSizeRef.current = {width: 0, height: 0};
    scaleFactorsRef.current = {scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0};
    
    // Clear recognition results
    setCurrentRecognitionResults(new Map());
    
    // Clear any errors
    setError(null);
    
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

  // Cache video rect to avoid repeated getBoundingClientRect calls
  const getVideoRect = useCallback(() => {
    const video = videoRef.current;
    if (!video) return null;

    const now = Date.now();
    // Update rect only every 100ms to reduce layout thrashing
    if (!videoRectRef.current || now - lastVideoRectUpdateRef.current > 100) {
      videoRectRef.current = video.getBoundingClientRect();
      lastVideoRectUpdateRef.current = now;
    }
    
    return videoRectRef.current;
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

  // Helper function to determine face color
  const getFaceColor = (face: any, recognitionResult: any, recognitionEnabled: boolean) => {
    const isRecognized = recognitionEnabled && recognitionResult?.person_id;
    
    if (isRecognized) return "#00ff41"; // Green for recognized faces
    
    // All unknown/unrecognized faces should be red, regardless of antispoofing status
    return "#ff0000"; // Red for all unknown faces
  };

  // Helper function to draw complete bounding box
  const drawBoundingBox = (ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath();
    ctx.rect(x1, y1, x2 - x1, y2 - y1);
    ctx.stroke();
  };

  // Helper function to setup canvas context
  const setupCanvasContext = (ctx: CanvasRenderingContext2D, color: string) => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
  };

  const drawOverlays = useCallback(() => {
    const video = videoRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    
    if (!video || !overlayCanvas || !currentDetections) return;

    const ctx = overlayCanvas.getContext('2d', { 
      alpha: true, 
      willReadFrequently: false 
    });
    if (!ctx) return;

    // Early exit if no streaming or detections
    if (!isStreaming || !currentDetections.faces?.length) {
      ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      return;
    }

    const rect = getVideoRect();
    if (!rect) return;

    const displayWidth = Math.round(rect.width);
    const displayHeight = Math.round(rect.height);

    // Resize canvas if needed
    if (overlayCanvas.width !== displayWidth || overlayCanvas.height !== displayHeight) {
      overlayCanvas.width = displayWidth;
      overlayCanvas.height = displayHeight;
      overlayCanvas.style.width = `${displayWidth}px`;
      overlayCanvas.style.height = `${displayHeight}px`;
    }

    ctx.clearRect(0, 0, displayWidth, displayHeight);

    const scaleFactors = calculateScaleFactors();
    if (!scaleFactors) return;

    const { scaleX, scaleY, offsetX, offsetY } = scaleFactors;

    // Validate scale factors
    if (!isFinite(scaleX) || !isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) return;

    // Draw each face detection
    currentDetections.faces.forEach((face, index) => {
      const { bbox, confidence, antispoofing, landmarks } = face;
      
      // Validate bbox
      if (!bbox || !isFinite(bbox.x) || !isFinite(bbox.y) || !isFinite(bbox.width) || !isFinite(bbox.height)) return;

      // Calculate scaled coordinates
      const x1 = bbox.x * scaleX + offsetX;
      const y1 = bbox.y * scaleY + offsetY;
      const x2 = (bbox.x + bbox.width) * scaleX + offsetX;
      const y2 = (bbox.y + bbox.height) * scaleY + offsetY;

      // Validate scaled coordinates
      if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) return;

      const width = x2 - x1;
      const height = y2 - y1;
      const recognitionResult = currentRecognitionResults.get(index);
      const color = getFaceColor(face, recognitionResult, recognitionEnabled);

      // Setup context and draw bounding box
      setupCanvasContext(ctx, color);
      drawBoundingBox(ctx, x1, y1, x2, y2);

      // Draw label
      const isRecognized = recognitionEnabled && recognitionResult?.person_id;
      let label = "Unknown";
      
      if (isRecognized) {
        label = (recognitionResult.memberName || recognitionResult.person_id)
      } else if (antispoofing?.status === 'fake') {
        label = "⚠ SPOOF";
      }

      ctx.font = 'bold 16px "Courier New", monospace';
      ctx.fillText(label, x1, y1 - 10);

      // Draw landmarks if available
      if (landmarks) {
        const landmarkPoints = [
          landmarks.right_eye,
          landmarks.left_eye,
          landmarks.nose_tip,
          landmarks.right_mouth_corner,
          landmarks.left_mouth_corner
        ].filter(point => point && isFinite(point.x) && isFinite(point.y));

        landmarkPoints.forEach(point => {
          const lx = point.x * scaleX + offsetX;
          const ly = point.y * scaleY + offsetY;
          
          if (isFinite(lx) && isFinite(ly) && lx >= 0 && ly >= 0 && lx <= displayWidth && ly <= displayHeight) {
            ctx.beginPath();
            ctx.arc(lx, ly, 3, 0, 2 * Math.PI);
            ctx.fill();
          }
        });
      }

      // Status indicator
      if (isRecognized) {
        ctx.font = 'bold 10px "Courier New", monospace';
        ctx.fillStyle = "#00ff00";
        ctx.fillText("RECOGNIZED", x1 + 10, y2 + 15);
      }

      // Reset context
      ctx.shadowBlur = 0;
    });
  }, [currentDetections, isStreaming, getVideoRect, calculateScaleFactors, currentRecognitionResults, recognitionEnabled]);

  // OPTIMIZED animation loop with better performance
  const animate = useCallback(() => {
    // Clear canvas when there are no detections
    const overlayCanvas = overlayCanvasRef.current;
    if (overlayCanvas && (!currentDetections || !isStreaming)) {
      const ctx = overlayCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
    }

    // Only redraw if detection results or recognition results changed
    const currentHash = currentDetections ? 
      `${currentDetections.faces.length}-${currentDetections.faces.map(f => `${f.bbox.x},${f.bbox.y}`).join(',')}-${currentRecognitionResults.size}-${Array.from(currentRecognitionResults.values()).map(r => r.person_id || 'none').join(',')}` : '';
    
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
    if (!currentDetections?.faces?.[faceIndex] || !selectedPersonForRegistration.trim()) {
      setError('Please select a person and a valid face');
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
        selectedPersonForRegistration.trim(),
        landmarks,
        currentGroup?.id
      );

      if (response.success) {
        setSelectedPersonForRegistration('');
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
      console.error('❌ Face recognition failed:', error);
      setError('Failed to register face');
    }
  }, [currentDetections, selectedPersonForRegistration, captureFrame, loadRegisteredPersons, loadDatabaseStats, performFaceRecognition]);

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

  // Attendance Management Functions
  const loadAttendanceData = useCallback(async () => {
    try {
      const groups = await attendanceManager.getGroups();
      setAttendanceGroups(groups);
      
      // Validate that currentGroup still exists in the available groups
      if (currentGroup) {
        const groupStillExists = groups.some(group => group.id === currentGroup.id);
        if (!groupStillExists) {
          // Clear currentGroup if it no longer exists (e.g., was deleted)
          console.warn(`⚠️ Current group "${currentGroup.name}" no longer exists. Clearing selection.`);
          setCurrentGroup(null);
          setGroupMembers([]);
          setAttendanceStats(null);
          setRecentAttendance([]);
          setSelectedPersonForRegistration('');
          return;
        }

        const [members, stats, records] = await Promise.all([
          attendanceManager.getGroupMembers(currentGroup.id),
          attendanceManager.getGroupStats(currentGroup.id),
          attendanceManager.getRecords({
            group_id: currentGroup.id,
            limit: 50
          })
        ]);
        
        setGroupMembers(members);
        setAttendanceStats(stats);
        setRecentAttendance(records);
        
        // Validate and clear selectedPersonForRegistration if they're no longer in the group
        if (selectedPersonForRegistration && !members.some(member => member.person_id === selectedPersonForRegistration)) {
          console.warn(`⚠️ Selected person "${selectedPersonForRegistration}" is no longer in group "${currentGroup.name}". Clearing selection.`);
          setSelectedPersonForRegistration('');
          setError(`Selected member "${selectedPersonForRegistration}" is no longer in the group. Please select a valid member.`);
        }
      }
    } catch (error) {
      console.error('❌ Failed to load attendance data:', error);
    }
  }, [currentGroup]);

  // Elite Registration Handler Functions
  const handleEliteRegisterFace = useCallback(async (faceIndex: number) => {
    if (!currentDetections?.faces || !selectedPersonForRegistration || !currentGroup) return;
    
    const face = currentDetections.faces[faceIndex];
    if (!face) return;

    // Enhanced validation - backend handles anti-spoofing validation
    if (face.confidence <= 0.8) {
      setError('Face quality too low for registration (minimum 80% confidence required)');
      return;
    }

    // Validate that the selected member exists in the current group
    const memberExists = groupMembers.some(member => member.person_id === selectedPersonForRegistration);
    if (!memberExists) {
      setError(`Member "${selectedPersonForRegistration}" not found in group "${currentGroup.name}". Please select a valid member.`);
      return;
    }

    try {
      // Capture frame data
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      const frameData = canvas.toDataURL('image/jpeg', 0.95);
      const landmarks = [
        [face.landmarks.right_eye.x, face.landmarks.right_eye.y],
        [face.landmarks.left_eye.x, face.landmarks.left_eye.y],
        [face.landmarks.nose_tip.x, face.landmarks.nose_tip.y],
        [face.landmarks.right_mouth_corner.x, face.landmarks.right_mouth_corner.y],
        [face.landmarks.left_mouth_corner.x, face.landmarks.left_mouth_corner.y]
      ];

      console.log(`🎯 Registering elite face for ${selectedPersonForRegistration} in group ${currentGroup.name}`);

      const result = await attendanceManager.registerFaceForGroupPerson(
        currentGroup.id,
        selectedPersonForRegistration,
        frameData,
        landmarks
      );

      if (result.success) {
        console.log('✅ Elite face registration successful:', result.message);
        setError(null);
        
        // Refresh data
        await Promise.all([
          loadRegisteredPersons(),
          loadDatabaseStats(),
          loadAttendanceData()
        ]);
        
        // Reset selection
        setSelectedPersonForRegistration('');
        setShowRegistrationDialog(false);
      } else {
        console.error('❌ Elite face registration failed:', result.error);
        setError(result.error || 'Failed to register face');
      }
    } catch (error) {
      console.error('❌ Elite registration error:', error);
      setError(error instanceof Error ? error.message : 'Registration failed');
    }
  }, [currentDetections, selectedPersonForRegistration, currentGroup, loadRegisteredPersons, loadDatabaseStats, loadAttendanceData]);

  const handleRemoveGroupPersonFace = useCallback(async (personId: string) => {
    if (!currentGroup) return;

    try {
      const result = await attendanceManager.removeFaceDataForGroupPerson(currentGroup.id, personId);
      
      if (result.success) {
        console.log('✅ Face data removed successfully:', result.message);
        setError(null);
        
        // Refresh data
        await Promise.all([
          loadRegisteredPersons(),
          loadDatabaseStats(),
          loadAttendanceData()
        ]);
      } else {
        console.error('❌ Failed to remove face data:', result.error);
        setError(result.error || 'Failed to remove face data');
      }
    } catch (error) {
      console.error('❌ Remove face data error:', error);
      setError(error instanceof Error ? error.message : 'Failed to remove face data');
    }
  }, [currentGroup, loadRegisteredPersons, loadDatabaseStats, loadAttendanceData]);



  // Elite Tracking Helper Functions
  const calculateAngleConsistency = useCallback((history: Array<{ timestamp: number; bbox: any; confidence: number }>) => {
    if (history.length < 2) return 1.0;
    
    let consistencyScore = 0;
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const curr = history[i];
      
      // Calculate movement vector
      const dx = curr.bbox.x - prev.bbox.x;
      const dy = curr.bbox.y - prev.bbox.y;
      const movement = Math.sqrt(dx * dx + dy * dy);
      
      // Penalize erratic movement
      const smoothness = Math.max(0, 1 - movement / 100);
      consistencyScore += smoothness;
    }
    
    return consistencyScore / (history.length - 1);
  }, []);

  const handleOcclusion = useCallback(() => {
    setTrackedFaces(prev => {
      const newTracked = new Map(prev);
      const currentTime = Date.now();
      const occlusionThreshold = 2000; // 2 seconds
      
      for (const [id, track] of newTracked) {
        if (currentTime - track.lastSeen > occlusionThreshold) {
          track.occlusionCount++;
          
          // Remove tracks that have been occluded too long
          if (track.occlusionCount > 5) {
            newTracked.delete(id);
          }
        }
      }
      
      return newTracked;
    });
  }, []);

  const reacquireFace = useCallback((newFace: any, personId?: string) => {
    const currentTime = Date.now();
    let bestMatch: any = null;
    let bestScore = 0;
    
    // Find best matching track for re-acquisition
    trackedFaces.forEach(track => {
      if (track.personId === personId || (!personId && !track.personId)) {
        const timeDiff = currentTime - track.lastSeen;
        const spatialDiff = Math.sqrt(
          Math.pow(newFace.bbox.x - track.bbox.x, 2) + 
          Math.pow(newFace.bbox.y - track.bbox.y, 2)
        );
        
        // Score based on time and spatial proximity
        const score = Math.max(0, 1 - (timeDiff / 5000) - (spatialDiff / 200));
        
        if (score > bestScore && score > 0.3) {
          bestScore = score;
          bestMatch = track;
        }
      }
    });
    
    if (bestMatch) {

      return bestMatch.id;
    }
    
    return null;
  }, [trackedFaces]);

  const lockTrackingTarget = useCallback((faceId: string) => {
    setTrackedFaces(prev => {
      const newTracked = new Map(prev);
      const track = newTracked.get(faceId);
      if (track) {
        track.isLocked = true;
        newTracked.set(faceId, track);
      }
      return newTracked;
    });
    setSelectedTrackingTarget(faceId);
  }, []);

  const unlockTrackingTarget = useCallback((faceId: string) => {
    setTrackedFaces(prev => {
      const newTracked = new Map(prev);
      const track = newTracked.get(faceId);
      if (track) {
        track.isLocked = false;
        newTracked.set(faceId, track);
      }
      return newTracked;
    });
    if (selectedTrackingTarget === faceId) {
      setSelectedTrackingTarget(null);
    }
  }, [selectedTrackingTarget]);

  // Periodic cleanup of old tracks
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      handleOcclusion();
    }, 1000);

    return () => clearInterval(cleanupInterval);
  }, [handleOcclusion]);

  const handleCreateGroup = useCallback(async () => {
    if (!newGroupName.trim()) return;
    
    try {
      const group = await attendanceManager.createGroup(newGroupName.trim(), newGroupType);
      setNewGroupName('');
      setNewGroupType('general');
      setShowGroupManagement(false);
      await loadAttendanceData();
      
      // Auto-select the new group if no group is currently selected
      if (!currentGroup) {
        setCurrentGroup(group);
      }
      
      console.log('✅ Group created successfully:', group.name);
    } catch (error) {
      console.error('❌ Failed to create group:', error);
      setError('Failed to create group');
    }
  }, [newGroupName, newGroupType, currentGroup, loadAttendanceData]);

  const handleSelectGroup = useCallback(async (group: AttendanceGroup) => {
    setCurrentGroup(group);
    await loadAttendanceData();
  }, [loadAttendanceData]);



  const handleDeleteGroup = useCallback((group: AttendanceGroup) => {
    setGroupToDelete(group);
    setShowDeleteConfirmation(true);
  }, []);

  const confirmDeleteGroup = useCallback(async () => {
    if (!groupToDelete) return;
    
    try {
      const success = await attendanceManager.deleteGroup(groupToDelete.id);
      if (success) {
        // If deleting the currently active group, clear the selection
        if (currentGroup?.id === groupToDelete.id) {
          setCurrentGroup(null);
          setGroupMembers([]);
          setRecentAttendance([]);
        }
        
        await loadAttendanceData();
        console.log('✅ Group deleted successfully:', groupToDelete.name);
      } else {
        throw new Error('Failed to delete group');
      }
    } catch (error) {
      console.error('❌ Failed to delete group:', error);
      setError('Failed to delete group');
    } finally {
      setShowDeleteConfirmation(false);
      setGroupToDelete(null);
    }
  }, [groupToDelete, currentGroup, loadAttendanceData]);

  const cancelDeleteGroup = useCallback(() => {
    setShowDeleteConfirmation(false);
    setGroupToDelete(null);
  }, []);



  const formatAttendanceType = (type: string): string => {
    switch (type) {
      case 'check_in': return 'Check In';
      case 'check_out': return 'Check Out';
      case 'break_start': return 'Break Start';
      case 'break_end': return 'Break End';
      default: return type;
    }
  };

  const getGroupTypeIcon = (type: GroupType): string => {
    switch (type) {
      case 'employee': return '👔';
      case 'student': return '🎓';
      case 'visitor': return '👤';
      case 'general': return '👥';
      default: return '👥';
    }
  };

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

    // OPTIMIZATION: Poll every 250ms for responsive status updates (reduced from 100ms)
    const statusInterval = setInterval(pollWebSocketStatus, 250);

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
    let timeoutId: NodeJS.Timeout | undefined;
    
    if (websocketStatus === 'connected' && detectionEnabledRef.current) {
      // Poll for WebSocket readiness with exponential backoff
      let attempts = 0;
      const maxAttempts = 10;
      const checkReadiness = () => {
        if (backendServiceRef.current?.isWebSocketReady() && 
            detectionEnabledRef.current) {
          startDetectionInterval();
        } else if (attempts < maxAttempts) {
          attempts++;
          const delay = Math.min(100 * Math.pow(1.5, attempts), 1000); // Exponential backoff, max 1s
          timeoutId = setTimeout(checkReadiness, delay);
        } else {
          console.warn('⚠️ WebSocket readiness check timed out after', maxAttempts, 'attempts');
        }
      };
      
      // Start checking immediately
      checkReadiness();
    }
    
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
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

  // Clear recognition state whenever group changes to prevent data mixing
  useEffect(() => {
    // Handle group changes (including switching to null when group is deleted)
    console.log(`🔄 Group changed to: ${currentGroup?.name || 'null'} - Clearing recognition state`);
    
    // Clear all recognition and tracking state to prevent data mixing
    setCurrentRecognitionResults(new Map());
    setTrackedFaces(new Map());
    setCurrentDetections(null);
    setSelectedTrackingTarget(null);
    setPendingAttendance([]);
    
    // Clear delayed recognition state to prevent cross-group recognition
    setLastDetectionForRecognition(null);
    
    // Stop detection if running (use ref for synchronous check)
    if (isStreamingRef.current) {
      console.log(`🛑 Stopping detection due to group change`);
      stopCamera();
    }
  }, [currentGroup, stopCamera]);

  // Load attendance data when current group changes
  useEffect(() => {
    if (currentGroup) {
      loadAttendanceData();
    }
  }, [currentGroup, loadAttendanceData]);

  // Initialize attendance system on component mount
  useEffect(() => {
    const initializeAttendance = async () => {
      console.log('🔄 Initializing attendance system...');
      
      try {
        // Load existing groups first
        const groups = await attendanceManager.getGroups();
        setAttendanceGroups(groups);
        
        if (groups.length === 0) {
          console.log('ℹ️ No groups available. Please create a group first.');
          setCurrentGroup(null);
        } else if (!currentGroup) {
          // Select the first available group
          setCurrentGroup(groups[0]);
          console.log('📌 Selected first available group as current:', groups[0]);
        }
      } catch (error) {
        console.error('❌ Failed to initialize attendance system:', error);
        setError('Failed to initialize attendance system');
      }
    };

    initializeAttendance();
  }, []); // Empty dependency array means this runs only on mount

  // Handle delayed recognition when recognitionEnabled becomes true
  useEffect(() => {
    if (recognitionEnabled && lastDetectionForRecognition && lastDetectionForRecognition.faces.length > 0) {
      console.log('🔄 Performing delayed recognition for stored detection result');
      performFaceRecognition(lastDetectionForRecognition);
      setLastDetectionForRecognition(null); // Clear after processing
    }
  }, [recognitionEnabled, lastDetectionForRecognition, performFaceRecognition]);

  return (
    <div className="pt-8 h-screen bg-black text-white flex flex-col overflow-hidden">

      {/* Error Display */}
      {error && (
        <div className="mx-4 mt-3 bg-red-900 border border-red-600 p-3 rounded text-red-200">
          {error}
        </div>
      )}

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
                playsInline
                muted
              />
              <canvas
                ref={overlayCanvasRef}
                className="absolute top-0 left-0 w-full h-full pointer-events-none"
                style={{
                  zIndex: 10,
                  mixBlendMode: "normal",
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
                </div>

                <div className="text-sm text-white/60">
                  FPS: {detectionFps.toFixed(1)}
                </div>

                              <div className="flex justify-between items-center">
                <span className="text-white/60">Process time: &nbsp;</span>
                <span className="font-mono text-white/60"> {currentDetections?.processing_time?.toFixed(3) || 0}ms</span>
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
              
              <div className="flex items-center space-x-4">
                {/* Detection Settings - Toggle Switch */}
                <div className="flex items-center space-x-2">
                  <div className="flex items-center space-x-2">
                    <span className={`text-xs transition-colors duration-200 ${
                      trackingMode === 'auto' ? 'text-cyan-300' : 'text-white/40'
                    }`}>Auto</span>
                    <button
                      onClick={() => setTrackingMode(trackingMode === 'auto' ? 'manual' : 'auto')}
                      className={`relative w-10 h-3 rounded-full transition-all duration-300 focus:outline-none flex items-center ${
                        trackingMode === 'auto' 
                          ? 'bg-cyan-500' 
                          : 'bg-orange-500'
                      }`}
                    >
                      <div className={`absolute left-1 w-4 h-4 bg-white rounded-full shadow-md transition-transform duration-300 ${
                        trackingMode === 'auto' ? 'translate-x-0' : 'translate-x-6'
                      }`}></div>
                    </button>
                    <span className={`text-xs transition-colors duration-200 ${
                      trackingMode === 'manual' ? 'text-orange-300' : 'text-white/40'
                    }`}>Manual</span>
                  </div>
                </div>

                <button
                  onClick={isStreaming ? stopCamera : startCamera}
                  className={`px-4 py-2 rounded font-medium transition-colors duration-150 ${
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
        <div className="w-80 my-3 bg-white/[0.02] border-l border-white/[0.08] flex flex-col max-h-full">
          <div className="px-4 py-2 border-b border-white/[0.08]">
            <div className="space-y-3">
                <div className="flex justify-between">
                                       <button
                       onClick={() => setShowAttendanceDashboard(true)}
                       className="px-3 py-1 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 rounded text-xs transition-colors"
                     >
                       Dashboard
                     </button>
                  <div
                    onClick={() => setShowSettings(true)}
                    className="flex items-center space-x-2  text-white/80 hover:text-white rounded-xl font-light transition-all duration-300"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                </div>
            </div>
          </div>
<div className="sidebar h-full overflow-auto">
  
            {recognitionEnabled && (
              <div className="px-4 py-4 border-b border-white/[0.08]">
                <div className="space-y-2">
                  <button
                    onClick={() => setShowRegistrationDialog(true)}
                    className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-green-600/20 hover:bg-green-600/30 disabled:bg-white/[0.05] disabled:text-white/40 backdrop-blur-xl border border-green-500/30 text-green-200 hover:text-green-100 rounded-xl font-light transition-all duration-300"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    <span className="text-sm font-light tracking-wider uppercase">Register Face</span>
                  </button>
                <div className="flex justify-between items-center">
                  <span className="text-white/60">Registered Persons</span>
                  <span className="font-mono">{registeredPersons.length}</span>
                </div>
                </div>
              </div>
            )}
             <div className="p-4 border-b border-white/[0.08]">
               <div className="space-y-2 h-auto max-h-32 overflow-y-auto recent-logs-scroll">
                {!currentDetections?.faces?.length ? (
                  <div className="text-white/50 text-sm text-center py-4">
                    No faces detected
                  </div>
                ) : (
                  currentDetections.faces.map((face, index) => {
                    const recognitionResult = currentRecognitionResults.get(index);
                    const isRecognized = recognitionEnabled && recognitionResult?.person_id;
  
                    // Find corresponding tracked face
                    const trackedFace = Array.from(trackedFaces.values()).find(track =>
                      track.personId === recognitionResult?.person_id ||
                      (Math.abs(track.bbox.x - face.bbox.x) < 30 && Math.abs(track.bbox.y - face.bbox.y) < 30)
                    );
  
                    return (
                      <div key={index} className={`bg-white/[0.05] border rounded p-3 transition-all duration-200 ${
                        trackedFace?.isLocked ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-white/[0.08]'
                      }`}>
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2">
                              <div className="font-medium">
                                {isRecognized && recognitionResult?.person_id ?
                                  (recognitionResult.memberName || recognitionResult.person_id) :
                                  `Unknown`
                                }
                              </div>
                              {trackedFace && (
                                <div className={`w-2 h-2 rounded-full ${
                                  trackedFace.isLocked ? 'bg-cyan-400' : 'bg-orange-400'
                                }`} title={trackedFace.isLocked ? 'Locked Track' : 'Active Track'}></div>
                              )}
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
                            )}                {/* Manual Tracking Controls */}
                            {trackingMode === 'manual' && trackedFace && (
                              <div className="flex space-x-1 mt-2">
                                <button
                                  onClick={() => trackedFace.isLocked ? unlockTrackingTarget(trackedFace.id) : lockTrackingTarget(trackedFace.id)}
                                  className={`px-2 py-1 rounded text-xs transition-colors ${
                                    trackedFace.isLocked
                                      ? 'bg-cyan-600 text-white hover:bg-cyan-700'
                                      : 'bg-orange-600 text-white hover:bg-orange-700'
                                  }`}
                                >
                                  {trackedFace.isLocked ? '🔒' : '🔓'}
                                </button>
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
  
             {/* Attendance Management or Recent Logs */}
             <div className="flex-1 p-4 min-h-0 h-full">
               {attendanceEnabled ? (
                 <>
                   <div className="flex items-center justify-between mb-4 flex-col">
                     <div className="flex space-x-2  w-full">
                       <button
                         onClick={() => setShowGroupManagement(true)}
                         className="px-3 py-1 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 rounded text-xs transition-colors"
                       >
                         Groups
                       </button>

                     </div>
                   </div>
  
                   <div className="space-y-4 h-full overflow-y-auto">
                     {/* Group Selection */}
                     {attendanceGroups.length > 0 && (
                       <div>
                         <label className="block text-sm font-medium mb-2 text-white/80">Active Group:</label>
                         <select
                           value={currentGroup?.id || ''}
                           onChange={(e) => {
                             const group = attendanceGroups.find(g => g.id === e.target.value);
                             if (group) handleSelectGroup(group);
                           }}
                           className="w-full bg-white/[0.05] text-white text-sm border border-white/[0.1] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                         >
                           {attendanceGroups.map(group => (
                             <option key={group.id} value={group.id} className="bg-black text-white">
                               {getGroupTypeIcon(group.type)} {group.name}
                             </option>
                           ))}
                         </select>
                       </div>
                     )}
  
                     {/* Manual Confirmation Queue */}
                     {trackingMode === 'manual' && pendingAttendance.length > 0 && (
                       <div>
                         <h4 className="text-sm font-medium mb-2 text-white/80">
                           Pending Confirmations ({pendingAttendance.length}):
                         </h4>
                         <div className="space-y-2 max-h-60 overflow-y-auto">
                           {pendingAttendance.map(pending => {
                             const member = groupMembers.find(m => m.person_id === pending.personId);
                             return (
                               <div key={pending.id} className="bg-yellow-600/10 border border-yellow-500/30 rounded p-3">
                                 <div className="flex justify-between items-start">
                                   <div className="flex-1">
                                     <div className="font-medium text-sm text-yellow-300">
                                       {member ? member.name : pending.personId}
                                     </div>
                                     <div className="text-xs text-white/60">
                                       Confidence: {(pending.confidence * 100).toFixed(1)}%
                                     </div>
                                     <div className="text-xs text-white/50">
                                       {new Date(pending.timestamp).toLocaleTimeString()}
                                     </div>
                                   </div>
                                   <div className="flex space-x-2">
                                     <button
                                       onClick={async () => {
                                         // Confirm attendance
                                         try {
                                           const attendanceEvent = await attendanceManager.processAttendanceEvent(
                                             pending.personId,
                                             pending.confidence,
                                             'LiveVideo Camera'
                                           );
  
                                           console.log(`📋 ✅ Manual confirmation: ${pending.personId} - ${attendanceEvent.type}`);
  
  
  
                                           // Remove from pending queue
                                           setPendingAttendance(prev => prev.filter(p => p.id !== pending.id));
  
                                           // Refresh attendance data
                                           await loadAttendanceData();
                                           setError(null);
                                         } catch (error: any) {
                                           console.error('Failed to confirm attendance:', error);
                                           setError(error.message || 'Failed to confirm attendance');
                                         }
                                       }}
                                       className="px-2 py-1 bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 text-green-300 rounded text-xs transition-colors"
                                     >
                                       ✓ Confirm
                                     </button>
                                     <button
                                       onClick={() => {
                                         // Reject attendance
                                         setPendingAttendance(prev => prev.filter(p => p.id !== pending.id));
                                         console.log(`❌ Manual rejection: ${pending.personId}`);
                                       }}
                                       className="px-2 py-1 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-300 rounded text-xs transition-colors"
                                     >
                                       ✗ Reject
                                     </button>
                                   </div>
                                 </div>
                               </div>
                             );
                           })}
                         </div>
                       </div>
                     )}
  

  
                     {/* Recent Attendance */}
                     {recentAttendance.length > 0 && (
                       <div>
                         <h4 className="text-sm font-medium mb-2 text-white/80">Log:</h4>
                         <div className="space-y-1 max-h-40 overflow-y-auto">
                           {recentAttendance.slice(0, 10).map(record => {
                             const member = groupMembers.find(m => m.person_id === record.person_id);
                             return (
                               <div key={record.id} className="text-xs bg-white/[0.02] border border-white/[0.05] rounded p-2">
                                 <div className="flex justify-between items-center">
                                   <span className="font-medium">{member?.name || record.person_id}</span>
                                   <span className="text-white/50">
                                     {record.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                   </span>
                                 </div>
                                 <div className="flex justify-between items-center mt-1">
                                   <span className={`px-2 py-1 rounded text-xs ${
                                     record.type === 'check_in' ? 'bg-green-600/20 text-green-300' :
                                     record.type === 'check_out' ? 'bg-red-600/20 text-red-300' :
                                     record.type === 'break_start' ? 'bg-blue-600/20 text-blue-300' :
                                     'bg-purple-600/20 text-purple-300'
                                   }`}>
                                     {formatAttendanceType(record.type)}
                                   </span>
                                   <span className="text-white/40 text-xs">
                                     {(record.confidence * 100).toFixed(0)}%
                                   </span>
                                 </div>
                               </div>
                             );
                           })}
                         </div>
                       </div>
                     )}
  
                     {/* No data states */}
                     {attendanceGroups.length === 0 && (
                       <div className="text-white/50 text-sm text-center py-4">
                         No groups created yet. <br /> Click "Groups" to create one.
                       </div>
                     )}
  

                   </div>
                 </>
               ) : (
                 <>
                   <h3 className="text-lg font-light mb-4">Recent Logs</h3>
                   <div className="space-y-2 h-full overflow-y-auto recent-logs-scroll">
                     <div className="text-white/50 text-sm text-center py-4">
                       No logs yet
                     </div>
                   </div>
                 </>
               )}
             </div>
           </div>
  
         {/* Elite Face Registration Dialog */}
          {showRegistrationDialog && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-gray-800 p-6 rounded-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                <h3 className="text-xl font-bold mb-4 flex items-center space-x-2">
                  <span>🎯 Elite Face Registration</span>
                  {currentGroup && (
                    <span className="text-sm bg-blue-600/20 text-blue-300 px-2 py-1 rounded">
                      {getGroupTypeIcon(currentGroup.type)} {currentGroup.name}
                    </span>
                  )}
                </h3>
  
                {!currentGroup && (
                  <div className="mb-4 p-3 bg-yellow-600/20 border border-yellow-500/30 rounded text-yellow-300">
                    ⚠️ Please select an attendance group first to register faces.
                  </div>
                )}
  
                {currentGroup && (
                  <>
                    {/* Step 1: Select Member or Create New */}
                    <div className="mb-6">
                      <h4 className="text-lg font-medium mb-3">Step 1: Select Member</h4>
  
                      {/* Existing Members */}
                      {groupMembers.length > 0 && (
                        <div className="mb-4">
                          <label className="block text-sm font-medium mb-2">Existing Members:</label>
                          <div className="space-y-2 max-h-32 overflow-y-auto">
                            {groupMembers.map((member) => (
                              <div
                                key={member.person_id}
                                className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${
                                  selectedPersonForRegistration === member.person_id
                                    ? 'bg-blue-600/30 border border-blue-500/50'
                                    : 'bg-gray-700 hover:bg-gray-600'
                                }`}
                                onClick={() => setSelectedPersonForRegistration(member.person_id)}
                              >
                                <div>
                                  <span className="text-sm font-medium">{member.name}</span>
                                  {member.role && (
                                    <span className="text-xs text-blue-300 ml-2">{member.role}</span>
                                  )}
                                </div>
                                <div className="flex items-center space-x-2">
                                  {/* Face data status indicator */}
                                  <div className={`w-2 h-2 rounded-full ${
                                    registeredPersons.some(p => p.person_id === member.person_id)
                                      ? 'bg-green-500'
                                      : 'bg-red-500'
                                  }`} title={
                                    registeredPersons.some(p => p.person_id === member.person_id)
                                      ? 'Has face data'
                                      : 'No face data'
                                  }></div>
                                  {selectedPersonForRegistration === member.person_id && (
                                    <span className="text-xs text-blue-300">✓ Selected</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
  

                    </div>
  
                    {/* Step 2: Face Selection and Validation */}
                    {selectedPersonForRegistration && currentDetections?.faces && currentDetections.faces.length > 0 && (
                      <div className="mb-6">
                        <h4 className="text-lg font-medium mb-3">Step 2: Select & Validate Face</h4>
                        <div className="space-y-3">
                          {currentDetections.faces.map((face, index) => {
                            const isValidForRegistration = face.confidence > 0.8; // Backend handles anti-spoofing
  
                            return (
                              <div
                                key={index}
                                className={`p-3 rounded border transition-all ${
                                  isValidForRegistration
                                    ? 'bg-green-600/10 border-green-500/30 hover:bg-green-600/20'
                                    : 'bg-red-600/10 border-red-500/30'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <div>
                                    <div className="flex items-center space-x-2">
                                      <span className="font-medium">Face {index + 1}</span>
                                      <span className="text-sm text-white/60">
                                        Confidence: {(face.confidence * 100).toFixed(1)}%
                                      </span>
                                      {face.antispoofing && (
                                        <span className={`text-xs px-2 py-1 rounded ${
                                          face.antispoofing.status === 'real' ? 'bg-green-900 text-green-300' :
                                          'bg-red-900 text-red-300'
                                        }`}>
                                          {face.antispoofing.status === 'real' ? '✓ Live' : '⚠ Spoof'}
                                        </span>
                                      )}
                                    </div>
  
                                    {/* Quality Assessment */}
                                    <div className="text-xs text-white/60 mt-1">
                                      Quality: {face.confidence > 0.9 ? '🟢 Excellent' :
                                               face.confidence > 0.8 ? '🟡 Good' :
                                               face.confidence > 0.6 ? '🟠 Fair' : '🔴 Poor'}
                                      {!isValidForRegistration && (
                                        <span className="text-red-300 ml-2">
                                          Low quality (minimum 80% required)
                                        </span>
                                      )}
                                    </div>
                                  </div>
  
                                  <button
                                    onClick={() => handleEliteRegisterFace(index)}
                                    disabled={!isValidForRegistration}
                                    className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                                      isValidForRegistration
                                        ? 'bg-green-600 hover:bg-green-700 text-white'
                                        : 'bg-gray-600 text-gray-400 cursor-not-allowed'
                                    }`}
                                  >
                                    {isValidForRegistration ? '🎯 Register Elite' : '❌ Invalid'}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
  
                    {/* Step 3: Current Group Registrations */}
                    <div className="mb-6">
                      <h4 className="text-lg font-medium mb-3">Step 3: Group Registrations</h4>
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {groupMembers.length === 0 ? (
                          <div className="text-white/50 text-sm text-center py-4">
                            No members in this group yet.
                          </div>
                        ) : (
                          groupMembers.map((member) => {
                            const hasRegistration = registeredPersons.some(p => p.person_id === member.person_id);
                            return (
                              <div key={member.person_id} className="flex items-center justify-between p-2 bg-gray-700 rounded">
                                <div>
                                  <span className="text-sm font-medium">{member.name}</span>
                                  <span className="text-xs text-white/60 ml-2">({member.person_id})</span>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <div className={`w-2 h-2 rounded-full ${
                                    hasRegistration ? 'bg-green-500' : 'bg-red-500'
                                  }`}></div>
                                  <span className="text-xs">
                                    {hasRegistration ? 'Registered' : 'No Face Data'}
                                  </span>
                                  {hasRegistration && (
                                    <button
                                      onClick={() => handleRemoveGroupPersonFace(member.person_id)}
                                      className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-xs transition-colors"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </>
                )}
  
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowRegistrationDialog(false);
                      setSelectedPersonForRegistration('');
                    }}
                    className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded transition-colors"
                  >
                    Close
                  </button>

                </div>
              </div>
            </div>
          )}
  
          {/* Group Management Modal */}
          {showGroupManagement && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-gray-800 p-6 rounded-lg max-w-md w-full mx-4">
                <h3 className="text-xl font-bold mb-4">Group Management</h3>
  
                {/* Create New Group */}
                <div className="mb-6">
                  <h4 className="text-lg font-medium mb-3">Create New Group</h4>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium mb-2">Group Name:</label>
                      <input
                        type="text"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        placeholder="Enter group name"
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Group Type:</label>
                      <select
                        value={newGroupType}
                        onChange={(e) => setNewGroupType(e.target.value as GroupType)}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                      >
                        <option value="general">👥 General</option>
                        <option value="employee">👔 Employee</option>
                        <option value="student">🎓 Student</option>
                        <option value="visitor">👤 Visitor</option>
                      </select>
                    </div>
                    <button
                      onClick={handleCreateGroup}
                      disabled={!newGroupName.trim()}
                      className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded transition-colors"
                    >
                      Create Group
                    </button>
                  </div>
                </div>
  
                {/* Existing Groups */}
                {attendanceGroups.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-lg font-medium mb-3">Existing Groups</h4>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {attendanceGroups.map(group => (
                        <div key={group.id} className="flex items-center justify-between p-3 bg-gray-700 rounded">
                          <div>
                            <span className="font-medium">{getGroupTypeIcon(group.type)} {group.name}</span>
                            <div className="text-sm text-gray-400">
                              {group.type} • {attendanceManager.getGroupMembers(group.id).length} members
                            </div>
                          </div>
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleSelectGroup(group)}
                              className={`px-3 py-1 rounded text-sm transition-colors ${
                                currentGroup?.id === group.id
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-600 hover:bg-gray-500 text-gray-200'
                              }`}
                            >
                              {currentGroup?.id === group.id ? 'Active' : 'Select'}
                            </button>
                            <button
                              onClick={() => handleDeleteGroup(group)}
                              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm transition-colors"
                              title="Delete Group"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
  
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowGroupManagement(false)}
                    className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
  


  


          {/* Attendance Dashboard */}
          {showAttendanceDashboard && (
            <div className="fixed inset-0 z-50">
              <AttendanceDashboard onBack={() => setShowAttendanceDashboard(false)} />
            </div>
          )}
  
          {/* Settings Modal */}
          {showSettings && (
            <Settings onBack={() => setShowSettings(false)} isModal={true} />
          )}
  
          {/* Delete Group Confirmation Dialog */}
          {showDeleteConfirmation && groupToDelete && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-gray-800 p-6 rounded-lg max-w-md w-full mx-4">
                <h3 className="text-xl font-bold mb-4 text-red-400">⚠️ Delete Group</h3>
  
                <div className="mb-6">
                  <p className="text-white mb-4">
                    Are you sure you want to delete the group <strong>"{groupToDelete.name}"</strong>?
                  </p>
                  <div className="bg-red-900/20 border border-red-500/30 rounded p-3 mb-4">
                    <p className="text-red-300 text-sm">
                      <strong>Warning:</strong> This action cannot be undone. All group data, members, and attendance records will be permanently removed.
                    </p>
                  </div>
                  {currentGroup?.id === groupToDelete.id && (
                    <div className="bg-orange-900/20 border border-orange-500/30 rounded p-3">
                      <p className="text-orange-300 text-sm">
                        <strong>Note:</strong> This is your currently active group. Deleting it will clear your current selection.
                      </p>
                    </div>
                  )}
                </div>
  
                <div className="flex gap-3">
                  <button
                    onClick={cancelDeleteGroup}
                    className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmDeleteGroup}
                    className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 rounded transition-colors"
                  >
                    Delete Group
                  </button>
                </div>
              </div>
            </div>
          )}
</div>
      </div>
    </div>
  );
}