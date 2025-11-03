import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useDeferredValue,
  startTransition,
} from "react";
import { BackendService } from "../../services/BackendService";
import { Settings, type QuickSettings } from "../settings";
import { attendanceManager } from "../../services/AttendanceManager";
import type { GroupSection } from "../group";
import type {
  FaceRecognitionResponse,
  AttendanceGroup,
  AttendanceMember,
  AttendanceRecord,
} from "../../types/recognition";
import { drawOverlays } from "./utils/overlayRenderer";
import type {
  DetectionResult,
  WebSocketFaceData,
  WebSocketDetectionResponse,
  WebSocketConnectionMessage,
  WebSocketErrorMessage,
  CooldownInfo,
  TrackedFace,
} from "./types";
import { ControlBar } from "./components/ControlBar";
import { VideoCanvas } from "./components/VideoCanvas";
import { Sidebar } from "./components/Sidebar";
import { GroupManagementModal } from "./components/GroupManagementModal";
import { DeleteConfirmationModal } from "./components/DeleteConfirmationModal";

const NON_LOGGING_ANTISPOOF_STATUSES = new Set<
  "real" | "fake" | "uncertain" | "error" | "too_small"
>(["fake", "uncertain", "error", "too_small"]);

const TRACKING_HISTORY_LIMIT = 20;

let skipFrames = 0;
let frameCounter = 0;

// Extended recognition response with additional UI properties
export interface ExtendedFaceRecognitionResponse
  extends FaceRecognitionResponse {
  memberName?: string;
}

const trimTrackingHistory = <T,>(history: T[]): T[] => {
  if (history.length <= TRACKING_HISTORY_LIMIT) {
    return history;
  }
  return history.slice(history.length - TRACKING_HISTORY_LIMIT);
};

const isRecognitionResponseEqual = (
  a: ExtendedFaceRecognitionResponse | undefined,
  b: ExtendedFaceRecognitionResponse | undefined,
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;

  return (
    a.success === b.success &&
    a.person_id === b.person_id &&
    a.name === b.name &&
    a.similarity === b.similarity &&
    a.error === b.error &&
    a.memberName === b.memberName
  );
};

