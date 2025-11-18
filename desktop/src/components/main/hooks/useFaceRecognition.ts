import { useCallback } from "react";
import { startTransition } from "react";
import { attendanceManager } from "../../../services/AttendanceManager";
import type { BackendService } from "../../../services/BackendService";
import type { AttendanceGroup, AttendanceMember } from "../../../types/recognition";
import type { DetectionResult } from "../types";
import type { ExtendedFaceRecognitionResponse } from "../utils/recognitionHelpers";
import { trimTrackingHistory, areRecognitionMapsEqual } from "../utils/recognitionHelpers";
import { NON_LOGGING_ANTISPOOF_STATUSES } from "../constants";
import { getMemberFromCache } from "../utils/memberCacheHelpers";
import { useDetectionStore } from "../stores/detectionStore";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useUIStore } from "../stores/uiStore";

interface UseFaceRecognitionOptions {
  backendServiceRef: React.MutableRefObject<BackendService | null>;
  currentGroupRef: React.MutableRefObject<AttendanceGroup | null>;
  memberCacheRef: React.MutableRefObject<Map<string, AttendanceMember | null>>;
  calculateAngleConsistencyRef: React.MutableRefObject<
    (
      history: Array<{
        timestamp: number;
        bbox: { x: number; y: number; width: number; height: number };
        confidence: number;
      }>,
    ) => number
  >;
  persistentCooldownsRef: React.MutableRefObject<Map<string, import("../types").CooldownInfo>>;
  loadAttendanceDataRef: React.MutableRefObject<() => Promise<void>>;
}

export function useFaceRecognition(options: UseFaceRecognitionOptions) {
  const {
    backendServiceRef,
    currentGroupRef,
    memberCacheRef,
    calculateAngleConsistencyRef,
    persistentCooldownsRef,
    loadAttendanceDataRef,
  } = options;

  // Zustand stores
  const { currentRecognitionResults, setCurrentRecognitionResults, setTrackedFaces } = useDetectionStore();
  const { trackingMode, attendanceCooldownSeconds, setPersistentCooldowns } = useAttendanceStore();
  const { setError } = useUIStore();
  
  const attendanceEnabled = true;

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
              const memberResult = await getMemberFromCache(
                response.person_id,
                currentGroupValue,
                memberCacheRef
              );

              if (!memberResult) {
                return null;
              }

              const { memberName } = memberResult;

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
                            const cooldownData = {
                              personId: response.person_id!,
                              startTime: logTime,
                              memberName: memberName,
                              lastKnownBbox: face.bbox,
                              cooldownDurationSeconds:
                                attendanceCooldownSeconds,
                            };
                            newPersistent.set(cooldownKey, cooldownData);
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
    [trackingMode, attendanceCooldownSeconds, attendanceEnabled, backendServiceRef, calculateAngleConsistencyRef, currentGroupRef, loadAttendanceDataRef, memberCacheRef, persistentCooldownsRef, setCurrentRecognitionResults, setError, setPersistentCooldowns, setTrackedFaces],
  );

  return {
    currentRecognitionResults,
    setCurrentRecognitionResults,
    performFaceRecognition,
  };
}

