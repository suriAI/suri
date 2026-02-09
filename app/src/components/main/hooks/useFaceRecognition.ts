import { useCallback, useRef } from "react";
import { startTransition } from "react";
import { attendanceManager } from "@/services";
import type { BackendService } from "@/services";
import type { AttendanceGroup, AttendanceMember } from "@/types/recognition";
import type { DetectionResult } from "@/components/main/types";
import type { ExtendedFaceRecognitionResponse } from "@/components/main/utils";
import {
  trimTrackingHistory,
  areRecognitionMapsEqual,
  getMemberFromCache,
} from "@/components/main/utils";
import { NON_LOGGING_ANTISPOOF_STATUSES } from "@/components/main/constants";
import {
  useDetectionStore,
  useAttendanceStore,
  useUIStore,
} from "@/components/main/stores";
import { soundEffects } from "@/services/SoundEffectsService";

interface UseFaceRecognitionOptions {
  backendServiceRef: React.RefObject<BackendService | null>;
  currentGroupRef: React.RefObject<AttendanceGroup | null>;
  memberCacheRef: React.RefObject<Map<string, AttendanceMember | null>>;
  calculateAngleConsistencyRef: React.RefObject<
    (
      history: Array<{
        timestamp: number;
        bbox: { x: number; y: number; width: number; height: number };
        confidence: number;
      }>,
    ) => number
  >;
  persistentCooldownsRef: React.RefObject<
    Map<string, import("@/components/main/types").CooldownInfo>
  >;
  loadAttendanceDataRef: React.RefObject<() => Promise<void>>;
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
  const {
    currentRecognitionResults,
    setCurrentRecognitionResults,
    setTrackedFaces,
  } = useDetectionStore();
  const { attendanceCooldownSeconds, setPersistentCooldowns } =
    useAttendanceStore();
  const { setError } = useUIStore();

  // Prevent sound spam: person+group throttling
  const lastSoundAtRef = useRef<Map<string, number>>(new Map());