const areRecognitionMapsEqual = (
  prev: Map<number, ExtendedFaceRecognitionResponse>,
  next: Map<number, ExtendedFaceRecognitionResponse>,
): boolean => {
  if (prev === next) return true;
  if (prev.size !== next.size) return false;

  for (const [key, nextValue] of next) {
    const prevValue = prev.get(key);
    if (!isRecognitionResponseEqual(prevValue, nextValue)) {
      return false;
    }
  }

  return true;
};

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
  const lastDetectionFrameRef = useRef<ArrayBuffer | null>(null);

  // Debounce refs
  const lastStartTimeRef = useRef<number>(0);
  const lastStopTimeRef = useRef<number>(0);
  const isStartingRef = useRef<boolean>(false);
  const isStoppingRef = useRef<boolean>(false);

  // Emergency recovery
  const emergencyRecovery = useCallback(() => {
    isStartingRef.current = false;
    isStoppingRef.current = false;
    isProcessingRef.current = false;
    lastStartTimeRef.current = 0;
    lastStopTimeRef.current = 0;
    if (isStreamingRef.current) {
      setIsStreaming(false);
      isStreamingRef.current = false;
      setDetectionEnabled(false);
      detectionEnabledRef.current = false;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }
  }, []);

  // Performance refs
  const lastCanvasSizeRef = useRef<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const lastVideoSizeRef = useRef<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const scaleFactorsRef = useRef<{
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
  }>({ scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 });
  const lastDetectionHashRef = useRef<string>("");

  // Cache video rect
  const videoRectRef = useRef<DOMRect | null>(null);
  const lastVideoRectUpdateRef = useRef<number>(0);

  const [isStreaming, setIsStreaming] = useState(false);
  const [detectionEnabled, setDetectionEnabled] = useState(false);
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [currentDetections, setCurrentDetections] =
    useState<DetectionResult | null>(null);
  const [detectionFps, setDetectionFps] = useState<number>(0);
  const [websocketStatus, setWebsocketStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const backendServiceReadyRef = useRef(false);

  // Sync camera state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const checkVideoState = () => {
      const hasStream = video.srcObject !== null;
      const isPlaying = !video.paused && !video.ended && video.readyState > 2;
      const shouldBeActive = hasStream && isPlaying;

      if (cameraActive !== shouldBeActive) {
        setCameraActive(shouldBeActive);
        if (shouldBeActive && !isStreaming) {
          setIsStreaming(true);
          isStreamingRef.current = true;
        } else if (!shouldBeActive && isStreaming) {
          setIsStreaming(false);
          isStreamingRef.current = false;
        }
      }
    };

    checkVideoState();
    const events = ["loadedmetadata", "play", "pause", "ended", "emptied"];
    events.forEach((event) => {
      video.addEventListener(event, checkVideoState);
    });
    const interval = setInterval(checkVideoState, 100);

    return () => {
      events.forEach((event) => {
        video.removeEventListener(event, checkVideoState);
      });
      clearInterval(interval);
    };
  }, [cameraActive, isStreaming]);

  const lastDetectionRef = useRef<DetectionResult | null>(null);
  const lastFrameTimestampRef = useRef<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>("");

  // Anti-spoofing settings
  const [currentRecognitionResults, setCurrentRecognitionResults] = useState<
    Map<number, ExtendedFaceRecognitionResponse>
  >(new Map());

  // FPS tracking
  const fpsTrackingRef = useRef({
    timestamps: [] as number[],
    maxSamples: 5,
    lastUpdateTime: Date.now(),
  });

  const [showSettings, setShowSettings] = useState(false);
  const [isSettingsFullScreen, setIsSettingsFullScreen] = useState(false);
  const [groupInitialSection, setGroupInitialSection] = useState<
    GroupSection | undefined
  >(undefined);
  const [quickSettings, setQuickSettings] = useState<QuickSettings>({
    cameraMirrored: true,
    showFPS: false,
    showPreprocessing: false,
    showBoundingBoxes: true,
    showRecognitionNames: true,
    showLandmarks: true,
  });

  // Attendance state
  const attendanceEnabled = true;
  const [currentGroup, setCurrentGroupInternal] =
    useState<AttendanceGroup | null>(null);
  const currentGroupRef = useRef<AttendanceGroup | null>(null);
  const memberCacheRef = useRef<Map<string, AttendanceMember | null>>(
    new Map(),
  );

  // Set current group with persistence
  const setCurrentGroup = useCallback((group: AttendanceGroup | null) => {
    setCurrentGroupInternal(group);
    currentGroupRef.current = group;
    memberCacheRef.current.clear();
    if (group) {
      localStorage.setItem("suri_selected_group_id", group.id);
    } else {
      localStorage.removeItem("suri_selected_group_id");
    }
  }, []);

  const recognitionEnabled = true;

  // Tracking system
  const [trackingMode, setTrackingMode] = useState<"auto" | "manual">("auto");
  const [attendanceCooldownSeconds, setAttendanceCooldownSeconds] =
    useState<number>(10);
  const [enableSpoofDetection, setEnableSpoofDetection] = useState<boolean>(
    () => {
      const saved = localStorage.getItem("suri_enable_spoof_detection");
      return saved !== null ? saved === "true" : true; // Default to enabled
    },
  );
  const [trackedFaces, setTrackedFaces] = useState<Map<string, TrackedFace>>(
    new Map(),
  );
  // Attendance data
  const [attendanceGroups, setAttendanceGroups] = useState<AttendanceGroup[]>(
    [],
  );
  const [groupMembers, setGroupMembers] = useState<AttendanceMember[]>([]);
  const [recentAttendance, setRecentAttendance] = useState<AttendanceRecord[]>(
    [],
  );
  const [showGroupManagement, setShowGroupManagement] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<AttendanceGroup | null>(
    null,
  );
  const [newGroupName, setNewGroupName] = useState("");

  // Cooldown tracking
  const [persistentCooldowns, setPersistentCooldowns] = useState<
    Map<string, CooldownInfo>
  >(new Map());
  const persistentCooldownsRef = useRef<Map<string, CooldownInfo>>(new Map());
  const deferredCurrentRecognitionResults = useDeferredValue(
    currentRecognitionResults,
  );

  useEffect(() => {
    persistentCooldownsRef.current = persistentCooldowns;
  }, [persistentCooldowns]);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    detectionEnabledRef.current = detectionEnabled;
  }, [detectionEnabled]);

  // Update spoof detection setting
  useEffect(() => {
    if (backendServiceRef.current) {
      backendServiceRef.current.setLivenessDetection(enableSpoofDetection);
    }
  }, [enableSpoofDetection]);

  // State validation
  useEffect(() => {
    const validationInterval = setInterval(() => {
      if (isStartingRef.current && isStoppingRef.current) {
          isStartingRef.current = false;
          isStoppingRef.current = false;
        }
    }, 10000);

    return () => clearInterval(validationInterval);
  }, []);

  // Timeout detection
  useEffect(() => {
    let startTimeout: NodeJS.Timeout | undefined;
    let stopTimeout: NodeJS.Timeout | undefined;

    if (isStartingRef.current) {
      startTimeout = setTimeout(() => {
        if (isStartingRef.current) {
          emergencyRecovery();
        }
      }, 10000);
    }

    if (isStoppingRef.current) {
      stopTimeout = setTimeout(() => {
        if (isStoppingRef.current) {
          emergencyRecovery();
        }
      }, 5000);
    }

    return () => {
      if (startTimeout) clearTimeout(startTimeout);
      if (stopTimeout) clearTimeout(stopTimeout);
    };
  }, [emergencyRecovery]);

  // Cooldown countdown updater
  useEffect(() => {
    let lastUpdateTime = 0;
    const updateInterval = 1000;

    const updateCooldowns = () => {
      const now = Date.now();
      startTransition(() => {
        setPersistentCooldowns((prev) => {
          const newPersistent = new Map(prev);
          let hasChanges = false;

          for (const [personId, cooldownInfo] of newPersistent) {
            const timeSinceStart = now - cooldownInfo.startTime;
            const cooldownSeconds =
              cooldownInfo.cooldownDurationSeconds ?? attendanceCooldownSeconds;
            const cooldownMs = cooldownSeconds * 1000;
            const expirationThreshold = cooldownMs + 500;

            if (timeSinceStart >= expirationThreshold) {
              newPersistent.delete(personId);
              hasChanges = true;
            }
          }

          persistentCooldownsRef.current = hasChanges ? newPersistent : prev;
          return hasChanges ? newPersistent : prev;
        });
      });
    };

    const scheduleUpdate = () => {
      const now = Date.now();
      if (now - lastUpdateTime >= updateInterval) {
        updateCooldowns();
        lastUpdateTime = now;
      }
      requestAnimationFrame(scheduleUpdate);
    };

    const rafId = requestAnimationFrame(scheduleUpdate);

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [attendanceCooldownSeconds]);

  // Capture frame as ArrayBuffer
  const captureFrame = useCallback((): Promise<ArrayBuffer | null> => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) {
      return Promise.resolve(null);
    }

    if (video.videoWidth === 0 || video.videoHeight === 0) {
      return Promise.resolve(null);
    }

    const ctx = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: false,
    });
    if (!ctx) {
      return Promise.resolve(null);
    }

    if (
      canvas.width !== video.videoWidth ||
      canvas.height !== video.videoHeight
    ) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    return new Promise((resolve) => {
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(null);
              return;
            }
            blob
              .arrayBuffer()
              .then(resolve)
              .catch(() => {
                resolve(null);
              });
          },
          "image/jpeg",
          0.9,
        );
      } catch {
        resolve(null);
      }
    });
  }, []);

  // Face recognition
  const performFaceRecognition = useCallback(
    async (detectionResult: DetectionResult, frameData: ArrayBuffer | null) => {
      try {
        const currentGroupValue = currentGroupRef.current;
        if (!currentGroupValue) {
          setCurrentRecognitionResults(new Map());
          return;
        }

        if (!frameData) {
          return;
        }

        const processingGroup = currentGroupValue;

        const recognitionPromises = detectionResult.faces.map(async (face) => {
          try {
            if (!backendServiceRef.current) {
              console.error("Backend service not initialized");
              return null;
            }

            if (face.track_id === undefined) {
              return null;
            }
            const trackId = face.track_id;

            if (face.liveness?.status === "fake") {
              return {
                face: face,
                skipRecognition: true,
                reason: "spoofed",
              };
            }

            if (face.liveness?.status === "uncertain") {
              return {
                face: face,
                skipRecognition: true,
                reason: "uncertain_edge_case",
              };
            }

            if (face.liveness?.status === "error") {
              return null;
            }

            const bbox = [
              face.bbox.x,
              face.bbox.y,
              face.bbox.width,
              face.bbox.height,
            ];

            const response = await backendServiceRef.current.recognizeFace(
              frameData,
              bbox,
              currentGroupValue?.id,
              face.landmarks_5,
            );

            if (response.success && response.person_id) {
              let memberName = response.person_id;
              if (currentGroupValue) {
                try {
                  let member = memberCacheRef.current.get(response.person_id);
                  if (!member && member !== null) {
                    member = await attendanceManager.getMember(
                      response.person_id,
                    );
                    memberCacheRef.current.set(
                      response.person_id,
                      member || null,
                    );
                  }

                  if (!member) {
                    return null;
                  }

                  memberName = member.name || response.person_id;

                  if (member.group_id !== currentGroupValue.id) {
                    return null;
                  }
                } catch {
                  memberCacheRef.current.set(response.person_id, null);
                  return null;
                }
              } else {
                try {
                  let member = memberCacheRef.current.get(response.person_id);
                  if (!member && member !== null) {
                    member = await attendanceManager.getMember(
                      response.person_id,
                    );
                    memberCacheRef.current.set(
                      response.person_id,
                      member || null,
                    );
                  }
                  if (member && member.name) {
                    memberName = member.name;
                  }
                } catch {
                  memberCacheRef.current.set(response.person_id, null);
                }
              }

              const trackedFaceId = `track_${face.track_id}`;
              const currentTime = Date.now();

              startTransition(() => {
                setTrackedFaces((prev) => {
                  const newTracked = new Map(prev);
                  const currentLivenessStatus = face.liveness?.status;
                  const existingTrack = newTracked.get(trackedFaceId);

                  if (existingTrack) {
                    existingTrack.lastSeen = currentTime;
                    existingTrack.confidence = Math.max(
                      existingTrack.confidence,
                      face.confidence,
                    );
                    existingTrack.trackingHistory.push({
                      timestamp: currentTime,
                      bbox: face.bbox,
                      confidence: face.confidence,
                    });
                    existingTrack.trackingHistory = trimTrackingHistory(
                      existingTrack.trackingHistory,
                    );
                    existingTrack.occlusionCount = 0;
                    existingTrack.angleConsistency = calculateAngleConsistency(
                      existingTrack.trackingHistory,
                    );
                    existingTrack.livenessStatus = currentLivenessStatus;

                    newTracked.set(existingTrack.id, existingTrack);
                  } else {
                    newTracked.set(trackedFaceId, {
                      id: trackedFaceId,
                      bbox: face.bbox,
                      confidence: face.confidence,
                      lastSeen: currentTime,
                      trackingHistory: [
                        {
                          timestamp: currentTime,
                          bbox: face.bbox,
                          confidence: face.confidence,
                        },
                      ],
                      isLocked: trackingMode === "auto",
                      personId: response.person_id,
                      occlusionCount: 0,
                      angleConsistency: 1.0,
                      livenessStatus: currentLivenessStatus,
                    });
                  }

                  return newTracked;
                });
              });

              if (
                attendanceEnabled &&
                currentGroupValue &&
                response.person_id
              ) {
                const livenessStatus = face.liveness?.status ?? null;
                const shouldSkipAttendanceLogging =
                  !!face.liveness &&
                  (face.liveness.is_real !== true ||
                    (livenessStatus !== null &&
                      NON_LOGGING_ANTISPOOF_STATUSES.has(livenessStatus)));

                if (
                  face.liveness?.status &&
                  NON_LOGGING_ANTISPOOF_STATUSES.has(face.liveness.status)
                ) {
                  return null;
                }

                if (!shouldSkipAttendanceLogging) {
                  try {
                    const actualConfidence = response.similarity || 0;

                    if (trackingMode === "auto") {
                      const currentTime = Date.now();
                      const cooldownKey = response.person_id;
                      const cooldownInfo =
                        persistentCooldownsRef.current.get(cooldownKey);
                      const authoritativeTimestamp =
                        cooldownInfo?.startTime || 0;
                      const timeSinceLastAttendance =
                        currentTime - authoritativeTimestamp;
                      const storedCooldownSeconds =
                        cooldownInfo?.cooldownDurationSeconds ??
                        attendanceCooldownSeconds;
                      const storedCooldownMs = storedCooldownSeconds * 1000;

                      if (timeSinceLastAttendance < storedCooldownMs) {
                        startTransition(() => {
                          setPersistentCooldowns((prev) => {
                            const newPersistent = new Map(prev);
                            const existing = newPersistent.get(cooldownKey);
                            if (existing) {
                              newPersistent.set(cooldownKey, {
                                ...existing,
                                lastKnownBbox: face.bbox,
                              });
                              persistentCooldownsRef.current = newPersistent;
                              return newPersistent;
                            }
                            return prev;
                          });
                        });

                        return {
                          trackId,
                          result: { ...response, name: memberName, memberName },
                        };
                      }

                      const logTime = Date.now();
                      const existingInState =
                        persistentCooldownsRef.current.get(cooldownKey);
                      const existingCooldownSeconds =
                        existingInState?.cooldownDurationSeconds ??
                        attendanceCooldownSeconds;
                      const existingCooldownMs = existingCooldownSeconds * 1000;
                      const existingInStateStillActive =
                        existingInState &&
                        logTime - existingInState.startTime <
                          existingCooldownMs;

                      if (!existingInStateStillActive) {
                        startTransition(() => {
                          setPersistentCooldowns((prev) => {
                            const newPersistent = new Map(prev);
                            newPersistent.set(cooldownKey, {
                              personId: response.person_id!,
                              startTime: logTime,
                              memberName: memberName,
                              lastKnownBbox: face.bbox,
                              cooldownDurationSeconds:
                                attendanceCooldownSeconds,
                            });
                            persistentCooldownsRef.current = newPersistent;
                            return newPersistent;
                          });
                        });
                      } else {
                        // Update metadata only, preserve startTime
                        startTransition(() => {
                          setPersistentCooldowns((prev) => {
                            const newPersistent = new Map(prev);
                            const existing = newPersistent.get(cooldownKey);
                            if (existing) {
                              newPersistent.set(cooldownKey, {
                                ...existing,
                                memberName: memberName,
                                lastKnownBbox: face.bbox,
                              });
                              // Sync ref with latest state
                              persistentCooldownsRef.current = newPersistent;
                            }
                            return newPersistent;
                          });
                        });
                      }

                      try {
                        const attendanceEvent =
                          await attendanceManager.processAttendanceEvent(
                            response.person_id,
                            actualConfidence,
                            "LiveVideo Camera",
                            face.liveness?.status,
                            face.liveness?.confidence,
                          );

                        if (attendanceEvent) {
                          const scheduleRefresh = () => {
                            if ("requestIdleCallback" in window) {
                              requestIdleCallback(
                                () => {
                                  loadAttendanceData().catch((err) =>
                                    console.error(
                                      "Failed to refresh attendance:",
                                      err,
                                    ),
                                  );
                                },
                                { timeout: 500 },
                              );
                            } else {
                              setTimeout(async () => {
                                await loadAttendanceData();
                              }, 100);
                            }
                          };
                          scheduleRefresh();
                        }
                        setError(null);
                      } catch (attendanceError: unknown) {
                        const errorMessage =
                          attendanceError instanceof Error
                            ? attendanceError.message
                            : "Unknown error";
                        setError(
                          errorMessage ||
                            `Failed to record attendance for ${response.person_id}`,
                        );
                      }
                    }
                  } catch (error) {
                    console.error("❌ Attendance processing failed:", error);
                    setError(
                      `Attendance error: ${error instanceof Error ? error.message : "Unknown error"}`,
                    );
                  }
                }
              }

              return {
                trackId,
                result: { ...response, name: memberName, memberName },
              };
            } else if (response.success) {
              const faceId = `unknown_track_${face.track_id}`;
              const currentTime = Date.now();

              startTransition(() => {
                setTrackedFaces((prev) => {
                  const newTracked = new Map(prev);
                  newTracked.set(faceId, {
                    id: faceId,
                    bbox: face.bbox,
                    confidence: face.confidence,
                    lastSeen: currentTime,
                    trackingHistory: [
                      {
                        timestamp: currentTime,
                        bbox: face.bbox,
                        confidence: face.confidence,
                      },
                    ],
                    isLocked: false,
                    personId: undefined,
                    occlusionCount: 0,
                    angleConsistency: 1.0,
                    livenessStatus: face.liveness?.status,
                  });
                  return newTracked;
                });
              });
            }
          } catch {
          }
          return null;
        });

        const recognitionResults = await Promise.all(recognitionPromises);

        if (processingGroup?.id !== currentGroupRef.current?.id) {
          return;
        }

        const newRecognitionResults = new Map<
          number,
          ExtendedFaceRecognitionResponse
        >();
        recognitionResults.forEach((result) => {
          if (result) {
            if (result.skipRecognition) {
              if (result.face.track_id !== undefined) {
                newRecognitionResults.set(result.face.track_id, {
                  success: false,
                  person_id: undefined,
                  similarity: 0,
                  error: "Spoofed face - recognition skipped",
                });
              }
            } else if (result.result && result.trackId !== undefined) {
              newRecognitionResults.set(result.trackId, result.result);
            }
          }
        });

        setCurrentRecognitionResults((prev) => {
          if (areRecognitionMapsEqual(prev, newRecognitionResults)) {
            return prev;
          }
          return newRecognitionResults;
        });

        startTransition(() => {
          recognitionResults.forEach((result) => {
            if (result && result.skipRecognition) {
              const face = result.face;
              const faceId = `spoofed_track_${face.track_id}`;
              const currentTime = Date.now();

              setTrackedFaces((prev) => {
                const newTracked = new Map(prev);
                newTracked.set(faceId, {
                  id: faceId,
                  bbox: face.bbox,
                  confidence: face.confidence,
                  lastSeen: currentTime,
                  trackingHistory: [
                    {
                      timestamp: currentTime,
                      bbox: face.bbox,
                      confidence: face.confidence,
                    },
                  ],
                  isLocked: false,
                  personId: undefined,
                  occlusionCount: 0,
                  angleConsistency: 1.0,
                  livenessStatus: face.liveness?.status,
                });
                return newTracked;
              });
            }
          });
        });
      } catch (error) {
        console.error("❌ Face recognition processing failed:", error);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [captureFrame, trackingMode, attendanceCooldownSeconds],
  );

  // Initialize WebSocket
  const initializeWebSocket = useCallback(async () => {
    try {
      if (websocketStatus === "connecting") {
        return;
      }

      if (!backendServiceRef.current) {
        backendServiceRef.current = new BackendService();
      }

      const readinessCheck = await window.electronAPI?.backend.checkReadiness();

      if (!readinessCheck?.ready || !readinessCheck?.modelsLoaded) {
        throw new Error("Backend not ready: Models still loading");
      }

      await backendServiceRef.current.connectWebSocket();
      backendServiceRef.current.onMessage(
        "detection_response",
        (data: WebSocketDetectionResponse) => {
          if (!isStreamingRef.current || !detectionEnabledRef.current) {
            return;
          }

          const responseFrameTimestamp = data.frame_timestamp || 0;
          const lastFrameTimestamp = lastFrameTimestampRef.current || 0;

          if (responseFrameTimestamp < lastFrameTimestamp) {
            return;
          }

          lastFrameTimestampRef.current = responseFrameTimestamp;

          const now = Date.now();
          const fpsTracking = fpsTrackingRef.current;
          fpsTracking.timestamps.push(now);

          if (fpsTracking.timestamps.length > fpsTracking.maxSamples) {
            fpsTracking.timestamps.shift();
          }

          if (
            now - fpsTracking.lastUpdateTime >= 100 &&
            fpsTracking.timestamps.length >= 2
          ) {
            const timeSpan =
              fpsTracking.timestamps[fpsTracking.timestamps.length - 1] -
              fpsTracking.timestamps[0];
            const frameCount = fpsTracking.timestamps.length - 1;

            if (timeSpan > 0) {
              const accurateFps = (frameCount * 1000) / timeSpan;
              setDetectionFps(Math.round(accurateFps * 10) / 10);
            }

            fpsTracking.lastUpdateTime = now;
          }

          if (data.faces && Array.isArray(data.faces)) {
            if (data.suggested_skip !== undefined) {
              skipFrames = data.suggested_skip;
            }

            const detectionResult: DetectionResult = {
              faces: data.faces.map((face: WebSocketFaceData) => {
                const bbox = face.bbox || [0, 0, 0, 0];

                return {
                  bbox: {
                    x: bbox[0] || 0,
                    y: bbox[1] || 0,
                    width: bbox[2] || 0,
                    height: bbox[3] || 0,
                  },
                  confidence: face.confidence || 0,
                  track_id: face.track_id,
                  landmarks_5: face.landmarks_5,
                  liveness: face.liveness
                    ? {
                        is_real: face.liveness.is_real ?? null,
                        confidence: face.liveness.confidence ?? 0,
                        live_score: face.liveness.live_score,
                        spoof_score: face.liveness.spoof_score,
                        status: face.liveness.status || "error",
                        label: face.liveness.label,
                        message:
                          face.liveness.message ||
                          face.liveness.decision_reason,
                        decision_reason:
                          face.liveness.decision_reason ||
                          face.liveness.message,
                      }
                    : undefined,
                };
              }),
              model_used: data.model_used || "unknown",
            };

            setCurrentDetections(detectionResult);
            lastDetectionRef.current = detectionResult;

            if (
              recognitionEnabled &&
              backendServiceReadyRef.current &&
              detectionResult.faces.length > 0
            ) {
              startTransition(() => {
                const frameDataForRecognition = lastDetectionFrameRef.current;
                performFaceRecognition(
                  detectionResult,
                  frameDataForRecognition,
                ).catch((error) => {
                  console.error("Face recognition failed:", error);
                });
              });
            }

            if (detectionEnabledRef.current && isStreamingRef.current) {
              requestAnimationFrame(() => processCurrentFrame());
            }
          } else {
            if (detectionEnabledRef.current && isStreamingRef.current) {
              requestAnimationFrame(() => processCurrentFrame());
            }
          }
        },
      );

      backendServiceRef.current.onMessage(
        "connection",
        (data: WebSocketConnectionMessage) => {
          if (data.status === "connected") {
            backendServiceReadyRef.current = true;
          }
        },
      );

      backendServiceRef.current.onMessage(
        "error",
        (data: WebSocketErrorMessage) => {
          if (!isStreamingRef.current || !detectionEnabledRef.current) {
            return;
          }

          console.error("❌ WebSocket error message:", data);
          setError(`Detection error: ${data.message || "Unknown error"}`);

          if (detectionEnabledRef.current && isStreamingRef.current) {
            requestAnimationFrame(() => processCurrentFrame());
          }
        },
      );
    } catch (error) {
      console.error("❌ WebSocket initialization failed:", error);
      if (!isStartingRef.current) {
        setError("Failed to connect to real-time detection service");
      }
      backendServiceReadyRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recognitionEnabled, performFaceRecognition]);

  // Process current frame
  const processCurrentFrame = useCallback(async () => {
    if (
      !backendServiceRef.current?.isWebSocketReady() ||
      !detectionEnabledRef.current ||
      !isStreamingRef.current
    ) {
      return;
    }

    frameCounter++;

    if (frameCounter % (skipFrames + 1) !== 0) {
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

      lastDetectionFrameRef.current = frameData;

      backendServiceRef.current
        .sendDetectionRequest(frameData)
        .catch((error) => {
          console.error("❌ WebSocket detection request failed:", error);

          if (detectionEnabledRef.current && isStreamingRef.current) {
            requestAnimationFrame(() => processCurrentFrame());
          }
        });
    } catch (error) {
      console.error("❌ Frame capture failed:", error);

      if (detectionEnabledRef.current && isStreamingRef.current) {
        requestAnimationFrame(() => processCurrentFrame());
      }
    }
  }, [captureFrame]);

  // Get camera devices
  const getCameraDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(
        (device) => device.kind === "videoinput",
      );
      setCameraDevices(videoDevices);
      if (videoDevices.length > 0 && !selectedCamera) {
        setSelectedCamera(videoDevices[0].deviceId);
      }
    } catch {
      setError("Failed to get camera devices");
    }
  }, [selectedCamera]);

  const processFrameForDetection = useCallback(() => {
    processCurrentFrame();
  }, [processCurrentFrame]);

  const startDetectionInterval = useCallback(() => {
    if (
      detectionEnabledRef.current &&
      backendServiceRef.current?.isWebSocketReady()
    ) {
      processFrameForDetection();
    }
  }, [processFrameForDetection]);

  // Start camera
  const startCamera = useCallback(async () => {
    try {
      const now = Date.now();
      const timeSinceLastStart = now - lastStartTimeRef.current;
      const timeSinceLastStop = now - lastStopTimeRef.current;

      if (isStartingRef.current || isStreamingRef.current) {
        return;
      }

      if (timeSinceLastStop < 100) {
        return;
      }

      if (timeSinceLastStart < 200) {
        return;
      }

      isStartingRef.current = true;
      lastStartTimeRef.current = now;
      setIsStreaming(true);
      isStreamingRef.current = true;
      setIsVideoLoading(true);
      setError(null);
      await getCameraDevices();

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: selectedCamera ? { exact: selectedCamera } : undefined,
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;

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

            video
              .play()
              .then(() => {
                checkVideoReady();
              })
              .catch(() => {
                checkVideoReady();
              });
          });
        };

        await waitForVideoReady();
        setIsVideoLoading(false);
        setCameraActive(true);

        try {
          const readinessCheck =
            await window.electronAPI?.backend.checkReadiness();

          if (!readinessCheck?.ready || !readinessCheck?.modelsLoaded) {
            setError(
              "Backend models are still loading. Please wait and try again.",
            );
            setDetectionEnabled(false);
            return;
          }

          setDetectionEnabled(true);
          detectionEnabledRef.current = true;

          if (websocketStatus === "disconnected") {
            try {
              await initializeWebSocket();
              backendServiceReadyRef.current = true;
              startDetectionInterval();
            } catch (error) {
              console.error(
                "❌ Failed to initialize WebSocket or start detection:",
                error,
              );
              setDetectionEnabled(false);
              if (!isStartingRef.current) {
                setError("Failed to connect to detection service");
              }
            }
          } else if (websocketStatus === "connected") {
            backendServiceReadyRef.current = true;
            setDetectionEnabled(true);
            detectionEnabledRef.current = true;

            if (!isStreamingRef.current) {
              isStreamingRef.current = true;
            }

            isProcessingRef.current = false;
            startDetectionInterval();
          }
        } catch (error) {
          console.error("❌ Failed to check backend readiness:", error);
          if (!isStartingRef.current) {
            setError("Failed to check backend readiness");
          }
          setDetectionEnabled(false);
        }

        if (websocketStatus === "connecting") {
          backendServiceReadyRef.current = true;
          setDetectionEnabled(true);
          detectionEnabledRef.current = true;

          if (!isStreamingRef.current) {
            isStreamingRef.current = true;
          }

          isProcessingRef.current = false;
        }
      }
    } catch (err) {
      console.error("Error starting camera:", err);
      setError("Failed to start camera. Please check permissions.");

      setIsStreaming(false);
      isStreamingRef.current = false;
      setIsVideoLoading(false);
      setCameraActive(false);
    } finally {
      isStartingRef.current = false;
    }
  }, [
    selectedCamera,
    websocketStatus,
    initializeWebSocket,
    startDetectionInterval,
    getCameraDevices,
  ]);

  // Stop camera
  const stopCamera = useCallback(() => {
    const now = Date.now();
    const timeSinceLastStop = now - lastStopTimeRef.current;

    if (isStoppingRef.current || !isStreamingRef.current) {
      return;
    }

    if (timeSinceLastStop < 100) {
      return;
    }

    isStoppingRef.current = true;
    lastStopTimeRef.current = now;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setDetectionEnabled(false);
    setIsStreaming(false);
    setIsVideoLoading(false);
    setCameraActive(false);
    isProcessingRef.current = false;
    backendServiceReadyRef.current = false;

    if (backendServiceRef.current) {
      backendServiceRef.current.disconnect();
    }
    setWebsocketStatus("disconnected");

    lastFrameTimestampRef.current = 0;
    lastDetectionHashRef.current = "";
    lastDetectionFrameRef.current = null;

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }

    setCurrentDetections(null);
    lastDetectionRef.current = null;
    setCurrentRecognitionResults(new Map());
    setTrackedFaces(new Map());

    setDetectionFps(0);
    fpsTrackingRef.current = {
      timestamps: [],
      maxSamples: 10,
      lastUpdateTime: Date.now(),
    };

    lastDetectionHashRef.current = "";
    lastVideoSizeRef.current = { width: 0, height: 0 };
    lastCanvasSizeRef.current = { width: 0, height: 0 };
    scaleFactorsRef.current = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
    setError(null);

    const overlayCanvas = overlayCanvasRef.current;
    if (overlayCanvas) {
      const ctx = overlayCanvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
    }

    isStoppingRef.current = false;
  }, []);

  const getVideoRect = useCallback(() => {
    const video = videoRef.current;
    if (!video) return null;

    const now = Date.now();
    if (!videoRectRef.current || now - lastVideoRectUpdateRef.current > 100) {
      videoRectRef.current = video.getBoundingClientRect();
      lastVideoRectUpdateRef.current = now;
    }

    return videoRectRef.current;
  }, []);

  const calculateScaleFactors = useCallback(() => {
    const video = videoRef.current;
    const overlayCanvas = overlayCanvasRef.current;

    if (!video || !overlayCanvas) return null;

    const currentVideoWidth = video.videoWidth;
    const currentVideoHeight = video.videoHeight;

    if (
      lastVideoSizeRef.current.width === currentVideoWidth &&
      lastVideoSizeRef.current.height === currentVideoHeight &&
      lastCanvasSizeRef.current.width === overlayCanvas.width &&
      lastCanvasSizeRef.current.height === overlayCanvas.height
    ) {
      return scaleFactorsRef.current;
    }

    lastVideoSizeRef.current = {
      width: currentVideoWidth,
      height: currentVideoHeight,
    };
    lastCanvasSizeRef.current = {
      width: overlayCanvas.width,
      height: overlayCanvas.height,
    };

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

    scaleFactorsRef.current = { scaleX, scaleY, offsetX, offsetY };
    return scaleFactorsRef.current;
  }, []);
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
  }, [
    currentDetections,
    isStreaming,
    currentRecognitionResults,
    recognitionEnabled,
    persistentCooldowns,
    attendanceCooldownSeconds,
    quickSettings,
    getVideoRect,
    calculateScaleFactors,
  ]);

  const animate = useCallback(() => {
    const detectionsToRender = currentDetections;
    const overlayCanvas = overlayCanvasRef.current;
    if (overlayCanvas && (!detectionsToRender || !isStreaming)) {
      const ctx = overlayCanvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
    }

    const recognitionForHash =
      deferredCurrentRecognitionResults.size > 0
        ? deferredCurrentRecognitionResults
        : currentRecognitionResults;

    const currentHash = detectionsToRender
      ? `${detectionsToRender.faces.length}-${detectionsToRender.faces.map((f) => `${f.bbox.x},${f.bbox.y}`).join(",")}-${recognitionForHash.size}-${Array.from(
          recognitionForHash.values(),
        )
          .map((r) => r.person_id || "none")
          .join(",")}`
      : "";

    if (currentHash !== lastDetectionHashRef.current) {
      handleDrawOverlays();
      lastDetectionHashRef.current = currentHash;
    }

    if (isStreaming) {
      animationFrameRef.current = requestAnimationFrame(animate);
    }
  }, [
    isStreaming,
    handleDrawOverlays,
    currentDetections,
    currentRecognitionResults,
    deferredCurrentRecognitionResults,
  ]);

  // Load settings
  const loadSettings = useCallback(async () => {
    try {
      const settings = await attendanceManager.getSettings();
      setAttendanceCooldownSeconds(settings.attendance_cooldown_seconds ?? 10);
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  }, []);

  const loadAttendanceData = useCallback(async () => {
    try {
      const currentGroupValue = currentGroupRef.current;
      const groups = await attendanceManager.getGroups();
      setAttendanceGroups(groups);

      if (!currentGroupValue) {
        return;
      }

      const groupStillExists = groups.some(
        (group) => group.id === currentGroupValue.id,
      );
      if (!groupStillExists) {
        setTimeout(() => {
          attendanceManager.getGroups().then((latestGroups) => {
            const stillMissing = !latestGroups.some(
              (group) => group.id === currentGroupValue.id,
            );
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
          limit: 100,
        }),
      ]);

      setGroupMembers(members);
      setRecentAttendance(records);
    } catch (error) {
      console.error("❌ Failed to load attendance data:", error);
    }
  }, [currentGroup]);

  // Tracking helpers
  const calculateAngleConsistency = useCallback(
    (
      history: Array<{
        timestamp: number;
        bbox: { x: number; y: number; width: number; height: number };
        confidence: number;
      }>,
    ) => {
      if (history.length < 2) return 1.0;

      let consistencyScore = 0;
      for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const curr = history[i];
      const dx = curr.bbox.x - prev.bbox.x;
      const dy = curr.bbox.y - prev.bbox.y;
      const movement = Math.sqrt(dx * dx + dy * dy);
      const smoothness = Math.max(0, 1 - movement / 100);
        consistencyScore += smoothness;
      }

      return consistencyScore / (history.length - 1);
    },
    [],
  );

  const handleOcclusion = useCallback(() => {
    setTrackedFaces((prev) => {
      const newTracked = new Map(prev);
      const currentTime = Date.now();
      const occlusionThreshold = 2000;

      for (const [id, track] of newTracked) {
        if (currentTime - track.lastSeen > occlusionThreshold) {
          track.occlusionCount++;
          if (track.occlusionCount > 5) {
            newTracked.delete(id);
          }
        }
      }

      return newTracked;
    });
  }, []);
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      handleOcclusion();
    }, 1000);

    return () => clearInterval(cleanupInterval);
  }, [handleOcclusion]);

  const handleSelectGroup = useCallback(async (group: AttendanceGroup) => {
    setCurrentGroup(group);

    try {
      const [members, , records] = await Promise.all([
        attendanceManager.getGroupMembers(group.id),
        attendanceManager.getGroupStats(group.id),
        attendanceManager.getRecords({
          group_id: group.id,
          limit: 100,
        }),
      ]);

      setGroupMembers(members);
      setRecentAttendance(records);
    } catch (error) {
      console.error("❌ Failed to load data for selected group:", error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateGroup = useCallback(async () => {
    if (!newGroupName.trim()) return;

    try {
      const group = await attendanceManager.createGroup(newGroupName.trim());
      setNewGroupName("");
      setShowGroupManagement(false);
      await loadAttendanceData();

      await handleSelectGroup(group);
    } catch (error) {
      console.error("❌ Failed to create group:", error);
      setError("Failed to create group");
    }
  }, [newGroupName, loadAttendanceData, handleSelectGroup]);

  const handleDeleteGroup = useCallback((group: AttendanceGroup) => {
    setGroupToDelete(group);
    setShowDeleteConfirmation(true);
  }, []);

  const confirmDeleteGroup = useCallback(async () => {
    if (!groupToDelete) return;

    try {
      const success = await attendanceManager.deleteGroup(groupToDelete.id);
      if (success) {
        if (currentGroup?.id === groupToDelete.id) {
          setCurrentGroup(null);
          setGroupMembers([]);
          setRecentAttendance([]);
        }

        await loadAttendanceData();
      } else {
        throw new Error("Failed to delete group");
      }
    } catch (error) {
      console.error("❌ Failed to delete group:", error);
      setError("Failed to delete group");
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

  useEffect(() => {
    getCameraDevices();
    return () => {
      stopCamera();
    };
  }, [getCameraDevices, stopCamera]);
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

  useEffect(() => {
    const pollWebSocketStatus = () => {
      if (backendServiceRef.current) {
        const actualStatus = backendServiceRef.current.getWebSocketStatus();
        if (actualStatus !== websocketStatus) {
          setWebsocketStatus(actualStatus);
        }
      }
    };

    const statusInterval = setInterval(pollWebSocketStatus, 250);

    return () => {
      clearInterval(statusInterval);
    };
  }, [websocketStatus]);

  useEffect(() => {
    if (websocketStatus === "connected" && detectionEnabledRef.current) {
      if (backendServiceRef.current?.isWebSocketReady()) {
        startDetectionInterval();
      }
    }
  }, [websocketStatus, startDetectionInterval]);

  useEffect(() => {
    setCurrentRecognitionResults(new Map());
    setTrackedFaces(new Map());
    setCurrentDetections(null);

    if (isStreamingRef.current) {
      stopCamera();
    }
  }, [currentGroup, stopCamera]);

  const handleManualLog = async (
    personId: string,
    _name: string,
    confidence: number,
  ) => {
    try {
      const attendanceEvent = await attendanceManager.processAttendanceEvent(
        personId,
        confidence,
        "LiveVideo Camera - Manual Log",
      );

      if (attendanceEvent) {
        setTimeout(async () => {
          await loadAttendanceData();
        }, 100);
      }
      setError(null);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error(`Manual attendance logging failed:`, errorMessage);
      setError(errorMessage || "Failed to log attendance manually");
    }
  };

  useEffect(() => {
    currentGroupRef.current = currentGroup;
  }, [currentGroup]);

  useEffect(() => {
    const initializeAttendance = async () => {
      try {
        await loadSettings();
        const groups = await attendanceManager.getGroups();
        setAttendanceGroups(groups);

        if (groups.length === 0) {
          setCurrentGroup(null);
        } else if (!currentGroup) {
          const savedGroupId = localStorage.getItem("suri_selected_group_id");
          let groupToSelect = null;

          if (savedGroupId) {
            groupToSelect = groups.find((group) => group.id === savedGroupId);
          }

          if (!groupToSelect) {
            groupToSelect = groups[0];
          }

          await handleSelectGroup(groupToSelect);
        }
      } catch (error) {
        console.error("Failed to initialize attendance system:", error);
        setError("Failed to initialize attendance system");
      }
    };

    initializeAttendance().catch((error) => {
      console.error("Error in initializeAttendance:", error);
    });
  }, [handleSelectGroup, loadSettings]);

  return (
    <div className="pt-9 pb-5 h-screen bg-black text-white flex flex-col overflow-hidden">
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
              trackingMode={trackingMode}
              currentDetections={currentDetections}
              currentRecognitionResults={currentRecognitionResults}
              recognitionEnabled={recognitionEnabled}
              groupMembers={groupMembers}
              handleManualLog={handleManualLog}
              getVideoRect={getVideoRect}
              calculateScaleFactors={calculateScaleFactors}
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
          persistentCooldowns={persistentCooldowns}
          attendanceCooldownSeconds={attendanceCooldownSeconds}
          attendanceEnabled={attendanceEnabled}
          attendanceGroups={attendanceGroups}
          currentGroup={currentGroup}
          recentAttendance={recentAttendance}
          groupMembers={groupMembers}
          handleSelectGroup={handleSelectGroup}
          setShowGroupManagement={setShowGroupManagement}
          setShowSettings={setShowSettings}
          enableSpoofDetection={enableSpoofDetection}
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
        handleCreateGroup={handleCreateGroup}
        handleSelectGroup={handleSelectGroup}
        handleDeleteGroup={handleDeleteGroup}
      />

      {/* Settings Modal (with integrated Menu) */}
      {showSettings && (
        <Settings
          onBack={() => {
            setShowSettings(false);
            setIsSettingsFullScreen(false);
            setGroupInitialSection(undefined);
            loadAttendanceData(); // Refresh data when closing
          }}
          isFullScreen={isSettingsFullScreen}
          onToggleFullScreen={() => setIsSettingsFullScreen((prev) => !prev)}
          isModal={true}
          quickSettings={quickSettings}
          onQuickSettingsChange={setQuickSettings}
          attendanceSettings={{
            trackingMode: trackingMode,
            lateThresholdEnabled:
              (currentGroup?.settings as { late_threshold_enabled?: boolean })
                ?.late_threshold_enabled ?? false,
            lateThresholdMinutes:
              currentGroup?.settings?.late_threshold_minutes ?? 15,
            classStartTime: currentGroup?.settings?.class_start_time ?? "08:00",
            attendanceCooldownSeconds: attendanceCooldownSeconds,
            enableSpoofDetection: enableSpoofDetection,
          }}
          onAttendanceSettingsChange={async (updates) => {
            // Handle tracking mode change
            if (updates.trackingMode !== undefined) {
              setTrackingMode(updates.trackingMode);
            }

            // Handle spoof detection toggle (global setting)
            if (updates.enableSpoofDetection !== undefined) {
              setEnableSpoofDetection(updates.enableSpoofDetection);
              localStorage.setItem(
                "suri_enable_spoof_detection",
                String(updates.enableSpoofDetection),
              );
            }

            // Handle cooldown change (global setting)
            if (updates.attendanceCooldownSeconds !== undefined) {
              setAttendanceCooldownSeconds(updates.attendanceCooldownSeconds);
              try {
                await attendanceManager.updateSettings({
                  attendance_cooldown_seconds:
                    updates.attendanceCooldownSeconds,
                });
              } catch (error) {
                console.error("Failed to update cooldown setting:", error);
              }
            }

            // Handle group settings changes
            if (
              currentGroup &&
              (updates.lateThresholdEnabled !== undefined ||
                updates.lateThresholdMinutes !== undefined ||
                updates.classStartTime !== undefined)
            ) {
              const updatedSettings = {
                ...currentGroup.settings,
                ...(updates.lateThresholdEnabled !== undefined && {
                  late_threshold_enabled: updates.lateThresholdEnabled,
                }),
                ...(updates.lateThresholdMinutes !== undefined && {
                  late_threshold_minutes: updates.lateThresholdMinutes,
                }),
                ...(updates.classStartTime !== undefined && {
                  class_start_time: updates.classStartTime,
                }),
              };
              try {
                await attendanceManager.updateGroup(currentGroup.id, {
                  settings: updatedSettings,
                });
                setCurrentGroup({
                  ...currentGroup,
                  settings: updatedSettings,
                });
              } catch (error) {
                console.error("Failed to update attendance settings:", error);
              }
            }
          }}
          isStreaming={isStreaming}
          initialGroupSection={groupInitialSection}
          currentGroup={currentGroup}
          onGroupSelect={handleSelectGroup}
          onGroupsChanged={loadAttendanceData}
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
