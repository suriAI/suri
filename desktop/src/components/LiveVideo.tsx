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
  const detectionIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const detectionEnabledRef = useRef<boolean>(false);
  const backendServiceRef = useRef<BackendService | null>(null);
  const isProcessingRef = useRef<boolean>(false);
  const isStreamingRef = useRef<boolean>(false);
  
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

  // Face recognition settings
  const [registeredPersons, setRegisteredPersons] = useState<PersonInfo[]>([]);

  const [newPersonId, setNewPersonId] = useState<string>('');
  const [selectedPersonForRegistration, setSelectedPersonForRegistration] = useState<string>('');
  const [showRegistrationDialog, setShowRegistrationDialog] = useState(false);
  const [currentRecognitionResults, setCurrentRecognitionResults] = useState<Map<number, FaceRecognitionResponse>>(new Map());

  // Performance tracking - throttled updates
  const detectionCounterRef = useRef({ detections: 0, lastTime: Date.now() });

  // Settings view state
  const [showSettings, setShowSettings] = useState(false);

  // Attendance system state
  const attendanceEnabled = true;
  const [currentGroup, setCurrentGroup] = useState<AttendanceGroup | null>(null);
  
  // Recognition is enabled when backend is ready and a group is selected
  const recognitionEnabled = backendServiceReady && currentGroup !== null;
  
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
  const [showMemberManagement, setShowMemberManagement] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<AttendanceGroup | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupType, setNewGroupType] = useState<GroupType>('general');
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('');
  const [newMemberEmployeeId, setNewMemberEmployeeId] = useState('');
  const [newMemberStudentId, setNewMemberStudentId] = useState('');
  const [selectedPersonForMember, setSelectedPersonForMember] = useState<string>('');
  const [memberAddMode, setMemberAddMode] = useState<'existing' | 'new'>('new');

  // Reset member form function
  const resetMemberForm = useCallback(() => {
    setSelectedPersonForMember('');
    setNewPersonId('');
    setNewMemberName('');
    setNewMemberRole('');
    setNewMemberEmployeeId('');
    setNewMemberStudentId('');
    setMemberAddMode('new');
  }, []);

  // Handle mode switching with form reset
  const handleMemberModeSwitch = useCallback((mode: 'existing' | 'new') => {
    setSelectedPersonForMember('');
    setNewPersonId('');
    setNewMemberName('');
    setNewMemberRole('');
    setNewMemberEmployeeId('');
    setNewMemberStudentId('');
    setMemberAddMode(mode);
  }, []);
  const [showAttendanceDashboard, setShowAttendanceDashboard] = useState(false);

  // Optimized capture frame with better error handling
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

    const ctx = canvas.getContext('2d');
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

      // OPTIMIZATION: Further reduced quality for better performance (was 0.6, now 0.4)
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
                    console.log(`🚫 Face ${index} filtered out: ${memberName} belongs to group ID ${member.group_id}, not current group "${currentGroup.name}" (ID: ${currentGroup.id})`);
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
              } catch (error) {
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

      if (process.env.NODE_ENV === 'development') {
        const recognizedCount = recognitionResults.filter(r => r?.result.person_id).length;
        if (recognizedCount > 0) {
          console.log(`🎯 Face recognition: ${recognizedCount}/${detectionResult.faces.length} faces recognized`);
        }
      }
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
          if (process.env.NODE_ENV === 'development') {
            console.log('🔍 Recognition check:', {
              recognitionEnabled,
              backendServiceReady,
              currentGroup: currentGroup?.name || 'null',
              facesDetected: detectionResult.faces.length
            });
          }
          
          if (recognitionEnabled && detectionResult.faces.length > 0) {
            performFaceRecognition(detectionResult);
          } else if (!recognitionEnabled && detectionResult.faces.length > 0) {
            // Store detection result for delayed recognition when recognition becomes enabled
            console.log('💾 Storing detection result for delayed recognition');
            setLastDetectionForRecognition(detectionResult);
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
    // OPTIMIZATION: Enhanced frame skipping logic
    if (isProcessingRef.current || 
        !backendServiceRef.current?.isWebSocketReady() || 
        !detectionEnabledRef.current ||
        !isStreamingRef.current) {
      if (process.env.NODE_ENV === 'development') {
        console.log('🔍 processCurrentFrame skipped:', {
          isProcessing: isProcessingRef.current,
          websocketReady: backendServiceRef.current?.isWebSocketReady(),
          detectionEnabled: detectionEnabledRef.current,
          isStreaming: isStreamingRef.current
        });
      }
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
      
      if (process.env.NODE_ENV === 'development') {
        console.log('📤 Sending detection request with frame data length:', frameData.length);
      }
      
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

  // Start detection interval helper
  const startDetectionInterval = useCallback(() => {
    if (detectionEnabledRef.current && 
        backendServiceRef.current?.isWebSocketReady() && 
        !detectionIntervalRef.current) {
      // OPTIMIZATION: Reduced frequency for better performance (was 100ms/10fps, now 150ms/6.7fps)
      detectionIntervalRef.current = setInterval(processFrameForDetection, 150);
      if (process.env.NODE_ENV === 'development') {
        console.log('🎯 Detection interval started at 6.7 FPS');
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
                console.log('✅ Video is ready with dimensions:', video.videoWidth, 'x', video.videoHeight);
                resolve();
              } else {
                setTimeout(checkVideoReady, 50); // Check every 50ms
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
    
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = undefined;
    }
    
    // Clear detection results
    setCurrentDetections(null);
    lastDetectionRef.current = null;
    
    // Reset FPS tracking
    setDetectionFps(0);
    detectionCounterRef.current = { detections: 0, lastTime: Date.now() };
    
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

  // Advanced futuristic drawing system
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
         label = (recognitionResult.memberName || recognitionResult.person_id).toUpperCase();
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

          const scaledLandmarkX = point.x * scaleX + offsetX;
          const scaledLandmarkY = point.y * scaleY + offsetY;

          if (!isFinite(scaledLandmarkX) || !isFinite(scaledLandmarkY) || 
              scaledLandmarkX < 0 || scaledLandmarkY < 0 ||
              scaledLandmarkX > displayWidth || scaledLandmarkY > displayHeight)
            continue;

          // OPTIMIZATION: Simplified landmark drawing
          ctx.beginPath();
          ctx.arc(scaledLandmarkX, scaledLandmarkY, 3, 0, 2 * Math.PI); // Reduced size
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      }

      // OPTIMIZATION: Simplified status indicator
      if (isRecognized) {
        ctx.font = 'bold 10px "Courier New", monospace';
        ctx.fillStyle = "#00ff00";
        ctx.fillText("RECOGNIZED", scaledX1 + 10, scaledY2 + 15);
      }

      // OPTIMIZATION: Removed animated border glow for better performance
      // The pulse effect was causing unnecessary redraws
    });
  }, [currentDetections, calculateScaleFactors, currentRecognitionResults, recognitionEnabled, isStreaming]);

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

    // OPTIMIZATION: Only redraw if detection results or recognition results changed
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
        landmarks,
        currentGroup?.id
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
      console.error('❌ Face recognition failed:', error);
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

  // Attendance Management Functions
  const loadAttendanceData = useCallback(async () => {
    try {
      const groups = await attendanceManager.getGroups();
      setAttendanceGroups(groups);
      
      if (currentGroup) {
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

  const handleAddMember = useCallback(async () => {
    if (!currentGroup) return;
    
    // Validation based on mode
    if (memberAddMode === 'existing') {
      if (!selectedPersonForMember || !newMemberName.trim()) return;
    } else {
      if (!newPersonId.trim() || !newMemberName.trim()) return;
    }
    
    try {
      const options: {
        role?: string;
        employee_id?: string;
        student_id?: string;
      } = {};
      
      if (newMemberRole.trim()) options.role = newMemberRole.trim();
      if (newMemberEmployeeId.trim()) options.employee_id = newMemberEmployeeId.trim();
      if (newMemberStudentId.trim()) options.student_id = newMemberStudentId.trim();
      
      // Use the appropriate person ID based on mode
      const personId = memberAddMode === 'existing' ? selectedPersonForMember : newPersonId.trim();
      
      await attendanceManager.addMember(
        personId,
        currentGroup.id,
        newMemberName.trim(),
        options
      );
      
      // Reset form
      resetMemberForm();
      setShowMemberManagement(false);
      
      await loadAttendanceData();
      console.log(`✅ ${memberAddMode === 'existing' ? 'Existing person added' : 'New person created and added'} successfully`);
    } catch (error) {
      console.error('❌ Failed to add member:', error);
      setError(`Failed to ${memberAddMode === 'existing' ? 'add existing person' : 'create new person'}`);
    }
  }, [memberAddMode, selectedPersonForMember, newPersonId, newMemberName, newMemberRole, newMemberEmployeeId, newMemberStudentId, currentGroup, loadAttendanceData, resetMemberForm]);

  const handleRemoveMember = useCallback(async (personId: string) => {
    try {
      await attendanceManager.removeMember(personId);
      await loadAttendanceData();
      console.log('✅ Member removed successfully');
    } catch (error) {
      console.error('❌ Failed to remove member:', error);
      setError('Failed to remove member');
    }
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
    let timeoutId: NodeJS.Timeout | undefined;
    
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
    if (currentGroup) {
      console.log(`🔄 Group switched to: ${currentGroup.name} - Clearing recognition state`);
      
      // Clear all recognition and tracking state to prevent data mixing
      setCurrentRecognitionResults(new Map());
      setTrackedFaces(new Map());
      setCurrentDetections(null);
      setSelectedTrackingTarget(null);
      
      // Stop detection if running
      if (isStreaming) {
        console.log(`🛑 Stopping detection due to group switch`);
        stopCamera();
      }
    }
  }, [currentGroup]);

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
          console.log('📝 Creating default group...');
          try {
            const defaultGroup = await attendanceManager.createGroup('Default Group', 'general', 'Auto-created default group');
            setCurrentGroup(defaultGroup);
            console.log('✅ Default group created and set as current:', defaultGroup);
          } catch (createError: any) {
            // If group already exists (409 error), just reload groups
            if (createError?.response?.status === 409) {
              console.log('ℹ️ Default group already exists, reloading groups...');
              const updatedGroups = await attendanceManager.getGroups();
              setAttendanceGroups(updatedGroups);
              if (updatedGroups.length > 0) {
                setCurrentGroup(updatedGroups[0]);
                console.log('📌 Selected existing group as current:', updatedGroups[0]);
              }
            } else {
              throw createError;
            }
          }
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
        <div className="sidebar w-80 my-3 bg-white/[0.02] border-l border-white/[0.08] flex flex-col max-h-full overflow-auto">
          {/* System Status */}
          <div className="px-4 pt-2 pb-4 border-b border-white/[0.08]">
            <div className="space-y-3">
                <div className="flex justify-end">
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
              
              {/* Attendance Status */}
              {attendanceEnabled && (
                <>
                  <div className="border-t border-white/[0.08] pt-3 mt-3">
                    {currentGroup && (
                      <>
                        <div className="flex justify-between items-center">
                          <span className="text-white/60">Current Group</span>
                          <span className="text-sm">{getGroupTypeIcon(currentGroup.type)} {currentGroup.name}</span>
                        </div>
                        {attendanceStats && (
                          <>
                            <div className="flex justify-between items-center">
                              <span className="text-white/60">Present Today</span>
                              <span className="font-mono text-green-400">{attendanceStats.present_today}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-white/60">Total Members</span>
                              <span className="font-mono">{attendanceStats.total_members}</span>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
              

            </div>
          </div>

          {/* Detection Settings */}
          <div className="px-4 py-4 border-b border-white/[0.08]">
            <h3 className="text-lg font-light mb-3">Detection Settings</h3>
            <div className="space-y-3">
              {/* Elite Tracking Mode */}
              <div className="flex items-center justify-between">
                <span className="text-white/60">Tracking Mode</span>
                <div className="flex space-x-1">
                  <button
                    onClick={() => setTrackingMode('auto')}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors duration-150 ${
                      trackingMode === 'auto'
                        ? 'bg-cyan-600 text-white'
                        : 'bg-white/[0.05] text-white/70 hover:bg-white/[0.08] border border-white/[0.1]'
                    }`}
                  >
                    Auto
                  </button>
                  <button
                    onClick={() => setTrackingMode('manual')}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors duration-150 ${
                      trackingMode === 'manual'
                        ? 'bg-orange-600 text-white'
                        : 'bg-white/[0.05] text-white/70 hover:bg-white/[0.08] border border-white/[0.1]'
                    }`}
                  >
                    Manual
                  </button>
                </div>
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
                                (recognitionResult.memberName || recognitionResult.person_id).toUpperCase() : 
                                `Face ${index + 1}`
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
                          {trackedFace && (
                            <div className="text-xs text-cyan-300 mt-1">
                              Quality: {trackedFace.angleConsistency > 0.8 ? 'Excellent' : 
                                       trackedFace.angleConsistency > 0.6 ? 'Good' : 
                                       trackedFace.angleConsistency > 0.4 ? 'Fair' : 'Poor'}
                            </div>
                          )}
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
                          
                          {/* Manual Tracking Controls */}
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
                   <h3 className="text-lg font-light">Attendance Management</h3>
                   <div className="flex space-x-2">
                     <button
                       onClick={() => setShowAttendanceDashboard(true)}
                       className="px-3 py-1 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 rounded text-xs transition-colors"
                     >
                       Dashboard
                     </button>
                     <button
                       onClick={() => setShowGroupManagement(true)}
                       className="px-3 py-1 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 rounded text-xs transition-colors"
                     >
                       Groups
                     </button>
                     {currentGroup && (
                       <button
                         onClick={() => setShowMemberManagement(true)}
                         className="px-3 py-1 bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 text-green-300 rounded text-xs transition-colors"
                       >
                         Members
                       </button>
                     )}
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
                         <option value="">Select a group...</option>
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

                   {/* Group Members */}
                   {currentGroup && groupMembers.length > 0 && (
                     <div>
                       <h4 className="text-sm font-medium mb-2 text-white/80">Members ({groupMembers.length}):</h4>
                       <div className="space-y-2 max-h-40 overflow-y-auto">
                         {groupMembers.map(member => {
                           const today = new Date().toISOString().split('T')[0];
                           const sessionKey = `${member.person_id}_${today}`;
                           const session = attendanceManager['sessions']?.get(sessionKey);
                           
                           return (
                             <div key={member.person_id} className="bg-white/[0.03] border border-white/[0.08] rounded p-2">
                               <div className="flex justify-between items-start">
                                 <div className="flex-1">
                                   <div className="font-medium text-sm">{member.name}</div>
                                   <div className="text-xs text-white/60">
                                     {member.role && `${member.role} • `}
                                     {member.employee_id && `ID: ${member.employee_id}`}
                                     {member.student_id && `Student: ${member.student_id}`}
                                   </div>
                                   {session && (
                                     <div className="text-xs mt-1">
                                       <span className={`px-2 py-1 rounded text-xs ${
                                         session.status === 'present' ? 'bg-green-600/20 text-green-300' :
                                         session.status === 'late' ? 'bg-yellow-600/20 text-yellow-300' :
                                         session.status === 'on_break' ? 'bg-blue-600/20 text-blue-300' :
                                         session.status === 'checked_out' ? 'bg-gray-600/20 text-gray-300' :
                                         'bg-red-600/20 text-red-300'
                                       }`}>
                                         {session.status === 'present' ? 'Present' :
                                          session.status === 'late' ? `Late (${session.late_minutes}m)` :
                                          session.status === 'on_break' ? 'On Break' :
                                          session.status === 'checked_out' ? 'Checked Out' :
                                          'Absent'}
                                       </span>
                                       {session.check_in && (
                                         <span className="ml-2 text-white/50">
                                           In: {session.check_in.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                         </span>
                                       )}
                                     </div>
                                   )}
                                 </div>
                                 <button
                                   onClick={() => handleRemoveMember(member.person_id)}
                                   className="text-red-400 hover:text-red-300 text-xs ml-2"
                                 >
                                   Remove
                                 </button>
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
                       <h4 className="text-sm font-medium mb-2 text-white/80">Recent Activity:</h4>
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
                       No groups created yet. Click "Groups" to create one.
                     </div>
                   )}
                   
                   {currentGroup && groupMembers.length === 0 && (
                     <div className="text-white/50 text-sm text-center py-4">
                       No members in this group. Click "Members" to add some.
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
                                <span className="text-xs text-white/60 ml-2">({member.person_id})</span>
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

                    {/* Create New Member */}
                    <div className="border-t border-gray-600 pt-4">
                      <label className="block text-sm font-medium mb-2">Or Create New Member:</label>
                      <div className="grid grid-cols-2 gap-3">
                        <input
                          type="text"
                          value={newPersonId}
                          onChange={(e) => setNewPersonId(e.target.value)}
                          placeholder="Person ID (e.g., john_doe)"
                          className="px-3 py-2 bg-gray-700 border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                        />
                        <input
                          type="text"
                          value={newMemberName}
                          onChange={(e) => setNewMemberName(e.target.value)}
                          placeholder="Full Name"
                          className="px-3 py-2 bg-gray-700 border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      {newPersonId.trim() && newMemberName.trim() && (
                        <button
                          onClick={async () => {
                            try {
                              await handleAddMember();
                              setSelectedPersonForRegistration(newPersonId);
                              setNewPersonId('');
                              setNewMemberName('');
                            } catch (error) {
                              console.error('Failed to add member:', error);
                            }
                          }}
                          className="mt-2 px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-sm transition-colors"
                        >
                          Add Member
                        </button>
                      )}
                    </div>
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
                    setNewPersonId('');
                    setSelectedPersonForRegistration('');
                  }}
                  className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded transition-colors"
                >
                  Close
                </button>
                {currentGroup && (
                  <button
                    onClick={() => setShowMemberManagement(true)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                  >
                    Manage Members
                  </button>
                )}
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

        {/* Member Management Modal */}
        {showMemberManagement && currentGroup && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 p-6 rounded-lg max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto">
              <h3 className="text-xl font-bold mb-4">Member Management</h3>
              <p className="text-gray-400 mb-4">Group: {getGroupTypeIcon(currentGroup.type)} {currentGroup.name}</p>
              
              {/* Add New Member */}
              <div className="mb-6">
                <h4 className="text-lg font-medium mb-3">Add New Member</h4>
                
                {/* Tab Selection */}
                <div className="flex mb-4 bg-gray-700 rounded-lg p-1">
                  <button
                    onClick={() => handleMemberModeSwitch('existing')}
                    className={`flex-1 px-3 py-2 rounded-md text-sm transition-colors ${
                      memberAddMode === 'existing' 
                        ? 'bg-blue-600 text-white' 
                        : 'text-gray-300 hover:text-white'
                    }`}
                  >
                    Add Existing Person
                  </button>
                  <button
                    onClick={() => handleMemberModeSwitch('new')}
                    className={`flex-1 px-3 py-2 rounded-md text-sm transition-colors ${
                      memberAddMode === 'new' 
                        ? 'bg-green-600 text-white' 
                        : 'text-gray-300 hover:text-white'
                    }`}
                  >
                    Create New Person
                  </button>
                </div>

                <div className="space-y-3">
                  {memberAddMode === 'existing' ? (
                    /* Add Existing Registered Person */
                    <>
                      <div>
                        <label className="block text-sm font-medium mb-2">Select Registered Person:</label>
                        <select
                          value={selectedPersonForMember}
                          onChange={(e) => setSelectedPersonForMember(e.target.value)}
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                        >
                          <option value="">Select a person...</option>
                          {registeredPersons
                            .filter(person => !groupMembers.some(member => member.person_id === person.person_id))
                            .map(person => (
                              <option key={person.person_id} value={person.person_id}>
                                {person.person_id}
                              </option>
                            ))}
                        </select>
                        {registeredPersons.filter(person => !groupMembers.some(member => member.person_id === person.person_id)).length === 0 && (
                          <p className="text-yellow-400 text-xs mt-1">
                            No registered persons available. Register faces first or create a new person.
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">Display Name:</label>
                        <input
                          type="text"
                          value={newMemberName}
                          onChange={(e) => setNewMemberName(e.target.value)}
                          placeholder="Enter display name"
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </>
                  ) : (
                    /* Create New Person */
                    <>
                      <div>
                        <label className="block text-sm font-medium mb-2">Person ID:</label>
                        <input
                          type="text"
                          value={newPersonId}
                          onChange={(e) => setNewPersonId(e.target.value)}
                          placeholder="e.g., john_doe, emp_001, student_123"
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                        />
                        <p className="text-gray-400 text-xs mt-1">
                          Unique identifier for this person (no spaces, use underscore)
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">Full Name:</label>
                        <input
                          type="text"
                          value={newMemberName}
                          onChange={(e) => setNewMemberName(e.target.value)}
                          placeholder="Enter full name"
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </>
                  )}
                  
                  {/* Common fields for both modes */}
                  <div>
                    <label className="block text-sm font-medium mb-2">Role (Optional):</label>
                    <input
                      type="text"
                      value={newMemberRole}
                      onChange={(e) => setNewMemberRole(e.target.value)}
                      placeholder="e.g., Teacher, Manager, Student"
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  {currentGroup.type === 'employee' && (
                    <div>
                      <label className="block text-sm font-medium mb-2">Employee ID:</label>
                      <input
                        type="text"
                        value={newMemberEmployeeId}
                        onChange={(e) => setNewMemberEmployeeId(e.target.value)}
                        placeholder="Enter employee ID"
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  )}
                  {currentGroup.type === 'student' && (
                    <div>
                      <label className="block text-sm font-medium mb-2">Student ID:</label>
                      <input
                        type="text"
                        value={newMemberStudentId}
                        onChange={(e) => setNewMemberStudentId(e.target.value)}
                        placeholder="Enter student ID"
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  )}
                  <button
                    onClick={handleAddMember}
                    disabled={
                      memberAddMode === 'existing' 
                        ? (!selectedPersonForMember || !newMemberName.trim())
                        : (!newPersonId.trim() || !newMemberName.trim())
                    }
                    className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded transition-colors"
                  >
                    {memberAddMode === 'existing' ? 'Add Existing Person' : 'Create & Add New Person'}
                  </button>
                  
                  {memberAddMode === 'new' && (
                    <div className="bg-blue-600/10 border border-blue-500/30 rounded-lg p-3">
                      <p className="text-blue-300 text-xs">
                        💡 <strong>Note:</strong> After creating this person, you can register their face using the "Register" button for automatic attendance tracking.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Current Members */}
              {groupMembers.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-lg font-medium mb-3">Current Members ({groupMembers.length})</h4>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {groupMembers.map(member => (
                      <div key={member.person_id} className="flex items-center justify-between p-3 bg-gray-700 rounded">
                        <div>
                          <div className="font-medium">{member.name}</div>
                          <div className="text-sm text-gray-400">
                            ID: {member.person_id}
                            {member.role && ` • ${member.role}`}
                            {member.employee_id && ` • Emp: ${member.employee_id}`}
                            {member.student_id && ` • Student: ${member.student_id}`}
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveMember(member.person_id)}
                          className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm transition-colors"
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
                    resetMemberForm();
                    setShowMemberManagement(false);
                  }}
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
  );
}