import { useState, useEffect, useRef, useCallback } from 'react';
import { BackendService } from '../../services/BackendService';
import { Settings, type QuickSettings } from '../settings';
import { attendanceManager } from '../../services/AttendanceManager';
import { Menu, type MenuSection } from '../menu';
import type { 
  FaceRecognitionResponse,
  AttendanceGroup,
  AttendanceMember,
  AttendanceRecord,
  GroupType
} from '../../types/recognition';
import { drawOverlays } from './utils/overlayRenderer';
import type { DetectionResult, DashboardTab, WebSocketFaceData, WebSocketDetectionResponse, WebSocketConnectionMessage, WebSocketErrorMessage, CooldownInfo, TrackedFace } from './types';
import { ControlBar } from './components/ControlBar';
import { VideoCanvas } from './components/VideoCanvas';
import { Sidebar } from './components/Sidebar';
import { GroupManagementModal } from './components/GroupManagementModal';
import { DeleteConfirmationModal } from './components/DeleteConfirmationModal';

const NON_LOGGING_ANTISPOOF_STATUSES = new Set<'real' | 'fake' | 'uncertain' | 'error' | 'insufficient_quality'>(['fake', 'uncertain', 'error', 'insufficient_quality']);

export default function Main() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const detectionEnabledRef = useRef<boolean>(false);
  const backendServiceRef = useRef<BackendService | null>(null);
  const isProcessingRef = useRef<boolean>(false);
  const isStreamingRef = useRef<boolean>(false);
  
  // Debounce refs to prevent rapid clicking issues
  const lastStartTimeRef = useRef<number>(0);
  const lastStopTimeRef = useRef<number>(0);
  const isStartingRef = useRef<boolean>(false);
  const isStoppingRef = useRef<boolean>(false);
  
  
  // Emergency recovery function to reset system to known good state
  const emergencyRecovery = useCallback(() => {
    // Reset all flags
    isStartingRef.current = false;
    isStoppingRef.current = false;
    isProcessingRef.current = false;
    
    // Reset timestamps
    lastStartTimeRef.current = 0;
    lastStopTimeRef.current = 0;
    
    // Force stop if streaming
    if (isStreamingRef.current) {
      setIsStreaming(false);
      isStreamingRef.current = false;
      setDetectionEnabled(false);
      detectionEnabledRef.current = false;
    }
    
    // Clear any pending operations
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }
    
    // Note: We preserve cooldowns even during emergency recovery
    // to maintain the cooldown behavior across all scenarios
  }, []);
  
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
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [currentDetections, setCurrentDetections] = useState<DetectionResult | null>(null);
  const [detectionFps, setDetectionFps] = useState<number>(0);
  const [websocketStatus, setWebsocketStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const backendServiceReadyRef = useRef(false);

  // Monitor video element to sync camera state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const checkVideoState = () => {
      const hasStream = video.srcObject !== null;
      const isPlaying = !video.paused && !video.ended && video.readyState > 2;
      const shouldBeActive = hasStream && isPlaying;
      
      if (cameraActive !== shouldBeActive) {
        setCameraActive(shouldBeActive);
        // Sync streaming state with actual camera state
        if (shouldBeActive && !isStreaming) {
          setIsStreaming(true);
          isStreamingRef.current = true;
        } else if (!shouldBeActive && isStreaming) {
          setIsStreaming(false);
          isStreamingRef.current = false;
        }
      }
    };

    // Check immediately
    checkVideoState();

    // Set up event listeners
    const events = ['loadedmetadata', 'play', 'pause', 'ended', 'emptied'];
    events.forEach(event => {
      video.addEventListener(event, checkVideoState);
    });

    // Also check periodically for state changes
    const interval = setInterval(checkVideoState, 100);

    return () => {
      events.forEach(event => {
        video.removeEventListener(event, checkVideoState);
      });
      clearInterval(interval);
    };
  }, [cameraActive, isStreaming]);
  
  const lastDetectionRef = useRef<DetectionResult | null>(null);
  const lastFrameTimestampRef = useRef<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('');
  
  // Anti-spoofing settings

  // Command hub state
  const [menuInitialSection, setMenuInitialSection] = useState<MenuSection>('overview');
  const [currentRecognitionResults, setCurrentRecognitionResults] = useState<Map<number, FaceRecognitionResponse>>(new Map());

  // ACCURATE FPS tracking with rolling average
  const fpsTrackingRef = useRef({
    timestamps: [] as number[],
    maxSamples: 5, // Track last 5 detections for real-time average
    lastUpdateTime: Date.now()
  });

  // Frame counter for skipping frames
  const frameCounterRef = useRef(0);

  // Settings view state
  const [showSettings, setShowSettings] = useState(false);
  const [quickSettings, setQuickSettings] = useState<QuickSettings>({
    cameraMirrored: true,
    showFPS: true,
    showPreprocessing: false,
    showBoundingBoxes: true,
    showAntiSpoofStatus: true,
    showRecognitionNames: true,
    showLandmarks: true,
  });

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
  const [trackedFaces, setTrackedFaces] = useState<Map<string, TrackedFace>>(new Map());
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
  const [persistentCooldowns, setPersistentCooldowns] = useState<Map<string, CooldownInfo>>(new Map());

  // Keep refs in sync with state
  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);
  
  useEffect(() => {
    detectionEnabledRef.current = detectionEnabled;
  }, [detectionEnabled]);

  // Periodic state validation to catch issues during long delays
  useEffect(() => {
    const validationInterval = setInterval(() => {
      // Only validate critical issues, not state mismatches
      const criticalIssues = [];
      
      if (isStartingRef.current && isStoppingRef.current) {
        criticalIssues.push('Both starting and stopping flags are true');
      }
      
      if (criticalIssues.length > 0) {
        // Auto-fix critical issues
        if (isStartingRef.current && isStoppingRef.current) {
          isStartingRef.current = false;
          isStoppingRef.current = false;
        }
      }
    }, 10000); // Check every 10 seconds
    
    return () => clearInterval(validationInterval);
  }, []);
  
  // Timeout detection for stuck operations
  useEffect(() => {
    let startTimeout: NodeJS.Timeout | undefined;
    let stopTimeout: NodeJS.Timeout | undefined;
    
    if (isStartingRef.current) {
      startTimeout = setTimeout(() => {
        if (isStartingRef.current) {
          emergencyRecovery();
        }
      }, 10000); // 10 second timeout for start
    }
    
    if (isStoppingRef.current) {
      stopTimeout = setTimeout(() => {
        if (isStoppingRef.current) {
          emergencyRecovery();
        }
      }, 5000); // 5 second timeout for stop
    }
    
    return () => {
      if (startTimeout) clearTimeout(startTimeout);
      if (stopTimeout) clearTimeout(stopTimeout);
    };
  }, [isStartingRef.current, isStoppingRef.current, emergencyRecovery]);

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


  const [showMenuPanel, setShowMenuPanel] = useState(false);

  const openMenuPanel = useCallback((section: DashboardTab) => {
    setMenuInitialSection(section);
    setShowMenuPanel(true);
  }, []);

  // OPTIMIZED: Capture frame as Binary ArrayBuffer (30% faster than Base64)
  const captureFrame = useCallback((): Promise<ArrayBuffer | null> => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas) {
      return Promise.resolve(null);
    }
    
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      return Promise.resolve(null);
    }

    // OPTIMIZATION: Get context with optimized settings
    const ctx = canvas.getContext('2d', { 
      alpha: false, // No transparency needed for capture
      willReadFrequently: false // We don't read pixels frequently
    });
    if (!ctx) {
      return Promise.resolve(null);
    }

    // OPTIMIZATION: Only resize canvas if video dimensions changed
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    return new Promise((resolve) => {
      try {
        // Draw current video frame
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Convert to Binary ArrayBuffer (30% faster than Base64, SaaS-ready!)
        canvas.toBlob((blob) => {
          if (!blob) {
            resolve(null);
            return;
          }
          blob.arrayBuffer().then(resolve).catch(() => {
            resolve(null);
          });
        }, 'image/jpeg', 0.95);
      } catch (error) {
        resolve(null);
      }
    });
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

      const frameData = await captureFrame();
      if (!frameData) {
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
          
          // CRITICAL: Liveness validation FIRST - Skip recognition for spoofed faces but still display them
          if (face.liveness?.status === 'fake') {
            // Don't return null - we want to show spoofed faces in the sidebar
            // Just skip the recognition processing
            return {
              face: face,
              skipRecognition: true,
              reason: 'spoofed'
            };
          }
          
          // Note: Simplified anti-spoofing status handling - only 'real', 'fake', 'error' are supported
          
          // Also reject faces with liveness errors for safety
          if (face.liveness?.status === 'error') {
            return null; // Filter out faces with anti-spoofing errors
          }
          
          // Use track_id as stable identifier (from SORT tracker)
          // Backend should always provide track_id after restart
          // Temporary fallback to index until backend is restarted with track_id support
          const trackId = face.track_id ?? index;
          
          // Convert bbox to array format [x, y, width, height]
          const bbox = [face.bbox.x, face.bbox.y, face.bbox.width, face.bbox.height];
          
          const response = await backendServiceRef.current.recognizeFace(
            frameData,
            bbox,
            currentGroupValue?.id,
            face.landmarks_5
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
                  return null; // Filter out this face completely
                }
              } catch {
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
              const currentLivenessStatus = face.liveness?.status;
              
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
                
                // CRITICAL FIX: Always use CURRENT frame's liveness status
                // Remove "once real, stay real" logic to prevent spoofed faces from staying "live"
                existingTrack.livenessStatus = currentLivenessStatus;
                
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
                  livenessStatus: currentLivenessStatus
                });
              }
              
              return newTracked;
            });
            
            // Enhanced Attendance Processing with comprehensive error handling
            if (attendanceEnabled && currentGroupValue && response.person_id) {
              const livenessStatus = face.liveness?.status ?? null;
              
              // CRITICAL SECURITY FIX: Double-check liveness status before attendance processing
              const shouldSkipAttendanceLogging = !!face.liveness && (
                face.liveness.is_real !== true ||
                (livenessStatus !== null && NON_LOGGING_ANTISPOOF_STATUSES.has(livenessStatus))
              );

              // Additional safety check: explicitly block spoofed faces
              if (face.liveness?.status && NON_LOGGING_ANTISPOOF_STATUSES.has(face.liveness.status)) {
                return null; // Skip attendance processing for spoofed/problematic faces
              }

              if (!shouldSkipAttendanceLogging) {
                try {
                  // Note: Group validation is now done at recognition level
                  // Backend handles all confidence thresholding - frontend processes all valid responses
                  const actualConfidence = response.similarity || 0;

                  // Anti-spoofing validation is handled by optimized backend

                  if (trackingMode === 'auto') {
                    // AUTO MODE: Check cooldown to prevent duplicate attendance logging
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
                    
                    // AUTO MODE: Process attendance event immediately
                    try {
                      const attendanceEvent = await attendanceManager.processAttendanceEvent(
                        response.person_id,
                        actualConfidence,
                        'LiveVideo Camera', // location
                        face.liveness?.status,
                        face.liveness?.confidence
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
                       setError(errorMessage || `Failed to record attendance for ${response.person_id}`);
                    }
                  }
                  // MANUAL MODE: Don't log automatically - user will click "Log" button on recognized faces

                } catch (error) {
                  console.error('❌ Attendance processing failed:', error);
                  setError(`Attendance error: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
              }
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
                livenessStatus: face.liveness?.status
              });
              return newTracked;
            });
          }
        } catch {
          // Silently continue
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
          // Handle spoofed faces that skip recognition
          if (result.skipRecognition) {
            // For spoofed faces, we still want to show them in the sidebar
            // but with no recognition result
            newRecognitionResults.set(result.face.track_id ?? -1, {
              success: false,
              person_id: undefined,
              similarity: 0,
              error: 'Spoofed face - recognition skipped'
            });
          } else if (result.result) {
            newRecognitionResults.set(result.trackId, result.result);
          }
        }
      });
      
      setCurrentRecognitionResults(newRecognitionResults);

      // Handle spoofed faces that skipped recognition but should still be displayed
      recognitionResults.forEach((result) => {
        if (result && result.skipRecognition) {
          const face = result.face;
          const faceId = `spoofed_track_${face.track_id}`;
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
              livenessStatus: face.liveness?.status
            });
            return newTracked;
          });
        }
      });

    } catch (error) {
      console.error('❌ Face recognition processing failed:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureFrame]);

  // Initialize WebSocket connection
  const initializeWebSocket = useCallback(async () => {
    try {
      // Prevent multiple simultaneous WebSocket initialization attempts
      if (websocketStatus === 'connecting') {
        return;
      }

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
        // CRITICAL: Ignore messages when not streaming to prevent data restoration
        if (!isStreamingRef.current || !detectionEnabledRef.current) {
          return;
        }
        
        // FRAME ORDERING: Check if this response is for the most recent frame
        const responseFrameTimestamp = data.frame_timestamp || 0;
        const lastFrameTimestamp = lastFrameTimestampRef.current || 0;
        
        // Skip outdated responses to prevent inconsistent results
        if (responseFrameTimestamp < lastFrameTimestamp) {
          return;
        }
        
        // Update last processed frame timestamp
        lastFrameTimestampRef.current = responseFrameTimestamp;
        
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
              const bbox = face.bbox || [0, 0, 0, 0];
              
              return {
                bbox: {
                  x: bbox[0] || 0,
                  y: bbox[1] || 0,
                  width: bbox[2] || 0,
                  height: bbox[3] || 0
                },
                confidence: face.confidence || 0,
                track_id: face.track_id,
                landmarks_5: face.landmarks_5, // Pass YuNet 5-point landmarks through
                liveness: face.liveness ? {
                  is_real: face.liveness.is_real ?? null,
                  confidence: face.liveness.confidence || 0,
                  live_score: face.liveness.live_score,
                  spoof_score: face.liveness.spoof_score,
                  status: face.liveness.status || 'error'
                } : undefined
              };
            }),
            model_used: data.model_used || 'unknown',
          };
          
          setCurrentDetections(detectionResult);
          lastDetectionRef.current = detectionResult;

          // 🚀 PERFORMANCE: No processing flag - continuous frame sending

          // Perform face recognition if enabled
          if (recognitionEnabled && backendServiceReadyRef.current && detectionResult.faces.length > 0) {
            // Perform face recognition asynchronously without blocking next frame processing
            performFaceRecognition(detectionResult).catch(error => {
              console.error('Face recognition failed:', error);
            });
          }

          // Trigger next frame for continuous processing (IPC continuous loop)
          if (detectionEnabledRef.current && isStreamingRef.current) {
            // Use requestAnimationFrame for smooth continuous processing
            requestAnimationFrame(() => processCurrentFrame());
          }
        } else {
          // No faces detected - continue processing
          
          // Trigger next frame for continuous processing (IPC continuous loop)
          if (detectionEnabledRef.current && isStreamingRef.current) {
            // Use requestAnimationFrame for smooth continuous processing
            requestAnimationFrame(() => processCurrentFrame());
          }
        }
      });

      // Handle connection messages
      backendServiceRef.current.onMessage('connection', (data: WebSocketConnectionMessage) => {
        // Set backend service as ready when connection is confirmed
        if (data.status === 'connected') {
          backendServiceReadyRef.current = true;
        }
      });

      // Handle error messages
      backendServiceRef.current.onMessage('error', (data: WebSocketErrorMessage) => {
        // CRITICAL: Ignore errors when not streaming to prevent state updates
        if (!isStreamingRef.current || !detectionEnabledRef.current) {
          return;
        }
        
        console.error('❌ WebSocket error message:', data);
        setError(`Detection error: ${data.message || 'Unknown error'}`);
        
        // Trigger next frame for continuous processing (IPC continuous loop)
        if (detectionEnabledRef.current && isStreamingRef.current) {
          // Use requestAnimationFrame for smooth continuous processing
          requestAnimationFrame(() => processCurrentFrame());
        }
      });

      // Note: Removed unused WebSocket event listeners (attendance_event, request_next_frame, pong)
      // Status will be managed by polling the actual WebSocket state
      
    } catch (error) {
      console.error('❌ WebSocket initialization failed:', error);
      // Don't show error for rapid clicking - it's expected behavior
      if (!isStartingRef.current) {
        setError('Failed to connect to real-time detection service');
      }
      backendServiceReadyRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recognitionEnabled, performFaceRecognition]);

  // Process current frame with frame skipping for better performance
  const processCurrentFrame = useCallback(async () => {
    if (!backendServiceRef.current?.isWebSocketReady() || 
        !detectionEnabledRef.current ||
        !isStreamingRef.current) {
      return;
    }

    // Increment frame counter
    frameCounterRef.current++;

    // Skip every 2nd frame
    if (frameCounterRef.current % 2 !== 0) {
      // Schedule next frame processing
      if (detectionEnabledRef.current && isStreamingRef.current) {
        requestAnimationFrame(() => processCurrentFrame());
      }
      return;
    }

    try {
      const frameData = await captureFrame();
      if (!frameData || !backendServiceRef.current) {
        return;
      }
      
      // Send frame to backend
      backendServiceRef.current.sendDetectionRequest(frameData).catch(error => {
        console.error('❌ WebSocket detection request failed:', error);
        
        // Continue processing on error
        if (detectionEnabledRef.current && isStreamingRef.current) {
          requestAnimationFrame(() => processCurrentFrame());
        }
      });
    } catch (error) {
      console.error('❌ Frame capture failed:', error);
      
      // Continue processing on error
      if (detectionEnabledRef.current && isStreamingRef.current) {
        requestAnimationFrame(() => processCurrentFrame());
      }
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
      // CRITICAL: Prevent rapid clicking and ensure only one start operation at a time
      const now = Date.now();
      const timeSinceLastStart = now - lastStartTimeRef.current;
      const timeSinceLastStop = now - lastStopTimeRef.current;
      
      // Prevent starting if already starting or recently started
      if (isStartingRef.current || isStreamingRef.current) {
        return;
      }
      
      // Prevent starting too quickly after stop (minimum 100ms gap)
      if (timeSinceLastStop < 100) {
        return;
      }
      
      // Prevent starting too quickly after last start (minimum 200ms gap)
      if (timeSinceLastStart < 200) {
        return;
      }
      
      isStartingRef.current = true;
      lastStartTimeRef.current = now;
      
      // IMMEDIATELY set streaming state for instant button response
      setIsStreaming(true);
      isStreamingRef.current = true;
      setIsVideoLoading(true);
      
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
            }).catch(() => {
              checkVideoReady();
            });
          });
        };

        await waitForVideoReady();
        
        // Video is ready, clear loading state and set camera active
        setIsVideoLoading(false);
        setCameraActive(true);
        
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
            
            return false;
          };
          
          const isBackendReady = await waitForBackendReady();
          
          if (!isBackendReady) {
            setError('Backend models are still loading. Please wait and try again.');
            
            // Still allow camera to start but don't enable detection
            setDetectionEnabled(false);
            return;
          }
                
          // Automatically start detection when camera starts
          setDetectionEnabled(true);
          detectionEnabledRef.current = true; // Set ref immediately for synchronous access
          
          if (websocketStatus === 'disconnected') {
            try {
              await initializeWebSocket();
              
              // CRITICAL: Set backend ready immediately since WebSocket is connected
              backendServiceReadyRef.current = true;
              
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
              // Don't show error for rapid clicking - it's expected behavior
              if (!isStartingRef.current) {
                setError('Failed to connect to detection service');
              }
            }
          } else if (websocketStatus === 'connected') {
            // WebSocket is already connected, set backend ready and start detection immediately
            backendServiceReadyRef.current = true;
            
            // CRITICAL: Ensure detection is enabled before starting
            setDetectionEnabled(true);
            detectionEnabledRef.current = true; // Set ref immediately for synchronous access
            
            // CRITICAL: Ensure streaming state is also properly set
            if (!isStreamingRef.current) {
              isStreamingRef.current = true;
            }
            
            // CRITICAL: Reset processing state to ensure clean start
            isProcessingRef.current = false;
            
            startDetectionInterval();
          }
        } catch (error) {
          console.error('❌ Failed to check backend readiness:', error);
          // Don't show error for rapid clicking - it's expected behavior
          if (!isStartingRef.current) {
            setError('Failed to check backend readiness');
          }
          setDetectionEnabled(false);
        }
        // If websocketStatus is 'connecting', the useEffect will handle starting detection when connected
        if (websocketStatus === 'connecting') {
          backendServiceReadyRef.current = true;
          
          // CRITICAL: Ensure detection is enabled for connecting state
          setDetectionEnabled(true);
          detectionEnabledRef.current = true; // Set ref immediately for synchronous access
          
          // CRITICAL: Ensure streaming state is also properly set
          if (!isStreamingRef.current) {
            isStreamingRef.current = true;
          }
          
          // CRITICAL: Reset processing state to ensure clean start
          isProcessingRef.current = false;
        }
      }
    } catch (err) {
      console.error('Error starting camera:', err);
      setError('Failed to start camera. Please check permissions.');
      
      // Reset streaming state on error
      setIsStreaming(false);
      isStreamingRef.current = false;
      setIsVideoLoading(false);
      setCameraActive(false);
    } finally {
      // CRITICAL: Always reset starting flag
      isStartingRef.current = false;
    }
  }, [selectedCamera, websocketStatus, initializeWebSocket, startDetectionInterval, getCameraDevices]);

  // Stop camera stream
  const stopCamera = useCallback(() => {
    // CRITICAL: Prevent rapid stopping and ensure only one stop operation at a time
    const now = Date.now();
    const timeSinceLastStop = now - lastStopTimeRef.current;
    
    // Prevent stopping if already stopping or not streaming
    if (isStoppingRef.current || !isStreamingRef.current) {
      return;
    }
    
    // Prevent stopping too quickly after last stop (minimum 100ms gap)
    if (timeSinceLastStop < 100) {
      return;
    }
    
    isStoppingRef.current = true;
    lastStopTimeRef.current = now;
    
    
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
    setIsStreaming(false);
    setIsVideoLoading(false);
    setCameraActive(false);
    
    // Reset processing state
    isProcessingRef.current = false;
    
    // CRITICAL: Reset backend ready state for proper restart
    backendServiceReadyRef.current = false;
    
    // Disconnect WebSocket
    if (backendServiceRef.current) {
      backendServiceRef.current.disconnect();
    }
    setWebsocketStatus('disconnected');
    
    // Reset all processing refs to ensure clean state
    lastFrameTimestampRef.current = 0;
    lastDetectionHashRef.current = '';
    
    // Clear all intervals and animation frames
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }
    
    // No longer using detectionIntervalRef for setInterval - adaptive processing instead
    
    // Clear all detection and recognition data
    setCurrentDetections(null);
    lastDetectionRef.current = null;
    
    // Clear recognition results
    setCurrentRecognitionResults(new Map());
    
    // Clear tracked faces
    setTrackedFaces(new Map());
    
    // PRESERVE cooldowns - don't clear them so they persist across stop/start cycles
    // This prevents duplicate detections when restarting quickly
    
    // Note: We keep persistentCooldowns, attendanceCooldowns, and cooldownTimestampsRef
    // so that recently detected people can't be detected again immediately after restart
    
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
    
    // CRITICAL: Always reset stopping flag
    isStoppingRef.current = false;
    
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

  // Drawing helpers moved to utils/overlayRenderer.ts

  // Wrapper for drawOverlays utility
  const handleDrawOverlays = useCallback(() => {
    drawOverlays({
      videoRef,
      overlayCanvasRef,
      currentDetections,
      isStreaming,
      currentRecognitionResults,
      recognitionEnabled,
      persistentCooldowns,
      attendanceCooldownSeconds,
      quickSettings,
      getVideoRect,
      calculateScaleFactors,
    });
  }, [currentDetections, isStreaming, currentRecognitionResults, recognitionEnabled, persistentCooldowns, attendanceCooldownSeconds, quickSettings, getVideoRect, calculateScaleFactors]);

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
      handleDrawOverlays();
      lastDetectionHashRef.current = currentHash;
    }

    if (isStreaming) {
      animationFrameRef.current = requestAnimationFrame(animate);
    }
  }, [isStreaming, handleDrawOverlays, currentDetections, currentRecognitionResults]);





  // Face recognition utility functions

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
        // Add a small delay to avoid race conditions during group switching
        setTimeout(() => {
          // Double-check that the group still doesn't exist before clearing
          attendanceManager.getGroups().then(latestGroups => {
            const stillMissing = !latestGroups.some(group => group.id === currentGroupValue.id);
            if (stillMissing) {
              setCurrentGroup(null);
              setGroupMembers([]);
              setRecentAttendance([]);
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
      
    } catch (error) {
      console.error('❌ Failed to load attendance data:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentGroup]);

  // Elite Registration Handler Functions
  



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



  // getGroupTypeIcon moved to utils/overlayRenderer.ts

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

  // Clear recognition state whenever group changes to prevent data mixing
  useEffect(() => {
    // Handle group changes (including switching to null when group is deleted)
    
    // Clear all recognition and tracking state to prevent data mixing
    setCurrentRecognitionResults(new Map());
    setTrackedFaces(new Map());
    setCurrentDetections(null);
    
    // Removed delayed recognition clearing for real-time performance
    
    // Stop detection if running (use ref for synchronous check)
    if (isStreamingRef.current) {
      stopCamera();
    }
    
  }, [currentGroup, stopCamera]);

  // Manual attendance logging function
  const handleManualLog = async (personId: string, _name: string, confidence: number) => {
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
      }
      setError(null);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Manual attendance logging failed:`, errorMessage);
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
    <div className="pt-11 pb-7 h-screen bg-black text-white flex flex-col overflow-hidden">

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
            <VideoCanvas
              videoRef={videoRef}
              canvasRef={canvasRef}
              overlayCanvasRef={overlayCanvasRef}
              quickSettings={quickSettings}
              detectionFps={detectionFps}
              isVideoLoading={isVideoLoading}
            />
          </div>

          {/* Controls Bar */}
          <ControlBar
            cameraDevices={cameraDevices}
            selectedCamera={selectedCamera}
            setSelectedCamera={setSelectedCamera}
            isStreaming={isStreaming}
            startCamera={startCamera}
            stopCamera={stopCamera}
          />
        </div>

        {/* Sidebar */}
        <Sidebar
          currentDetections={currentDetections}
          currentRecognitionResults={currentRecognitionResults}
          recognitionEnabled={recognitionEnabled}
          trackedFaces={trackedFaces}
          trackingMode={trackingMode}
          handleManualLog={handleManualLog}
          persistentCooldowns={persistentCooldowns}
          attendanceCooldownSeconds={attendanceCooldownSeconds}
              attendanceEnabled={attendanceEnabled}
              attendanceGroups={attendanceGroups}
              currentGroup={currentGroup}
              recentAttendance={recentAttendance}
              groupMembers={groupMembers}
              handleSelectGroup={handleSelectGroup}
              setShowGroupManagement={setShowGroupManagement}
          openMenuPanel={openMenuPanel}
          setShowSettings={setShowSettings}
            />
           </div>
  
          {/* Group Management Modal */}
      <GroupManagementModal
        showGroupManagement={showGroupManagement}
        setShowGroupManagement={setShowGroupManagement}
        attendanceGroups={attendanceGroups}
        currentGroup={currentGroup}
        newGroupName={newGroupName}
        setNewGroupName={setNewGroupName}
        newGroupType={newGroupType}
        setNewGroupType={setNewGroupType}
        handleCreateGroup={handleCreateGroup}
        handleSelectGroup={handleSelectGroup}
        handleDeleteGroup={handleDeleteGroup}
      />
  


  


          {/* Command Menu Panel */}
          {showMenuPanel && (
            <div className="fixed inset-0 z-50">
              <Menu
                onBack={() => setShowMenuPanel(false)}
                initialSection={menuInitialSection}
              />
            </div>
          )}
  
          {/* Settings Modal */}
          {showSettings && (
            <Settings 
              onBack={() => setShowSettings(false)} 
              isModal={true}
              quickSettings={quickSettings}
              onQuickSettingsChange={setQuickSettings}
              attendanceSettings={{
                trackingMode: trackingMode,
                lateThresholdEnabled: (currentGroup?.settings as any)?.late_threshold_enabled ?? true,
                lateThresholdMinutes: currentGroup?.settings?.late_threshold_minutes ?? 15,
                classStartTime: currentGroup?.settings?.class_start_time ?? '08:00',
              }}
              onAttendanceSettingsChange={async (updates) => {
                // Handle tracking mode change
                if (updates.trackingMode !== undefined) {
                  setTrackingMode(updates.trackingMode);
                }
                
                // Handle group settings changes
                if (currentGroup && (updates.lateThresholdEnabled !== undefined || updates.lateThresholdMinutes !== undefined || updates.classStartTime !== undefined)) {
                  const updatedSettings = {
                    ...currentGroup.settings,
                    ...(updates.lateThresholdEnabled !== undefined && { late_threshold_enabled: updates.lateThresholdEnabled }),
                    ...(updates.lateThresholdMinutes !== undefined && { late_threshold_minutes: updates.lateThresholdMinutes }),
                    ...(updates.classStartTime !== undefined && { class_start_time: updates.classStartTime }),
                  };
                  try {
                    await attendanceManager.updateGroup(currentGroup.id, { settings: updatedSettings });
                    setCurrentGroup({
                      ...currentGroup,
                      settings: updatedSettings,
                    });
                  } catch (error) {
                    console.error('Failed to update attendance settings:', error);
                  }
                }
              }}
              isStreaming={isStreaming}
            />
          )}
  
          {/* Delete Group Confirmation Dialog */}
      <DeleteConfirmationModal
        showDeleteConfirmation={showDeleteConfirmation}
        groupToDelete={groupToDelete}
        currentGroup={currentGroup}
        cancelDeleteGroup={cancelDeleteGroup}
        confirmDeleteGroup={confirmDeleteGroup}
      />
    </div>
  );
}