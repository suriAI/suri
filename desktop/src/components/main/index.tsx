import {
  useState,
  useEffect,
  useRef,
  useCallback,
  startTransition,
} from "react";
import { BackendService } from "../../services/BackendService";
import { Settings, type QuickSettings } from "../settings";
import { attendanceManager } from "../../services/AttendanceManager";
import type { GroupSection } from "../group";
import type {
  AttendanceGroup,
  AttendanceMember,
  AttendanceRecord,
} from "../../types/recognition";
import { drawOverlays } from "./utils/overlayRenderer";
import {
  trimTrackingHistory,
  areRecognitionMapsEqual,
  type ExtendedFaceRecognitionResponse,
} from "./utils/recognitionHelpers";

export type { ExtendedFaceRecognitionResponse };
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
import { NON_LOGGING_ANTISPOOF_STATUSES } from "./constants";

export default function Main() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const backendServiceRef = useRef<BackendService | null>(null);
  const isProcessingRef = useRef<boolean>(false);
  const isStreamingRef = useRef<boolean>(false);
  const lastDetectionFrameRef = useRef<ArrayBuffer | null>(null);
  const frameCounterRef = useRef(0);
  const skipFramesRef = useRef(0);

  const lastStartTimeRef = useRef<number>(0);
  const lastStopTimeRef = useRef<number>(0);
  const isStartingRef = useRef<boolean>(false);
  const isStoppingRef = useRef<boolean>(false);

  const emergencyRecovery = useCallback(() => {
    isStartingRef.current = false;
    isStoppingRef.current = false;
    isProcessingRef.current = false;
    lastStartTimeRef.current = 0;
    lastStopTimeRef.current = 0;
      if (isStreamingRef.current) {
        isStreamingRef.current = false;
        isScanningRef.current = false;
        setIsStreaming(false);
      }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }
  }, []);

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
  const videoRectRef = useRef<DOMRect | null>(null);
  const lastVideoRectUpdateRef = useRef<number>(0);
  const lastHashCalculationRef = useRef<number>(0);

  const [isStreaming, setIsStreaming] = useState(false);
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [, setCameraActive] = useState(false);
  const [currentDetections, setCurrentDetections] =
    useState<DetectionResult | null>(null);
  const [detectionFps, setDetectionFps] = useState<number>(0);
  const [websocketStatus, setWebsocketStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const backendServiceReadyRef = useRef(false);
  const isScanningRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const checkVideoState = () => {
      const hasStream = video.srcObject !== null;
      const isPlaying = !video.paused && !video.ended && video.readyState > 2;
      const shouldBeActive = hasStream && isPlaying;

      setCameraActive((prevActive) => {
        if (prevActive !== shouldBeActive) {
          if (shouldBeActive && !isStreamingRef.current) {
            isStreamingRef.current = true;
            setIsStreaming(true);
          } else if (!shouldBeActive && isStreamingRef.current) {
            isStreamingRef.current = false;
            setIsStreaming(false);
            isScanningRef.current = false;
          }
          return shouldBeActive;
        }
        return prevActive;
      });
    };

    checkVideoState();
    const events = ["loadedmetadata", "play", "pause", "ended", "emptied"];
    events.forEach((event) => {
      video.addEventListener(event, checkVideoState);
    });
    const interval = setInterval(checkVideoState, 200);

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (video && videoRectRef.current) {
          videoRectRef.current = video.getBoundingClientRect();
          lastVideoRectUpdateRef.current = Date.now();
        }
      });
    });
    resizeObserver.observe(video);

    return () => {
      events.forEach((event) => {
        video.removeEventListener(event, checkVideoState);
      });
      clearInterval(interval);
      resizeObserver.disconnect();
    };
  }, []);

  const lastDetectionRef = useRef<DetectionResult | null>(null);
  const lastFrameTimestampRef = useRef<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>("");

  const [currentRecognitionResults, setCurrentRecognitionResults] = useState<
    Map<number, ExtendedFaceRecognitionResponse>
  >(new Map());

  const fpsTrackingRef = useRef({
    timestamps: [] as number[],
    maxSamples: 10,
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

  const attendanceEnabled = true;
  const [currentGroup, setCurrentGroupInternal] =
    useState<AttendanceGroup | null>(null);
  const currentGroupRef = useRef<AttendanceGroup | null>(null);
  const memberCacheRef = useRef<Map<string, AttendanceMember | null>>(
    new Map(),
  );
  const calculateAngleConsistencyRef = useRef<
    (
      history: Array<{
        timestamp: number;
        bbox: { x: number; y: number; width: number; height: number };
        confidence: number;
      }>,
    ) => number
  >(() => 1.0);
  const loadAttendanceDataRef = useRef<() => Promise<void>>(async () => {});
  const processCurrentFrameRef = useRef<() => Promise<void>>(async () => {});

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

  const [trackingMode, setTrackingMode] = useState<"auto" | "manual">("auto");
  const [attendanceCooldownSeconds, setAttendanceCooldownSeconds] =
    useState<number>(10);
  const [enableSpoofDetection, setEnableSpoofDetection] = useState<boolean>(
    () => {
      const saved = localStorage.getItem("suri_enable_spoof_detection");
      return saved !== null ? saved === "true" : true;
    },
  );
  const [trackedFaces, setTrackedFaces] = useState<Map<string, TrackedFace>>(
    new Map(),
  );
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

  const [persistentCooldowns, setPersistentCooldowns] = useState<
    Map<string, CooldownInfo>
  >(new Map());
  const persistentCooldownsRef = useRef<Map<string, CooldownInfo>>(new Map());

  useEffect(() => {
    persistentCooldownsRef.current = persistentCooldowns;
  }, [persistentCooldowns]);

  useEffect(() => {
    if (backendServiceRef.current) {
      backendServiceRef.current.setLivenessDetection(enableSpoofDetection);
    }
  }, [enableSpoofDetection]);

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

  useEffect(() => {
    let lastUpdateTime = 0;
    const updateInterval = 1000;
    let rafId: number | null = null;

    const updateCooldowns = () => {
      const now = Date.now();
      startTransition(() => {
        setPersistentCooldowns((prev) => {
          if (prev.size === 0) return prev;
          
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
        
        if (persistentCooldownsRef.current.size === 0) {
          rafId = null;
          return;
        }
      }
      rafId = requestAnimationFrame(scheduleUpdate);
    };

    const startUpdate = () => {
      if (rafId === null && persistentCooldownsRef.current.size > 0) {
        rafId = requestAnimationFrame(scheduleUpdate);
      }
    };

    startUpdate();
    const checkInterval = setInterval(() => {
      if (persistentCooldownsRef.current.size > 0 && rafId === null) {
        startUpdate();
      }
    }, 1000);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      clearInterval(checkInterval);
    };
  }, [attendanceCooldownSeconds]);

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

            if (face.liveness?.status === "spoof") {
              return {
                face: face,
                skipRecognition: true,
                reason: "spoofed",
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
                    existingTrack.angleConsistency =
                      calculateAngleConsistencyRef.current(
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
                    if (response.similarity === undefined || response.similarity === null) {
                      return null;
                    }
                    const actualConfidence = response.similarity;

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
                          requestIdleCallback(
                            () => {
                              loadAttendanceDataRef
                                .current()
                                .catch((err) =>
                                  console.error(
                                    "Failed to refresh attendance:",
                                    err,
                                  ),
                                );
                            },
                            { timeout: 500 },
                          );
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
            // Ignore individual face recognition errors
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
    },
    [trackingMode, attendanceCooldownSeconds, attendanceEnabled],
  );

  const processCurrentFrame = useCallback(async () => {
    if (
      !backendServiceRef.current?.isWebSocketReady() ||
      !isScanningRef.current ||
      !isStreamingRef.current
    ) {
      return;
    }

    frameCounterRef.current += 1;

    if (frameCounterRef.current % (skipFramesRef.current + 1) !== 0) {
      requestAnimationFrame(() => processCurrentFrameRef.current());
      return;
    }

    try {
      const frameData = await captureFrame();
      if (!frameData) {
        requestAnimationFrame(() => processCurrentFrameRef.current());
        return;
      }

      lastDetectionFrameRef.current = frameData;

      backendServiceRef.current
        .sendDetectionRequest(frameData)
        .catch((error) => {
          console.error("❌ WebSocket detection request failed:", error);
          requestAnimationFrame(() => processCurrentFrameRef.current());
        });
    } catch (error) {
      console.error("❌ Frame capture failed:", error);
      requestAnimationFrame(() => processCurrentFrameRef.current());
    }
  }, [captureFrame]);

  useEffect(() => {
    processCurrentFrameRef.current = processCurrentFrame;
  }, [processCurrentFrame]);

  const waitForBackendReady = useCallback(
    async (
      maxWaitTime: number = 60000,
      pollInterval: number = 500,
    ): Promise<{ ready: boolean; modelsLoaded: boolean; error?: string }> => {
      const startTime = Date.now();
      let lastError: string | undefined;

      while (Date.now() - startTime < maxWaitTime) {
        try {
          if (!window.electronAPI?.backend) {
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
            continue;
          }

          const readinessCheck =
            await window.electronAPI.backend.checkReadiness();

          if (readinessCheck?.ready && readinessCheck?.modelsLoaded) {
            return {
              ready: true,
              modelsLoaded: true,
            };
          }

          if (readinessCheck?.error) {
            lastError = readinessCheck.error;
          } else {
            lastError = "Models still loading";
          }

          if (
            readinessCheck?.error?.includes("Backend service not started") ||
            readinessCheck?.error?.includes("Backend health check failed")
          ) {
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
            continue;
          }

          const waitTime = Math.min(pollInterval * 2, 2000);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        } catch (error) {
          lastError =
            error instanceof Error ? error.message : "Unknown error";
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
        }
      }

      return {
        ready: false,
        modelsLoaded: false,
        error: lastError ?? "Timeout waiting for backend to be ready",
      };
    },
    [],
  );

  const registerWebSocketHandlers = useCallback(() => {
    if (!backendServiceRef.current) return;

    backendServiceRef.current.offMessage("detection_response");
    backendServiceRef.current.offMessage("connection");
    backendServiceRef.current.offMessage("error");

    backendServiceRef.current.onMessage(
      "detection_response",
      (data: WebSocketDetectionResponse) => {
        if (!isStreamingRef.current || !isScanningRef.current) {
          return;
        }

        if (data.frame_timestamp === undefined) {
          return;
        }

        const responseFrameTimestamp = data.frame_timestamp;
        const lastFrameTimestamp = lastFrameTimestampRef.current;

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
              skipFramesRef.current = data.suggested_skip;
            }

            if (!data.model_used) {
              return;
            }

            const detectionResult: DetectionResult = {
              faces: data.faces.map((face: WebSocketFaceData) => {
                if (!face.bbox || !Array.isArray(face.bbox) || face.bbox.length !== 4) {
                  return null;
                }

                if (face.confidence === undefined) {
                  return null;
                }

                const bbox = face.bbox;

                return {
                  bbox: {
                    x: bbox[0],
                    y: bbox[1],
                    width: bbox[2],
                    height: bbox[3],
                  },
                  confidence: face.confidence,
                  track_id: face.track_id,
                  landmarks_5: face.landmarks_5,
                  liveness: (() => {
                    if (!face.liveness) {
                      return undefined;
                    }
                    if (face.liveness.status === undefined) {
                      return undefined;
                    }
                    if (face.liveness.is_real === undefined) {
                      return undefined;
                    }
                    return {
                      is_real: face.liveness.is_real,
                      confidence: face.liveness.confidence,
                      live_score: face.liveness.live_score,
                      spoof_score: face.liveness.spoof_score,
                      status: face.liveness.status,
                      attack_type: face.liveness.attack_type,
                      message: face.liveness.message,
                    };
                  })(),
                };
              }).filter((face) => face !== null) as DetectionResult["faces"],
              model_used: data.model_used,
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
        }

        if (isScanningRef.current && isStreamingRef.current) {
          requestAnimationFrame(() => processCurrentFrameRef.current());
        }
      },
    );

    backendServiceRef.current.onMessage(
      "connection",
      (data: WebSocketConnectionMessage) => {
        if (data.status === "connected") {
          backendServiceReadyRef.current = true;
          setWebsocketStatus("connected");
        } else if (data.status === "disconnected") {
          setWebsocketStatus("disconnected");
        }
      },
    );

    backendServiceRef.current.onMessage(
      "error",
      (data: WebSocketErrorMessage) => {
        if (!isStreamingRef.current || !isScanningRef.current) {
          return;
        }

        console.error("❌ WebSocket error message:", data);
        if (data.message) {
          setError(`Detection error: ${data.message}`);
        } else {
          setError("Detection error occurred");
        }

        requestAnimationFrame(() => processCurrentFrameRef.current());
      },
    );
  }, [recognitionEnabled, performFaceRecognition]);

  const initializeWebSocket = useCallback(async () => {
    try {
      if (!backendServiceRef.current) {
        backendServiceRef.current = new BackendService();
      }

      const currentStatus = backendServiceRef.current.getWebSocketStatus();
      if (currentStatus === "connected") {
        registerWebSocketHandlers();
        return;
      }

      if (currentStatus === "connecting") {
        let attempts = 0;
        while (attempts < 50) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const status = backendServiceRef.current.getWebSocketStatus();
          if (status === "connected") {
            registerWebSocketHandlers();
            return;
          }
          if (status === "disconnected") {
            break;
          }
          attempts++;
        }
      }

      const readinessResult = await waitForBackendReady(60000, 500);

      if (!readinessResult.ready || !readinessResult.modelsLoaded) {
        const errorMessage = readinessResult.error ?? "Backend not ready: Models still loading";
        throw new Error(errorMessage);
      }

      await backendServiceRef.current.connectWebSocket();
      registerWebSocketHandlers();
    } catch (error) {
      console.error("❌ WebSocket initialization failed:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      if (!isStartingRef.current) {
        if (errorMessage.includes("Models still loading")) {
          setError(
            "AI models are still loading. Please wait a moment and try again.",
          );
        } else if (errorMessage.includes("Backend service not started")) {
          setError(
            "Backend service is not running. Please restart the application.",
          );
        } else if (errorMessage.includes("Timeout")) {
          setError(
            "Backend took too long to load models. Please check if the backend service is running.",
          );
        } else {
          setError(`Failed to connect to detection service: ${errorMessage}`);
        }
      }
      throw error;
    }
  }, [waitForBackendReady, registerWebSocketHandlers]);

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

  const startCamera = useCallback(async () => {
    try {
      const now = Date.now();
      const timeSinceLastStart = now - lastStartTimeRef.current;
      const timeSinceLastStop = now - lastStopTimeRef.current;

      if (isStartingRef.current || isStreamingRef.current) {
        return;
      }

      if (timeSinceLastStop < 100 || timeSinceLastStart < 200) {
        return;
      }

      isStartingRef.current = true;
      lastStartTimeRef.current = now;
      isStreamingRef.current = true;
      setIsStreaming(true);
      setIsVideoLoading(true);
      setError(null);

      const currentStatus = backendServiceRef.current?.getWebSocketStatus() || "disconnected";
      if (currentStatus !== "connected") {
        try {
          setError("Connecting to detection service...");
          await initializeWebSocket();
          setError(null);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          setError(`Failed to connect to detection service: ${errorMessage}`);
          isStreamingRef.current = false;
          setIsStreaming(false);
          setIsVideoLoading(false);
          setCameraActive(false);
          isStartingRef.current = false;
          return;
        }
      }

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

        frameCounterRef.current = 0;
        skipFramesRef.current = 0;
        lastFrameTimestampRef.current = 0;

        isScanningRef.current = true;
        backendServiceReadyRef.current = true;
        
        if (backendServiceRef.current?.isWebSocketReady()) {
          processCurrentFrameRef.current();
        }
      }
    } catch (err) {
      console.error("Error starting camera:", err);
      setError("Failed to start camera. Please check permissions.");
      isStreamingRef.current = false;
      isScanningRef.current = false;
      setIsStreaming(false);
      setIsVideoLoading(false);
      setCameraActive(false);
    } finally {
      isStartingRef.current = false;
    }
  }, [selectedCamera, getCameraDevices, initializeWebSocket]);

  const cleanupOnUnload = useCallback(() => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch {
            // Ignore cleanup errors
          }
        });
        streamRef.current = null;
      }

      if (videoRef.current) {
        try {
          videoRef.current.srcObject = null;
          videoRef.current.pause();
        } catch {
          // Ignore cleanup errors
        }
      }

      if (animationFrameRef.current) {
        try {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = undefined;
        } catch {
          // Ignore cleanup errors
        }
      }

      if (backendServiceRef.current) {
        try {
          const wsStatus = backendServiceRef.current.getWebSocketStatus();
          if (wsStatus === "connected" || wsStatus === "connecting") {
            backendServiceRef.current.disconnect();
          }
        } catch {
          // Ignore cleanup errors
        }
      }

      isStreamingRef.current = false;
      isScanningRef.current = false;
      isProcessingRef.current = false;
      isStartingRef.current = false;
      isStoppingRef.current = false;
      backendServiceReadyRef.current = false;
    } catch {
      // Ignore cleanup errors
    }
  }, []);

  const stopCamera = useCallback((forceCleanup: boolean = false) => {
    const now = Date.now();
    const timeSinceLastStop = now - lastStopTimeRef.current;

    if (!forceCleanup) {
      if (isStoppingRef.current || !isStreamingRef.current) {
        return;
      }

      if (timeSinceLastStop < 100) {
        return;
      }
    }

    isStoppingRef.current = true;
    lastStopTimeRef.current = now;

    isScanningRef.current = false;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore cleanup errors
        }
      });
      streamRef.current = null;
    }

    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
        if (!forceCleanup) {
          videoRef.current.pause();
        }
      } catch {
        // Ignore cleanup errors
      }
    }

    isStreamingRef.current = false;
    isProcessingRef.current = false;
    setIsStreaming(false);
    setIsVideoLoading(false);
    setCameraActive(false);

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }

    lastFrameTimestampRef.current = 0;
    lastDetectionHashRef.current = "";
    lastDetectionFrameRef.current = null;
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

    lastVideoSizeRef.current = { width: 0, height: 0 };
    lastCanvasSizeRef.current = { width: 0, height: 0 };
    scaleFactorsRef.current = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };

    const overlayCanvas = overlayCanvasRef.current;
    if (overlayCanvas) {
      const ctx = overlayCanvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
    }

    frameCounterRef.current = 0;
    skipFramesRef.current = 0;

    isStoppingRef.current = false;
  }, []);

  const getVideoRect = useCallback(() => {
    const video = videoRef.current;
    if (!video) return null;

    const now = Date.now();
    if (!videoRectRef.current || now - lastVideoRectUpdateRef.current > 200) {
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
    
    if (!overlayCanvas || !isStreaming) {
      if (overlayCanvas && overlayCanvas.width > 0 && overlayCanvas.height > 0) {
        const ctx = overlayCanvas.getContext("2d", { willReadFrequently: false });
        if (ctx) {
          ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        }
      }
      if (isStreaming) {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
      return;
    }

    if (!detectionsToRender || !detectionsToRender.faces?.length) {
      const ctx = overlayCanvas.getContext("2d", { willReadFrequently: false });
      if (ctx && overlayCanvas.width > 0 && overlayCanvas.height > 0) {
        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
      lastDetectionHashRef.current = "";
      if (isStreaming) {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
      return;
    }

    const now = performance.now();
    const recognitionForHash = currentRecognitionResults;
    let shouldRedraw = false;

    if (now - lastHashCalculationRef.current >= 16) {
      const facesCount = detectionsToRender.faces.length;
      const recognitionCount = recognitionForHash.size;
      
      let hashSum = facesCount * 1000 + recognitionCount;
      
      const sampleCount = Math.min(3, detectionsToRender.faces.length);
      for (let i = 0; i < sampleCount; i++) {
        const face = detectionsToRender.faces[i];
        hashSum += Math.round(face.bbox.x / 10) * 100;
        hashSum += Math.round(face.bbox.y / 10) * 10;
      }
      
      let recIndex = 0;
      for (const [trackId, result] of recognitionForHash) {
        if (recIndex >= 3) break;
        hashSum += trackId * 1000;
        if (result.person_id) {
          hashSum += result.person_id.length * 100;
        }
        recIndex++;
      }
      
      const simpleHash = String(hashSum);

      if (simpleHash !== lastDetectionHashRef.current) {
        lastDetectionHashRef.current = simpleHash;
        shouldRedraw = true;
        lastHashCalculationRef.current = now;
      }
    } else {
      if (detectionsToRender !== lastDetectionRef.current) {
        shouldRedraw = true;
        lastDetectionRef.current = detectionsToRender;
      }
    }

    if (shouldRedraw) {
      handleDrawOverlays();
    }

    if (isStreaming) {
      animationFrameRef.current = requestAnimationFrame(animate);
    }
  }, [
    isStreaming,
    handleDrawOverlays,
    currentDetections,
    currentRecognitionResults,
  ]);

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
  }, [setCurrentGroup]);

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

  useEffect(() => {
    calculateAngleConsistencyRef.current = calculateAngleConsistency;
  }, [calculateAngleConsistency]);

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

  const handleSelectGroup = useCallback(
    async (group: AttendanceGroup) => {
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
    },
    [setCurrentGroup],
  );

  const handleOpenSettingsForRegistration = useCallback(() => {
    setGroupInitialSection("members");
    setShowSettings(true);
  }, []);

  useEffect(() => {
    loadAttendanceDataRef.current = loadAttendanceData;
  }, [loadAttendanceData]);

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
  }, [groupToDelete, currentGroup, loadAttendanceData, setCurrentGroup]);

  const cancelDeleteGroup = useCallback(() => {
    setShowDeleteConfirmation(false);
    setGroupToDelete(null);
  }, []);

  const initializationRef = useRef<{
    initialized: boolean;
    isInitializing: boolean;
    cleanupTimeout?: NodeJS.Timeout;
  }>({ initialized: false, isInitializing: false });

  useEffect(() => {
    isStreamingRef.current = false;
    isScanningRef.current = false;
    isProcessingRef.current = false;
    isStartingRef.current = false;
    isStoppingRef.current = false;
    backendServiceReadyRef.current = false;
    setError(null);
    setIsStreaming(false);
    setIsVideoLoading(false);
    setCameraActive(false);
    setWebsocketStatus("disconnected");

    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => {
          track.stop();
        });
        streamRef.current = null;
      } catch {
        // Ignore cleanup errors
      }
    }

    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
        videoRef.current.pause();
      } catch {
        // Ignore cleanup errors
      }
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }

    if (initializationRef.current.cleanupTimeout) {
      clearTimeout(initializationRef.current.cleanupTimeout);
      initializationRef.current.cleanupTimeout = undefined;
    }

    if (backendServiceRef.current?.isWebSocketReady()) {
      registerWebSocketHandlers();
      initializationRef.current.initialized = true;
      initializationRef.current.isInitializing = false;
      return;
    }

    if (initializationRef.current.isInitializing) {
      return;
    }

    if (initializationRef.current.initialized && !backendServiceRef.current?.isWebSocketReady()) {
      initializationRef.current.initialized = false;
    }

    initializationRef.current.isInitializing = true;

    const initWebSocket = async () => {
      try {
        await initializeWebSocket();
        initializationRef.current.initialized = true;
      } catch {
        setWebsocketStatus("disconnected");
        initializationRef.current.initialized = false;
      } finally {
        initializationRef.current.isInitializing = false;
      }
    };

    initWebSocket();

    const cleanupTimeout = initializationRef.current.cleanupTimeout;
    const wasInitialized = initializationRef.current.initialized;
    const wasInitializing = initializationRef.current.isInitializing;

    return () => {
      if (cleanupTimeout) {
        clearTimeout(cleanupTimeout);
      }

      if (wasInitialized || wasInitializing) {
        if (isStreamingRef.current) {
          stopCamera(false);
        } else if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = undefined;
        }

        const initRef = initializationRef;
        setTimeout(() => {
          initRef.current.initialized = false;
          initRef.current.isInitializing = false;
        }, 50);
      }
    };
  }, [initializeWebSocket, registerWebSocketHandlers, stopCamera]);

  useEffect(() => {
    getCameraDevices();
  }, [getCameraDevices]);
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
    if (!backendServiceRef.current) return;

    const pollWebSocketStatus = () => {
      if (backendServiceRef.current) {
        const actualStatus = backendServiceRef.current.getWebSocketStatus();
        if (actualStatus !== websocketStatus) {
          setWebsocketStatus(actualStatus);
        }
      }
    };

    const statusInterval = setInterval(pollWebSocketStatus, 1000);

    return () => {
      clearInterval(statusInterval);
    };
  }, [websocketStatus]);

  useEffect(() => {
    if (
      websocketStatus === "connected" &&
      isScanningRef.current &&
      isStreamingRef.current
    ) {
      if (backendServiceRef.current?.isWebSocketReady()) {
        processCurrentFrameRef.current();
      }
    }
  }, [websocketStatus]);

  useEffect(() => {
    setCurrentRecognitionResults(new Map());
    setTrackedFaces(new Map());
    setCurrentDetections(null);

    if (isStreamingRef.current) {
      stopCamera(false);
    }
  }, [currentGroup, stopCamera]);

  useEffect(() => {
    let cleanupExecuted = false;

    const performCleanup = () => {
      if (cleanupExecuted) return;
      cleanupExecuted = true;
      cleanupOnUnload();
    };

    const handleBeforeUnload = () => {
      performCleanup();
    };

    const handlePageHide = () => {
      performCleanup();
    };

    window.addEventListener("beforeunload", handleBeforeUnload, { capture: true });
    window.addEventListener("pagehide", handlePageHide, { capture: true });
    window.addEventListener("unload", handlePageHide, { capture: true });

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload, { capture: true });
      window.removeEventListener("pagehide", handlePageHide, { capture: true });
      window.removeEventListener("unload", handlePageHide, { capture: true });
    };
  }, [cleanupOnUnload]);

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
  }, [handleSelectGroup, loadSettings, currentGroup, setCurrentGroup]);

  return (
    <div className="pt-9 pb-5 h-screen bg-black text-white flex flex-col overflow-hidden">
      {error && (
        <div className="mx-4 mt-3 bg-red-900 border border-red-600 p-3 rounded text-red-200">
          {error}
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-h-0">
          <div className="relative flex flex-1 min-h-0 items-center justify-center px-4 pt-4">
            <VideoCanvas
              videoRef={videoRef}
              canvasRef={canvasRef}
              overlayCanvasRef={overlayCanvasRef}
              quickSettings={quickSettings}
              detectionFps={detectionFps}
              isVideoLoading={isVideoLoading}
              isStreaming={isStreaming}
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

          <ControlBar
            cameraDevices={cameraDevices}
            selectedCamera={selectedCamera}
            setSelectedCamera={setSelectedCamera}
            isStreaming={isStreaming}
            startCamera={startCamera}
            stopCamera={stopCamera}
          />
        </div>

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
          onOpenSettingsForRegistration={handleOpenSettingsForRegistration}
        />
      </div>

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

      {showSettings && (
        <Settings
          onBack={() => {
            setShowSettings(false);
            setIsSettingsFullScreen(false);
            setGroupInitialSection(undefined);
            loadAttendanceData();
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
            if (updates.trackingMode !== undefined) {
              setTrackingMode(updates.trackingMode);
            }

            if (updates.enableSpoofDetection !== undefined) {
              setEnableSpoofDetection(updates.enableSpoofDetection);
              localStorage.setItem(
                "suri_enable_spoof_detection",
                String(updates.enableSpoofDetection),
              );
            }

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
          initialGroups={attendanceGroups}
        />
      )}

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