  const maybePlayRecognitionSound = useCallback(
    (personId: string, groupId: string) => {
      // If this person is already "Done" (i.e., has an active cooldown entry), do not play sound.
      // This matches the UI overlay behavior and prevents repeat sounds.
      const cooldownKey = `${personId}-${groupId}`;
      const existing = persistentCooldownsRef.current?.get(cooldownKey);
      if (existing?.startTime) {
        const { reLogCooldownSeconds } = useAttendanceStore.getState();
        const reLogCooldownMs = (reLogCooldownSeconds ?? 1800) * 1000;
        const now = Date.now();
        if (now - existing.startTime < reLogCooldownMs) {
          return;
        }
      }

      const { audioSettings } = useUIStore.getState();
      if (!audioSettings.recognitionSoundEnabled) return;
      if (!audioSettings.recognitionSoundUrl) return;

      const soundKey = cooldownKey;
      const now = Date.now();
      const lastAt = lastSoundAtRef.current.get(soundKey) ?? 0;

      // ~1.2s throttle feels instant but avoids per-frame repeats
      if (now - lastAt <= 1200) return;
      lastSoundAtRef.current.set(soundKey, now);

      soundEffects.play(audioSettings.recognitionSoundUrl).catch(() => { });
    },
    [persistentCooldownsRef],
  );

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
              currentGroupValue.id,
              face.landmarks_5,
            );

            if (response.success && response.person_id) {
              // Fire sound ASAP: do not wait on member fetch / attendance logging
              // (spoofed faces are already filtered earlier)
              maybePlayRecognitionSound(
                response.person_id,
                currentGroupValue.id,
              );

              const memberResult = await getMemberFromCache(
                response.person_id,
                currentGroupValue,
                memberCacheRef,
              );

              if (!memberResult) {
                return null;
              }

              const { memberName } = memberResult;
              const trackIdStr = `track_${face.track_id}`; // Unified track ID format
              const currentTime = Date.now();

              startTransition(() => {
                setTrackedFaces((prev) => {
                  const newTracked = new Map(prev);
                  const currentLivenessStatus = face.liveness?.status;
                  const existingTrack = newTracked.get(trackIdStr);

                  if (existingTrack) {
                    existingTrack.lastSeen = currentTime;
                    // Keep existing confidence if it's higher (standard tracking update)
                    // But if this is a fresh recognition, maybe we should take the new one?
                    // Let's stick to update logic:
                    existingTrack.confidence = face.confidence; // Update with current confidence
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
                      calculateAngleConsistencyRef.current?.(
                        existingTrack.trackingHistory,
                      ) ?? 1.0;
                    existingTrack.livenessStatus = currentLivenessStatus;

                    // RE-BIND IDENTITY (Just in case it was lost/reset, though unlikely here)
                    existingTrack.personId = response.person_id ?? undefined;

                    newTracked.set(existingTrack.id, existingTrack);
                  } else {
                    newTracked.set(trackIdStr, {
                      id: trackIdStr,
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
                      isLocked: true,
                      personId: response.person_id ?? undefined,
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
                    const actualConfidence = face.confidence;

                    // trackingMode check removed - always auto
                    const currentTime = Date.now();
                    // Scoped Cooldown Key: personId + groupId
                    // This ensures a student is only "blocked" for this specific class.
                    // If they go to another class (different Group ID), they are fresh.
                    const cooldownKey = `${response.person_id}-${currentGroupValue.id}`;
                    const cooldownInfo =
                      persistentCooldownsRef.current.get(cooldownKey);
                    const authoritativeTimestamp = cooldownInfo?.startTime || 0;
                    const timeSinceLastAttendance =
                      currentTime - authoritativeTimestamp;
                    const storedCooldownSeconds =
                      cooldownInfo?.cooldownDurationSeconds ??
                      attendanceCooldownSeconds;
                    const storedCooldownMs = storedCooldownSeconds * 1000;

                    // "Visual" cooldown check (15s default)
                    // If within visual cooldown, update bbox but DO NOT LOG
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
                            (
                              persistentCooldownsRef as React.RefObject<
                                Map<
                                  string,
                                  import("@/components/main/types").CooldownInfo
                                >
                              >
                            ).current = newPersistent;
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

                    // "Re-Log" cooldown check (30m default) - SPAM PROOFING
                    // We need to fetch the reLogCooldownSeconds from store or use default
                    const { reLogCooldownSeconds } =
                      useAttendanceStore.getState();

                    const reLogCooldownMs =
                      (reLogCooldownSeconds ?? 1800) * 1000;

                    const existingInState =
                      persistentCooldownsRef.current?.get(cooldownKey);

                    const lastLogTime = existingInState?.startTime || 0;
                    const timeSinceLastLog = Date.now() - lastLogTime;

                    // If the user is trying to log again, check if they are within the "Session Window" (30 mins)
                    // If so, we treat it like a "Visual Cooldown" extension - we update bbox, but we DO NOT create a new event.
                    if (existingInState && timeSinceLastLog < reLogCooldownMs) {
                      // Update "last known" so the overlay follows them, but DO NOT fire logging event
                      startTransition(() => {
                        setPersistentCooldowns((prev) => {
                          const newPersistent = new Map(prev);
                          const existing = newPersistent.get(cooldownKey);
                          if (existing) {
                            // We just update the bbox to keep the "Done" overlay tracking them
                            // We do NOT update startTime, because we want the 30min timer to keep ticking from the FIRST log.
                            newPersistent.set(cooldownKey, {
                              ...existing,
                              memberName: memberName,
                              lastKnownBbox: face.bbox,
                            });
                            (
                              persistentCooldownsRef as React.RefObject<
                                Map<
                                  string,
                                  import("@/components/main/types").CooldownInfo
                                >
                              >
                            ).current = newPersistent;
                            return newPersistent;
                          }
                          return prev;
                        });
                      });

                      // Return early - NO NEW LOG sent to backend
                      return {
                        trackId,
                        result: { ...response, name: memberName, memberName },
                      };
                    }

                    // If we passed both checks, it is a legitimate NEW session log.
                    const logTime = Date.now();

                    const existingCooldownSeconds =
                      existingInState?.cooldownDurationSeconds ??
                      attendanceCooldownSeconds; // Uses the destructured variable from above
                    const existingCooldownMs = existingCooldownSeconds * 1000;

                    const existingInStateStillActive =
                      existingInState &&
                      logTime - existingInState.startTime < existingCooldownMs;

                    if (!existingInStateStillActive) {
                      startTransition(() => {
                        setPersistentCooldowns((prev) => {
                          const newPersistent = new Map(prev);
                          const cooldownData = {
                            personId: response.person_id!,
                            startTime: logTime,
                            memberName: memberName,
                            lastKnownBbox: face.bbox,
                            cooldownDurationSeconds: attendanceCooldownSeconds,
                          };
                          newPersistent.set(cooldownKey, cooldownData);
                          (
                            persistentCooldownsRef as React.RefObject<
                              Map<
                                string,
                                import("@/components/main/types").CooldownInfo
                              >
                            >
                          ).current = newPersistent;
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
                            (
                              persistentCooldownsRef as React.RefObject<
                                Map<
                                  string,
                                  import("@/components/main/types").CooldownInfo
                                >
                              >
                            ).current = newPersistent;
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
              // "Unknown" response - BUT check if we have memory of this track!
              const trackIdStr = `track_${face.track_id}`; // Unified track ID format (was unknown_track_)
              const currentTime = Date.now();

              // Check store for existing identity
              const existingTrack = useDetectionStore.getState().trackedFaces.get(trackIdStr);
              const knownPersonId = existingTrack?.personId;

              // If we know who this is, recover the identity!
              let recoveredMemberName = "";
              let recoveredPersonId: string | null = null;

              if (knownPersonId) {
                const member = await getMemberFromCache(
                  knownPersonId,
                  currentGroupValue,
                  memberCacheRef
                );
                if (member) {
                  recoveredMemberName = member.memberName;
                  recoveredPersonId = knownPersonId;
                }
              }

              if (recoveredPersonId) {
                // ** MEMORY HIT **
                // Treat this exactly like a successful recognition

                // Update track state
                startTransition(() => {
                  setTrackedFaces((prev) => {
                    const newTracked = new Map(prev);
                    const track = newTracked.get(trackIdStr);
                    if (track) {
                      track.lastSeen = currentTime;
                      track.confidence = face.confidence;
                      track.trackingHistory.push({
                        timestamp: currentTime,
                        bbox: face.bbox,
                        confidence: face.confidence,
                      });
                      track.trackingHistory = trimTrackingHistory(track.trackingHistory);
                      // Keep occlusion/angle logic...
                      newTracked.set(trackIdStr, track);
                    }
                    return newTracked;
                  });
                });

                // Return SUCCESS result to UI so it stays Green
                // (We can optionally mark it as "memory" if we want UI to know)
                return {
                  trackId,
                  result: {
                    success: true,
                    person_id: recoveredPersonId,
                    similarity: 0.99, // Fake high similarity to keep it solid
                    processing_time: 0,
                    name: recoveredMemberName,
                    memberName: recoveredMemberName,
                    error: null,
                  },
                };

              } else {
                // ** TRUE UNKNOWN **
                startTransition(() => {
                  setTrackedFaces((prev) => {
                    const newTracked = new Map(prev);
                    // Create new track with NO identity
                    newTracked.set(trackIdStr, {
                      id: trackIdStr,
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
                  person_id: null,
                  similarity: 0,
                  processing_time: 0,
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
    [
      attendanceCooldownSeconds,
      attendanceEnabled,
      backendServiceRef,
      calculateAngleConsistencyRef,
      currentGroupRef,
      loadAttendanceDataRef,
      memberCacheRef,
      maybePlayRecognitionSound,
      persistentCooldownsRef,
      setCurrentRecognitionResults,
      setError,
      setPersistentCooldowns,
      setTrackedFaces,
    ],
  );

  return {
    currentRecognitionResults,
    setCurrentRecognitionResults,
    performFaceRecognition,
  };
}
