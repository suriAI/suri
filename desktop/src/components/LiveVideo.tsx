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
    track_id?: number; // SORT tracker ID for consistent face tracking
    landmarks: {
      right_eye: { x: number; y: number };
      left_eye: { x: number; y: number };
      nose_tip: { x: number; y: number };
      right_mouth_corner: { x: number; y: number };
      left_mouth_corner: { x: number; y: number };
    };
    landmarks_468?: Array<{ x: number; y: number }>; // FaceMesh 468 landmarks for visualization
    antispoofing?: {
      is_real: boolean | null;
      confidence: number;
      status: 'real' | 'fake' | 'error' | 'too_small' | 'background' | 'processing_failed' | 'invalid_bbox' | 'out_of_frame' | 'unknown';
      label?: string;
      message?: string;
    };
  }>;
  model_used: string;
  processing_time: number;
}

interface WebSocketFaceData {
  bbox?: number[];
  confidence?: number;
  track_id?: number; // SORT tracker ID for consistent face tracking
  landmarks?: number[][];
  landmarks_468?: number[][]; // FaceMesh 468 landmarks for frontend visualization
  antispoofing?: {
    is_real?: boolean | null;
    confidence?: number;
    status?: 'real' | 'fake' | 'error' | 'too_small' | 'background' | 'processing_failed' | 'invalid_bbox' | 'out_of_frame' | 'unknown';
    label?: string;
    message?: string;
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

const NON_LOGGING_ANTISPOOF_STATUSES = new Set<
  'real' | 'fake' | 'error' | 'too_small' | 'background' | 'processing_failed' | 'invalid_bbox' | 'out_of_frame' | 'unknown'
>(['fake', 'too_small', 'error', 'background', 'processing_failed', 'invalid_bbox', 'out_of_frame', 'unknown']);

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
    maxSamples: 5, // Track last 5 detections for real-time average
    lastUpdateTime: Date.now()
  });

  // Settings view state
  const [showSettings, setShowSettings] = useState(false);

  // Attendance system state
  const attendanceEnabled = true;
  const [currentGroup, setCurrentGroupInternal] = useState<AttendanceGroup | null>(null);
  const currentGroupRef = useRef<AttendanceGroup | null>(null);
  
  // Debug wrapper for setCurrentGroup with localStorage persistence
  const setCurrentGroup = useCallback((group: AttendanceGroup | null) => {
    setCurrentGroupInternal(group);
    currentGroupRef.current = group; // Keep ref in sync
    
    // Save group selection to localStorage for persistence
    if (group) {
      localStorage.setItem('suri_selected_group_id', group.id);
    } else {
      localStorage.removeItem('suri_selected_group_id');
    }
  }, []);
  
  // Recognition is enabled when backend is ready (removed group dependency for instant recognition)
  const recognitionEnabled = true;
  
  // Removed delayed recognition logic for real-time performance
  
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
    cooldownRemaining?: number;
    antispoofingStatus?: 'real' | 'fake' | 'error' | 'too_small' | 'background' | 'processing_failed' | 'invalid_bbox' | 'out_of_frame' | 'unknown';
  }>>(new Map());
  // Attendance states
  const [attendanceGroups, setAttendanceGroups] = useState<AttendanceGroup[]>([]);
  const [groupMembers, setGroupMembers] = useState<AttendanceMember[]>([]);
  const [recentAttendance, setRecentAttendance] = useState<AttendanceRecord[]>([]);
  const [showGroupManagement, setShowGroupManagement] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<AttendanceGroup | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupType, setNewGroupType] = useState<GroupType>('general');
  
  // Attendance cooldown tracking
  const [attendanceCooldowns, setAttendanceCooldowns] = useState<Map<string, number>>(new Map());
  const [attendanceCooldownSeconds] = useState(10); // 10 seconds cooldown
  
  // CRITICAL: Synchronous cooldown ref to prevent race conditions from async setState
  const cooldownTimestampsRef = useRef<Map<string, number>>(new Map());
  
  // Persistent cooldown tracking (for recognized faces)
  const [persistentCooldowns, setPersistentCooldowns] = useState<Map<string, {
    personId: string;
    startTime: number;
    memberName?: string;
    lastKnownBbox?: { x: number; y: number; width: number; height: number }; // For displaying cooldown when face disappears
  }>>(new Map());

  // Real-time countdown updater
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      
      // Update tracked faces with current cooldown remaining
      setTrackedFaces(prev => {
        const newTracked = new Map(prev);
        let hasChanges = false;
        
        for (const [trackId, track] of newTracked) {
          if (track.personId) {
            const lastAttendanceTime = attendanceCooldowns.get(track.personId);
            if (lastAttendanceTime) {
              const timeSinceLastAttendance = now - lastAttendanceTime;
              const cooldownMs = attendanceCooldownSeconds * 1000;
              
              if (timeSinceLastAttendance < cooldownMs) {
                const remainingCooldown = Math.ceil((cooldownMs - timeSinceLastAttendance) / 1000);
                if (track.cooldownRemaining !== remainingCooldown) {
                  newTracked.set(trackId, {
                    ...track,
                    cooldownRemaining: remainingCooldown
                  });
                  hasChanges = true;
                }
              } else if (track.cooldownRemaining !== undefined) {
                // Cooldown expired, remove it
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { cooldownRemaining: _, ...trackWithoutCooldown } = track;
                newTracked.set(trackId, trackWithoutCooldown);
                hasChanges = true;
              }
            }
          }
        }
        
        return hasChanges ? newTracked : prev;
      });
      
      // Update persistent cooldowns
      setPersistentCooldowns(prev => {
        const newPersistent = new Map(prev);
        let hasChanges = false;
        
        for (const [personId, cooldownInfo] of newPersistent) {
          const timeSinceStart = now - cooldownInfo.startTime;
          const cooldownMs = attendanceCooldownSeconds * 1000;
          
          if (timeSinceStart >= cooldownMs) {
            // Cooldown expired, remove it
            newPersistent.delete(personId);
            hasChanges = true;
          }
        }
        
        return hasChanges ? newPersistent : prev;
      });
      
      // Clean up expired cooldowns in both ref and state
      setAttendanceCooldowns(prev => {
        const newCooldowns = new Map(prev);
        let hasExpired = false;
        
        for (const [personId, timestamp] of newCooldowns) {
          const timeSinceLastAttendance = now - timestamp;
          const cooldownMs = attendanceCooldownSeconds * 1000;
          
          if (timeSinceLastAttendance >= cooldownMs) {
            newCooldowns.delete(personId);
            cooldownTimestampsRef.current.delete(personId); // Also clean from ref
            hasExpired = true;
          }
        }
        
        return hasExpired ? newCooldowns : prev;
      });
    }, 1000); // Update every second
    
    return () => clearInterval(interval);
  }, [attendanceCooldowns, attendanceCooldownSeconds, persistentCooldowns]);


  const [showAttendanceDashboard, setShowAttendanceDashboard] = useState(false);

  // OPTIMIZED: Capture frame with reduced canvas operations and better context settings
  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas) {
        console.warn('⚠️ captureFrame: Missing video or canvas element');
      return null;
    }
    
    if (video.videoWidth === 0 || video.videoHeight === 0) {
        console.warn('⚠️ captureFrame: Video dimensions not ready:', video.videoWidth, 'x', video.videoHeight);
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
      // Only perform recognition when a group is selected
      const currentGroupValue = currentGroupRef.current;
      if (!currentGroupValue) {
        setCurrentRecognitionResults(new Map());
        return;
      }

      const frameData = captureFrame();
      if (!frameData) {
        console.warn('⚠️ Failed to capture frame for face recognition');
        return;
      }

      // Capture current group at start of processing to validate later
      const processingGroup = currentGroupValue;
      

      // Process each detected face for recognition
      const recognitionPromises = detectionResult.faces.map(async (face, index) => {
        try {
          if (!backendServiceRef.current) {
            console.error('Backend service not initialized');
            return null;
          }
          
          // CRITICAL: Anti-spoofing validation FIRST - Reject spoofed faces BEFORE recognition
          if (face.antispoofing?.status === 'fake') {
            console.log(`🚫 Spoofed face detected and blocked (track ${face.track_id})`);
            return null; // Filter out spoofed faces completely - NO recognition for spoofed faces
          }
          
          // SECURITY FIX: Block "too_small" faces - prevents tilted/compressed spoof bypass
          if (face.antispoofing?.status === 'too_small') {
            console.log(`🚫 Face too small, blocking recognition (track ${face.track_id})`);
            return null; // Prevent recognition of compressed/tilted spoofed faces
          }
          
          // Also reject faces with anti-spoofing errors for safety
          if (face.antispoofing?.status === 'error') {
            console.log(`⚠️ Anti-spoofing error, blocking face (track ${face.track_id})`);
            return null; // Filter out faces with anti-spoofing errors
          }
          
          // Use track_id as stable identifier (from SORT tracker)
          // Backend should always provide track_id after restart
          // Temporary fallback to index until backend is restarted with track_id support
          const trackId = face.track_id ?? index;
          if (face.track_id === undefined) {
            console.warn(`⚠️ Backend not sending track_id! Face keys:`, Object.keys(face));
            console.warn(`Full face object:`, face);
          }
          
          // Convert bbox to array format [x, y, width, height]
          const bbox = [face.bbox.x, face.bbox.y, face.bbox.width, face.bbox.height];
          
          const response = await backendServiceRef.current.recognizeFace(
            frameData,
            bbox,
            currentGroupValue?.id
          );

          if (response.success && response.person_id) {
            
            // Group-based filtering: Only process faces that belong to the current group (by name)
            let memberName = response.person_id; // Default to person_id if no member found
            if (currentGroupValue) {
              try {
                const member = await attendanceManager.getMember(response.person_id);
                if (!member) {
                  return null; // Filter out this face completely
                }
                
                // Store the member's name for display
                memberName = member.name || response.person_id;
                
                // Compare group IDs directly for reliable filtering
                if (member.group_id !== currentGroupValue.id) {
                  // Get the member's group information for logging purposes
                  try {
                    await attendanceManager.getGroup(member.group_id);
                  } catch (groupError) {
                    console.warn(groupError)
                  }
                  return null; // Filter out this face completely
                }
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
            // Use track_id from SORT tracker as the stable identifier
            const trackedFaceId = `track_${face.track_id}`;
            const currentTime = Date.now();
            
            // Update tracking data
            setTrackedFaces(prev => {
              const newTracked = new Map(prev);
              const currentAntispoofingStatus = face.antispoofing?.status;
              
              // Find existing track using track_id (from SORT) for consistent identity
              const existingTrack = newTracked.get(trackedFaceId);
              
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
                
                // CRITICAL FIX: Always use CURRENT frame's anti-spoofing status
                // Remove "once real, stay real" logic to prevent spoofed faces from staying "live"
                existingTrack.antispoofingStatus = currentAntispoofingStatus;
                
                newTracked.set(existingTrack.id, existingTrack);
              } else {
                // Create new track using track_id as the key
                newTracked.set(trackedFaceId, {
                  id: trackedFaceId,
                  bbox: face.bbox,
                  confidence: face.confidence,
                  lastSeen: currentTime,
                  trackingHistory: [{ timestamp: currentTime, bbox: face.bbox, confidence: face.confidence }],
                  isLocked: trackingMode === 'auto',
                  personId: response.person_id,
                  occlusionCount: 0,
                  angleConsistency: 1.0,
                  antispoofingStatus: currentAntispoofingStatus
                });
              }
              
              return newTracked;
            });
            
            // Enhanced Attendance Processing with comprehensive error handling
            if (attendanceEnabled && currentGroupValue && response.person_id) {
              const antispoofStatus = face.antispoofing?.status ?? null;
              const shouldSkipAttendanceLogging = !!face.antispoofing && (
                face.antispoofing.is_real !== true ||
                (antispoofStatus !== null && NON_LOGGING_ANTISPOOF_STATUSES.has(antispoofStatus))
              );

              if (!shouldSkipAttendanceLogging) {
                // Check cooldown to prevent duplicate attendance logging
                // Use person_id as key so cooldown persists across track_id changes
                const currentTime = Date.now();
                const cooldownKey = response.person_id;
                const cooldownMs = attendanceCooldownSeconds * 1000;

                // CRITICAL: Use ref for synchronous check to avoid race conditions
                const lastAttendanceTime = cooldownTimestampsRef.current.get(cooldownKey) || 0;
                const timeSinceLastAttendance = currentTime - lastAttendanceTime;

                if (timeSinceLastAttendance < cooldownMs) {
                  const remainingCooldown = Math.ceil((cooldownMs - timeSinceLastAttendance) / 1000);

                  // Update lastKnownBbox in persistentCooldowns for display even when face disappears
                  setPersistentCooldowns(prev => {
                    const newPersistent = new Map(prev);
                    const existing = newPersistent.get(cooldownKey);
                    if (existing) {
                      newPersistent.set(cooldownKey, {
                        ...existing,
                        lastKnownBbox: face.bbox
                      });
                      return newPersistent;
                    }
                    return prev;
                  });

                  // Update the tracked face with cooldown info for overlay display using track_id
                  setTrackedFaces(prev => {
                    const newTracked = new Map(prev);
                    const trackKey = `track_${face.track_id}`;
                    if (newTracked.has(trackKey)) {
                      newTracked.set(trackKey, {
                        ...newTracked.get(trackKey)!,
                        cooldownRemaining: remainingCooldown
                      });
                    }
                    return newTracked;
                  });

                  // Use trackId instead of index for stable mapping
                  return { trackId, result: { ...response, name: memberName, memberName, cooldownRemaining: remainingCooldown } };
                }


                // CRITICAL FIX: Set cooldown SYNCHRONOUSLY in ref FIRST to block immediate subsequent frames
                // Then update state for visual display
                const logTime = Date.now();
                cooldownTimestampsRef.current.set(cooldownKey, logTime); // SYNC update - immediate effect!

                setAttendanceCooldowns(prev => {
                  const newCooldowns = new Map(prev);
                  newCooldowns.set(cooldownKey, logTime);
                  return newCooldowns;
                });

                // Add persistent cooldown for visual display using person_id as key
                setPersistentCooldowns(prev => {
                  const newPersistent = new Map(prev);
                  newPersistent.set(cooldownKey, {
                    personId: response.person_id!,
                    startTime: logTime,
                    memberName: memberName,
                    lastKnownBbox: face.bbox
                  });
                  return newPersistent;
                });

                try {
                  // Note: Group validation is now done at recognition level
                  // Backend handles all confidence thresholding - frontend processes all valid responses
                  const actualConfidence = response.similarity || 0;

                  // Anti-spoofing validation is handled by optimized backend

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

                      if (attendanceEvent) {

                        // Force immediate refresh of attendance data
                        // Use a small delay to ensure backend has committed the transaction
                        setTimeout(async () => {
                          await loadAttendanceData();
                        }, 100);
                      }

                      // Show success notification
                      setError(null);
                    } catch (attendanceError: unknown) {
                       const errorMessage = attendanceError instanceof Error ? attendanceError.message : 'Unknown error';
                       console.error(`❌ Attendance event processing failed for ${response.person_id}:`, errorMessage);
                       setError(errorMessage || `Failed to record attendance for ${response.person_id}`);
                    }
                  }
                  // MANUAL MODE: Don't log automatically - user will click "Log" button on recognized faces

                } catch (error) {
                  console.error('❌ Attendance processing failed:', error);
                  setError(`Attendance error: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
              } else if (antispoofStatus) {
                console.debug(
                  `ℹ️ Skipping attendance log for ${response.person_id} due to anti-spoof status: ${antispoofStatus}`
                );
              }
            } else {
              if (!attendanceEnabled) console.log(`ℹ️ Attendance is disabled`);
              if (!currentGroupValue) console.log(`ℹ️ No current group selected`);
              if (!response.person_id) console.log(`ℹ️ No person ID in response`);
            }
            
            // Store name in response for overlay display
            // Use trackId instead of index for stable mapping
            return { trackId, result: { ...response, name: memberName, memberName } };
          } else if (response.success) {
            
            // Track unrecognized faces for potential manual registration
            const faceId = `unknown_track_${face.track_id}`;
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
                angleConsistency: 1.0,
                antispoofingStatus: face.antispoofing?.status
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
      if (processingGroup?.id !== currentGroupRef.current?.id) {
        return;
      }
      
      // Update recognition results map - start fresh to avoid persisting old group results
      // Use trackId as key (not array index) to handle filtered faces correctly
      const newRecognitionResults = new Map<number, FaceRecognitionResponse>();
      recognitionResults.forEach((result) => {
        if (result) {
          newRecognitionResults.set(result.trackId, result.result);
        }
      });
      
      setCurrentRecognitionResults(newRecognitionResults);

    } catch (error) {
      console.error('❌ Face recognition processing failed:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureFrame]);

  // Initialize WebSocket connection
  const initializeWebSocket = useCallback(async () => {
    try {
      if (!backendServiceRef.current) {
        backendServiceRef.current = new BackendService();
      }

      // Check backend readiness before connecting WebSocket with retry logic
      
      const waitForBackendReady = async (maxAttempts = 5, baseDelay = 100) => {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          
          const readinessCheck = await window.electronAPI?.backend.checkReadiness();
          
          if (readinessCheck?.ready && readinessCheck?.modelsLoaded) {
            return true;
          }
          
          if (attempt < maxAttempts) {
            const delay = baseDelay * Math.pow(1.2, attempt - 1); // Faster exponential backoff for WebSocket
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
        
        // ACCURATE FPS calculation with rolling average
        const now = Date.now();
        const fpsTracking = fpsTrackingRef.current;
        
        // Add current timestamp
        fpsTracking.timestamps.push(now);
        
        // Keep only the last N samples for rolling average
        if (fpsTracking.timestamps.length > fpsTracking.maxSamples) {
          fpsTracking.timestamps.shift();
        }
        
        // Calculate FPS every 100ms for real-time updates
        if (now - fpsTracking.lastUpdateTime >= 100 && fpsTracking.timestamps.length >= 2) {
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
                track_id: face.track_id, // CRITICAL: Include track_id from SORT tracker
                landmarks: {
                  // Backend landmarks are in face perspective order: [right_eye, left_eye, nose_tip, right_mouth, left_mouth]
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
                landmarks_468: face.landmarks_468 ? face.landmarks_468.map(point => ({
                  x: point[0] || 0,
                  y: point[1] || 0
                })) : undefined,
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
          if (recognitionEnabled && backendServiceReadyRef.current && detectionResult.faces.length > 0) {
            // Perform face recognition asynchronously without blocking next frame processing
            performFaceRecognition(detectionResult).catch(error => {
              console.error('Face recognition failed:', error);
            });
          }
        } else {
          // No faces detected, reset processing flag - backend will request next frame
          isProcessingRef.current = false;
          // Backend controls the adaptive processing flow
        }
      });

      // Handle connection messages
      backendServiceRef.current.onMessage('connection', (data: WebSocketConnectionMessage) => {
        // Set backend service as ready when connection is confirmed
        if (data.status === 'connected') {
          setBackendServiceReady(true);
          backendServiceReadyRef.current = true;
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
      backendServiceRef.current.onMessage('pong', () => {
      });

      // Handle attendance event broadcasts
      backendServiceRef.current.onMessage('attendance_event', (data) => {
        const attendanceData = data.data as { 
          person_id: string; 
          group_id: string; 
          attendance_type: string;
          member_name: string;
          timestamp: string;
        } | undefined;
        
        if (attendanceData) {
          // Force immediate reload of attendance data to update sidebar
          // Use small delay to ensure backend transaction is committed
          setTimeout(() => {
            loadAttendanceData().catch(error => {
              console.error('Failed to reload attendance data:', error);
            });
          }, 150);
        }
      });

      // Handle next frame requests from adaptive backend
      backendServiceRef.current.onMessage('request_next_frame', () => {
        // Backend is ready for next frame - send it immediately
        if (detectionEnabledRef.current && backendServiceRef.current?.isWebSocketReady()) {
          processFrameForDetection();
        } else {
            console.warn('⚠️ Cannot process next frame:', {
              detectionEnabled: detectionEnabledRef.current,
              websocketReady: backendServiceRef.current?.isWebSocketReady()
            });
        }
      });

      // Status will be managed by polling the actual WebSocket state
      
    } catch (error) {
      console.error('❌ WebSocket initialization failed:', error);
      setError('Failed to connect to real-time detection service');
      setBackendServiceReady(false);
      backendServiceReadyRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          console.warn('⚠️ processCurrentFrame: No frame data or backend service');
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
          const waitForBackendReady = async (maxAttempts = 10, baseDelay = 200) => {
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {       
              const readinessCheck = await window.electronAPI?.backend.checkReadiness();
            
              if (readinessCheck?.ready && readinessCheck?.modelsLoaded) {
                return true;
              }
              
              if (attempt < maxAttempts) {
                const delay = baseDelay * Math.pow(1.3, attempt - 1); // Faster exponential backoff
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
  const getFaceColor = (
    recognitionResult: { person_id?: string; confidence?: number; name?: string } | null, 
    recognitionEnabled: boolean
  ) => {
    const isRecognized = recognitionEnabled && recognitionResult?.person_id;
    
    if (isRecognized) return "#00ff41"; // Green for recognized faces
    
    // All unknown/unrecognized faces should be red, regardless of antispoofing status
    return "#ff0000"; // Red for all unknown faces
  };

  // Helper function to draw modern bounding box with rounded corners
  const drawBoundingBox = (ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) => {
    const width = x2 - x1;
    const height = y2 - y1;
    const cornerRadius = 8; // Modern rounded corners
    
    ctx.beginPath();
    ctx.roundRect(x1, y1, width, height, cornerRadius);
    ctx.stroke();
    
    // Add subtle corner accents for modern look
    const accentLength = 20;
    const accentOffset = 4;
    
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    
    // Top-left corner accent
    ctx.beginPath();
    ctx.moveTo(x1 + accentOffset, y1 + accentLength);
    ctx.lineTo(x1 + accentOffset, y1 + accentOffset);
    ctx.lineTo(x1 + accentLength, y1 + accentOffset);
    ctx.stroke();
    
    // Top-right corner accent
    ctx.beginPath();
    ctx.moveTo(x2 - accentLength, y1 + accentOffset);
    ctx.lineTo(x2 - accentOffset, y1 + accentOffset);
    ctx.lineTo(x2 - accentOffset, y1 + accentLength);
    ctx.stroke();
    
    // Bottom-left corner accent
    ctx.beginPath();
    ctx.moveTo(x1 + accentOffset, y2 - accentLength);
    ctx.lineTo(x1 + accentOffset, y2 - accentOffset);
    ctx.lineTo(x1 + accentLength, y2 - accentOffset);
    ctx.stroke();
    
    // Bottom-right corner accent
    ctx.beginPath();
    ctx.moveTo(x2 - accentLength, y2 - accentOffset);
    ctx.lineTo(x2 - accentOffset, y2 - accentOffset);
    ctx.lineTo(x2 - accentOffset, y2 - accentLength);
    ctx.stroke();
  };

  // Helper function to setup canvas context with modern styling
  const setupCanvasContext = (ctx: CanvasRenderingContext2D, color: string) => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2; // Slightly thicker for modern look
    ctx.shadowColor = color;
    ctx.shadowBlur = 8; // Softer glow effect
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  // Helper function to draw facial landmarks (5-point YuNet landmarks)
  const drawLandmarks = (
    ctx: CanvasRenderingContext2D, 
    landmarks: {
      right_eye: { x: number; y: number };
      left_eye: { x: number; y: number };
      nose_tip: { x: number; y: number };
      right_mouth_corner: { x: number; y: number };
      left_mouth_corner: { x: number; y: number };
    },
    scaleX: number,
    scaleY: number,
    offsetX: number,
    offsetY: number
  ) => {
    // Use a single modern color that fits the theme
    const landmarkColor = '#00D4FF'; // Modern cyan that matches the UI theme

    // Draw each landmark point
    Object.entries(landmarks).forEach(([, point]) => {
      // Scale and position the landmark
      const x = point.x * scaleX + offsetX;
      const y = point.y * scaleY + offsetY;

      // Save context for landmark drawing
      ctx.save();
      
      // Set up modern styling for landmark
      ctx.fillStyle = landmarkColor;
      ctx.shadowColor = landmarkColor;
      ctx.shadowBlur = 4;

      // Draw landmark as a small circle
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.fill();

      ctx.restore();
    });
  };

  // Helper function to draw FaceMesh 468 landmarks
  const drawFaceMeshLandmarks = (
    ctx: CanvasRenderingContext2D,
    landmarks: Array<{ x: number; y: number }>,
    scaleX: number,
    scaleY: number,
    offsetX: number,
    offsetY: number
  ) => {
    // Use a more subtle color for the dense landmark mesh
    const landmarkColor = '#00D4FF'; // Modern cyan that matches the UI theme
    const landmarkSize = 1; // Smaller size for dense landmarks

    ctx.save();
    
    // Set up styling for FaceMesh landmarks
    ctx.fillStyle = landmarkColor;
    ctx.shadowColor = landmarkColor;
    ctx.shadowBlur = 2;

    // Draw each landmark point
    landmarks.forEach(point => {
      const x = point.x * scaleX + offsetX;
      const y = point.y * scaleY + offsetY;

      // Draw landmark as a small circle
      ctx.beginPath();
      ctx.arc(x, y, landmarkSize, 0, 2 * Math.PI);
      ctx.fill();
    });

    ctx.restore();
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
    currentDetections.faces.forEach((face) => {
      const { bbox, antispoofing } = face;
      
      // Validate bbox
      if (!bbox || !isFinite(bbox.x) || !isFinite(bbox.y) || !isFinite(bbox.width) || !isFinite(bbox.height)) return;

      // Calculate scaled coordinates
      const x1 = bbox.x * scaleX + offsetX;
      const y1 = bbox.y * scaleY + offsetY;
      const x2 = (bbox.x + bbox.width) * scaleX + offsetX;
      const y2 = (bbox.y + bbox.height) * scaleY + offsetY;

      // Validate scaled coordinates
      if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) return;

      // Look up recognition by track_id (from SORT)
      const trackId = face.track_id!; // Backend always provides track_id
      const recognitionResult = currentRecognitionResults.get(trackId);
      const color = getFaceColor(recognitionResult || null, recognitionEnabled);

      // Setup context and draw bounding box
      setupCanvasContext(ctx, color);
      drawBoundingBox(ctx, x1, y1, x2, y2);

      // Draw label
      const isRecognized = recognitionEnabled && recognitionResult?.person_id;
      let label = "Unknown";
      
      if (isRecognized && recognitionResult) {
        // Show name if available, fallback to person_id
        label = recognitionResult.name || recognitionResult.person_id || "Unknown"
      } else if (antispoofing?.status === 'fake') {
        label = "⚠ SPOOF";
      }

      ctx.font = 'bold 16px "Courier New", monospace';
      ctx.fillText(label, x1, y1 - 10);

      // Show modern logged indicator if person is in cooldown
      if (isRecognized && recognitionResult?.person_id) {
        // Use person_id as cooldown key (consistent with performFaceRecognition)
        const cooldownKey = recognitionResult.person_id;
        const cooldownInfo = persistentCooldowns.get(cooldownKey);
        if (cooldownInfo) {
          const currentTime = Date.now();
          const timeSinceStart = currentTime - cooldownInfo.startTime;
          const cooldownMs = attendanceCooldownSeconds * 1000;
          
          if (timeSinceStart < cooldownMs) {
            // Modern logged indicator in center of bounding box
            ctx.save();
            
            const centerX = (x1 + x2) / 2;
            const centerY = (y1 + y2) / 2;
            
            // Modern pill-shaped background with subtle transparency
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1;
            
            const pillWidth = 80;
            const pillHeight = 28;
            const pillRadius = 14;
            
            // Draw pill background
            ctx.beginPath();
            ctx.roundRect(centerX - pillWidth/2, centerY - pillHeight/2, pillWidth, pillHeight, pillRadius);
            ctx.fill();
            ctx.stroke();
            
            // Draw text with modern typography
            ctx.fillStyle = '#FFFFFF';
            ctx.font = '500 14px system-ui, -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Logged', centerX, centerY);
            
            ctx.restore();
          }
        }
      }

      // Status indicator
      if (isRecognized) {
        ctx.font = 'bold 10px "Courier New", monospace';
        ctx.fillStyle = "#00ff00";
        ctx.fillText("RECOGNIZED", x1 + 10, y2 + 15);
      }

      // Draw facial landmarks - prefer FaceMesh 468 landmarks for better visualization
      if (face.landmarks_468 && face.landmarks_468.length > 0) {
        drawFaceMeshLandmarks(ctx, face.landmarks_468, scaleX, scaleY, offsetX, offsetY);
      } else if (face.landmarks) {
        // Fallback to YuNet 5-point landmarks if FaceMesh not available
        drawLandmarks(ctx, face.landmarks, scaleX, scaleY, offsetX, offsetY);
      }

      // Reset context
      ctx.shadowBlur = 0;
    });

    // Cooldown for persons not currently detected is handled in sidebar only (no canvas drawing)
  }, [currentDetections, isStreaming, getVideoRect, calculateScaleFactors, currentRecognitionResults, recognitionEnabled, persistentCooldowns, attendanceCooldownSeconds]);

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
    
    if (currentHash !== lastDetectionHashRef.current) {
      drawOverlays();
      lastDetectionHashRef.current = currentHash;
    }

    if (isStreaming) {
      animationFrameRef.current = requestAnimationFrame(animate);
    }
  }, [isStreaming, drawOverlays, currentDetections, currentRecognitionResults]);





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

  // Attendance Management Functions
  const loadAttendanceData = useCallback(async () => {
    try {
      // Use ref to get the latest currentGroup value to avoid stale closure
      const currentGroupValue = currentGroupRef.current;
      
      // Always load groups list first
      const groups = await attendanceManager.getGroups();
      setAttendanceGroups(groups);
      
      // Early return if no current group - nothing more to load
      if (!currentGroupValue) {
        return;
      }
      
      // Validate that currentGroup still exists in the available groups
      const groupStillExists = groups.some(group => group.id === currentGroupValue.id);
      if (!groupStillExists) {
        // Only clear currentGroup if it was explicitly deleted, not during normal operations
        console.warn(`⚠️ Current group "${currentGroupValue.name}" no longer exists. This might be due to deletion.`);
        // Add a small delay to avoid race conditions during group switching
        setTimeout(() => {
          // Double-check that the group still doesn't exist before clearing
          attendanceManager.getGroups().then(latestGroups => {
            const stillMissing = !latestGroups.some(group => group.id === currentGroupValue.id);
            if (stillMissing) {
              console.warn(`⚠️ Confirmed: group "${currentGroupValue.name}" no longer exists. Clearing selection.`);
              setCurrentGroup(null);
              setGroupMembers([]);
              setRecentAttendance([]);
              setSelectedPersonForRegistration('');
            }
          });
        }, 100);
        return;
      }

      const [members, , records] = await Promise.all([
        attendanceManager.getGroupMembers(currentGroupValue.id),
        attendanceManager.getGroupStats(currentGroupValue.id),
        attendanceManager.getRecords({
          group_id: currentGroupValue.id,
          limit: 50
        })
      ]);
      
      setGroupMembers(members);
      setRecentAttendance(records);
      
      // Validate and clear selectedPersonForRegistration if they're no longer in the group
      if (selectedPersonForRegistration && !members.some(member => member.person_id === selectedPersonForRegistration)) {
        console.warn(`⚠️ Selected person "${selectedPersonForRegistration}" is no longer in group "${currentGroupValue.name}". Clearing selection.`);
        setSelectedPersonForRegistration('');
        setError(`Selected member "${selectedPersonForRegistration}" is no longer in the group. Please select a valid member.`);
      }
    } catch (error) {
      console.error('❌ Failed to load attendance data:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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


      // Convert bbox from object format to array format [x, y, width, height]
      const bbox = [face.bbox.x, face.bbox.y, face.bbox.width, face.bbox.height];

      const result = await attendanceManager.registerFaceForGroupPerson(
        currentGroup.id,
        selectedPersonForRegistration,
        frameData,
        bbox
      );

      if (result.success) {
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
  }, [currentDetections, selectedPersonForRegistration, currentGroup, loadRegisteredPersons, loadDatabaseStats, loadAttendanceData, groupMembers]);

  const handleRemoveGroupPersonFace = useCallback(async (personId: string) => {
    if (!currentGroup) return;

    try {
      const result = await attendanceManager.removeFaceDataForGroupPerson(currentGroup.id, personId);
      
      if (result.success) {
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
  const calculateAngleConsistency = useCallback((history: Array<{ timestamp: number; bbox: { x: number; y: number; width: number; height: number }; confidence: number }>) => {
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
      
    } catch (error) {
      console.error('❌ Failed to create group:', error);
      setError('Failed to create group');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newGroupName, newGroupType, currentGroup, loadAttendanceData]);

  const handleSelectGroup = useCallback(async (group: AttendanceGroup) => {
    setCurrentGroup(group);
    
    // Load data for the specific group to avoid race condition
    try {
      const [members, , records] = await Promise.all([
        attendanceManager.getGroupMembers(group.id),
        attendanceManager.getGroupStats(group.id),
        attendanceManager.getRecords({
          group_id: group.id,
          limit: 50
        })
      ]);
      
      setGroupMembers(members);
      setRecentAttendance(records);
      
      // Clear selected person for registration when switching groups
      setSelectedPersonForRegistration('');
    } catch (error) {
      console.error('❌ Failed to load data for selected group:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupToDelete, currentGroup, loadAttendanceData]);

  const cancelDeleteGroup = useCallback(() => {
    setShowDeleteConfirmation(false);
    setGroupToDelete(null);
  }, []);



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
          const delay = Math.min(50 * Math.pow(1.2, attempts), 500); // Faster exponential backoff, max 500ms
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
    
    // Clear all recognition and tracking state to prevent data mixing
    setCurrentRecognitionResults(new Map());
    setTrackedFaces(new Map());
    setCurrentDetections(null);
    
    // Removed delayed recognition clearing for real-time performance
    
    // Clear registered persons to force reload for new group context
    setRegisteredPersons([]);
    
    // Stop detection if running (use ref for synchronous check)
    if (isStreamingRef.current) {
      stopCamera();
    }
    
    // Reload registered persons for the new group context
    if (currentGroup && backendServiceRef.current) {
      loadRegisteredPersons();
    }
  }, [currentGroup, stopCamera, loadRegisteredPersons]);

  // Manual attendance logging function
  const handleManualLog = async (personId: string, name: string, confidence: number) => {
    try {
      // Call backend with manual log location
      const attendanceEvent = await attendanceManager.processAttendanceEvent(
        personId,
        confidence,
        'LiveVideo Camera - Manual Log'
      );

      if (attendanceEvent) {
        // Refresh attendance data
        setTimeout(async () => {
          await loadAttendanceData();
        }, 100);
        
        console.log(`✓ Manual attendance logged for ${name}`);
      }
      setError(null);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Manual attendance logging failed:`, errorMessage);
      setError(errorMessage || 'Failed to log attendance manually');
    }
  };

  // Keep ref in sync with state for async callbacks
  useEffect(() => {
    currentGroupRef.current = currentGroup;
  }, [currentGroup]);

  // Note: Removed useEffect that called loadAttendanceData on currentGroup change
  // to prevent circular dependency. Attendance data is now loaded directly in handleSelectGroup.

  // Initialize attendance system on component mount
  useEffect(() => {
    const initializeAttendance = async () => {
      try {
        // Load existing groups first
        const groups = await attendanceManager.getGroups();
        setAttendanceGroups(groups);
        
        if (groups.length === 0) {
          setCurrentGroup(null);
        } else if (!currentGroup) {
          // Try to restore the last selected group from localStorage
          const savedGroupId = localStorage.getItem('suri_selected_group_id');
          let groupToSelect = null;
          
          if (savedGroupId) {
            // Find the saved group in the available groups
            groupToSelect = groups.find(group => group.id === savedGroupId);
          }
          
          // If no saved group or saved group not found, select the first available group
          if (!groupToSelect) {
            groupToSelect = groups[0];
          }
          
          // Use handleSelectGroup to ensure data is loaded properly
          await handleSelectGroup(groupToSelect);
        }
      } catch (error) {
        console.error('Failed to initialize attendance system:', error);
        setError('Failed to initialize attendance system');
      }
    };

    initializeAttendance().catch(error => {
      console.error('Error in initializeAttendance:', error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleSelectGroup]); // Include handleSelectGroup dependency

  // Removed delayed recognition useEffect for real-time performance

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
<div className="sidebar h-screen max-h-screen flex flex-col overflow-hidden">
  
            {recognitionEnabled && (
              <div className="px-4 py-4 border-b border-white/[0.08] flex-shrink-0">
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
                </div>
              </div>
            )}
            
            
             {/* Face Detection Display - Half of remaining space */}
             <div className="flex-1 border-b border-white/[0.08] flex flex-col min-h-0">
               <div className="flex-1 overflow-y-auto space-y-2">
            {/* Active Cooldowns - Always visible */}
            {persistentCooldowns.size > 0 && (
              <div className="p-4 border-b border-white/[0.08] flex-shrink-0">
                <div className="text-xs font-medium text-white/60 mb-2">Active Cooldowns:</div>
                <div className="space-y-1">
                  {Array.from(persistentCooldowns.values()).map((cooldownInfo) => {
                    // Use Date.now() for accurate timing, currentTime for re-render trigger
                    const now = Date.now();
                    const timeSinceStart = now - cooldownInfo.startTime;
                    const cooldownMs = attendanceCooldownSeconds * 1000;
                    
                    // Only show if within cooldown period and time is positive
                    if (timeSinceStart >= 0 && timeSinceStart < cooldownMs) {
                      const remainingCooldown = Math.max(1, Math.ceil((cooldownMs - timeSinceStart) / 1000));
                      // Add currentTime to ensure re-renders (but don't use it in calculation)
                      // Current time ensures re-renders happen
                      
                      return (
                        <div key={cooldownInfo.personId} className="flex items-center justify-between bg-red-900/20 border border-red-500/30 rounded px-2 py-1">
                          <span className="text-xs text-red-300">{cooldownInfo.memberName || cooldownInfo.personId}</span>
                          <span className="text-xs text-red-300 font-mono">📝 {remainingCooldown}s</span>
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            )}
                {!currentDetections?.faces?.length ? (
                  <div className="text-white/50 text-sm text-center flex items-center justify-center h-full">
                    No faces detected
                  </div>
                ) : (
                  currentDetections.faces.map((face, index) => {
                    // Look up recognition by track_id (from SORT)
                    const trackId = face.track_id!; // Backend always provides track_id
                    const recognitionResult = currentRecognitionResults.get(trackId);
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
                                  (recognitionResult.name || recognitionResult.person_id) :
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
                                face.antispoofing.status === 'too_small' ? 'bg-blue-900 text-blue-300' :
                                'bg-yellow-900 text-yellow-300'
                              }`}>
                                {face.antispoofing.status === 'real' ? '✓ Live' :
                                 face.antispoofing.status === 'fake' ? '⚠ Spoof' :
                                 face.antispoofing.status === 'too_small' ? '📏 Move Closer' : '? Unknown'}
                              </div>
                            )}
                            {/* Manual Log Button */}
                            {trackingMode === 'manual' && isRecognized && recognitionResult?.person_id && (
                              <button
                                onClick={() => handleManualLog(
                                  recognitionResult.person_id!,
                                  recognitionResult.name || recognitionResult.person_id!,
                                  face.confidence
                                )}
                                className="mt-2 w-full px-3 py-1 bg-orange-600/20 hover:bg-orange-600/30 border border-orange-500/30 text-orange-300 rounded text-xs transition-colors font-medium"
                              >
                                📝 Log Attendance
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                 )}
               </div>
             </div>
  
             {/* Attendance Management or Recent Logs - Other half of remaining space */}
             <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
               {attendanceEnabled ? (
                 <div className="flex-1 flex flex-col overflow-hidden">
                   {/* Fixed Header Section - Active Group Selection */}
                   {attendanceGroups.length > 0 && (
                     <div className="p-4 pb-2 border-b border-white/[0.08] flex-shrink-0">
                       <label className="block text-sm font-medium mb-2 text-white/80">Active Group:</label>
                       <select
                         value={currentGroup?.id || ''}
                         onChange={(e) => {
                           if (e.target.value === 'create-new') {
                             setShowGroupManagement(true);
                             return;
                           }
                           const group = attendanceGroups.find(g => g.id === e.target.value);
                           if (group) handleSelectGroup(group);
                         }}
                         className="w-full bg-white/[0.05] text-white text-sm border border-white/[0.1] rounded px-3 py-2 focus:border-blue-500 focus:outline-none"
                       >
                         <option value="create-new" className="bg-black text-white">
                           ➕ Create New Group
                         </option>
                         <option disabled className="bg-black text-gray-500">
                         </option>
                         {attendanceGroups.map(group => (
                           <option key={group.id} value={group.id} className="bg-black text-white">
                             {getGroupTypeIcon(group.type)} {group.name}
                           </option>
                         ))}
                       </select>
                     </div>
                   )}
                   
                   {/* Scrollable Content Section */}
                   <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
                     {/* Recent Attendance */}
                     {recentAttendance.length > 0 && (
                       <div>
                         <h4 className="text-sm font-medium mb-2 text-white/80">Log:</h4>
                         <div className="space-y-1">
                           {recentAttendance.slice(0, 10).map(record => {
                             const member = groupMembers.find(m => m.person_id === record.person_id);
                             return (
                               <div key={record.id} className="text-xs bg-white/[0.02] border border-white/[0.05] rounded p-2">
                                 <div className="flex justify-between items-center">
                                   <div className="flex items-center space-x-2">
                                     <span className="font-medium">{member?.name || record.person_id}</span>
                                     <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                       record.is_manual 
                                         ? 'bg-orange-600/20 text-orange-300 border border-orange-500/30'
                                         : 'bg-cyan-600/20 text-cyan-300 border border-cyan-500/30'
                                     }`}>
                                       {record.is_manual ? 'Manual' : 'Auto'}
                                     </span>
                                   </div>
                                   <span className="text-white/50">
                                     {record.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                   </span>
                                 </div>
                                 <div className="flex justify-between items-center mt-1">
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
  
                   </div>
                   
                   {/* No data states - Outside scroll area */}
                   {attendanceGroups.length === 0 && (
                     <div className="p-4 text-white/50 text-sm text-center flex-shrink-0">
                       No groups created yet. <br /> Click "Create Group" to create one.

                       <button
                         onClick={() => setShowGroupManagement(true)}
                         className="mt-2 px-3 py-1 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 rounded text-xs transition-colors"
                       >
                         Create Group
                       </button>
                     </div>
                   )}
                 </div>
               ) : (
                 <div className="flex-1 flex flex-col overflow-hidden">
                   <h3 className="text-lg font-light px-4 pt-4 pb-2 flex-shrink-0">Recent Logs</h3>
                   <div className="flex-1 px-4 pb-4 overflow-y-auto space-y-2 min-h-0">
                     <div className="text-white/50 text-sm text-center py-4">
                       No logs yet
                     </div>
                   </div>
                 </div>
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
                              {group.type} • Members
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