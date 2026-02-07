import { useEffect, useRef, useCallback, lazy, Suspense } from "react";
const Settings = lazy(() =>
  import("@/components/settings").then((module) => ({
    default: module.Settings,
  })),
);
import { attendanceManager, BackendService } from "@/services";
import {
  useStreamState,
  useAttendanceCooldown,
  useVideoStream,
  useOverlayRendering,
  useFaceDetection,
  useFaceRecognition,
  useFaceTracking,
  useAttendanceGroups,
  useBackendService,
  useCameraControl,
} from "@/components/main/hooks";
import {
  cleanupStream,
  cleanupVideo,
  cleanupAnimationFrame,
  resetLastDetectionRef,
} from "@/components/main/utils";
import {
  useCameraStore,
  useDetectionStore,
  useAttendanceStore,
  useUIStore,
} from "@/components/main/stores";

import { ControlBar } from "@/components/main/components/ControlBar";
import { VideoCanvas } from "@/components/main/components/VideoCanvas";
import { Sidebar } from "@/components/main/components/Sidebar";
import { GroupManagementModal } from "@/components/main/components/GroupManagementModal";
import { DeleteConfirmationModal } from "@/components/main/components/DeleteConfirmationModal";
import { CooldownOverlay } from "@/components/main/components/CooldownOverlay";
import type { DetectionResult } from "@/components/main/types";
import { colorClasses } from "@/constants/colors";
import { soundEffects } from "@/services/SoundEffectsService";

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

  const lastDetectionRef = useRef<DetectionResult | null>(null);
  const lastFrameTimestampRef = useRef<number>(0);
  const processCurrentFrameRef = useRef<() => Promise<void>>(async () => { });
  const fpsTrackingRef = useRef({
    timestamps: [] as number[],
    maxSamples: 10,
    lastUpdateTime: Date.now(),
  });

  const backendServiceReadyRef = useRef(false);
  const isScanningRef = useRef(false);
  const videoRectRef = useRef<DOMRect | null>(null);
  const lastVideoRectUpdateRef = useRef<number>(0);

  const {
    isStreaming,
    isVideoLoading,
    setIsStreaming,
    setIsVideoLoading,
    setCameraActive,
    cameraDevices,
    selectedCamera,
    setSelectedCamera,
  } = useCameraStore();

  const {
    currentDetections,
    detectionFps,
    setDetectionFps,
    trackedFaces,
    currentRecognitionResults: rawCurrentRecognitionResults,
  } = useDetectionStore();

  const {
    currentGroup,
    setCurrentGroup,
    attendanceGroups,
    showGroupManagement,
    setShowGroupManagement,
    showDeleteConfirmation,
    groupToDelete,
    newGroupName,
    setNewGroupName,
    // trackingMode removed
    attendanceCooldownSeconds,
    setAttendanceCooldownSeconds,
    reLogCooldownSeconds,
    setReLogCooldownSeconds,
    enableSpoofDetection,
    setEnableSpoofDetection,
    persistentCooldowns,
  } = useAttendanceStore();

  const {
    error,
    setError,
    warning,
    setWarning,
    showSettings,
    setShowSettings,
    isSettingsFullScreen,
    setIsSettingsFullScreen,
    groupInitialSection,
    setGroupInitialSection,
    settingsInitialSection,
    setSettingsInitialSection,
    quickSettings,
    setQuickSettings,
    audioSettings,
    setAudioSettings,
    setSidebarCollapsed,
  } = useUIStore();

  const recognitionEnabled = true;

  // Preload sound to minimize delay on first recognition
  useEffect(() => {
    if (
      audioSettings.recognitionSoundEnabled &&
      audioSettings.recognitionSoundUrl
    ) {
      soundEffects.preload(audioSettings.recognitionSoundUrl);
    }
  }, [
    audioSettings.recognitionSoundEnabled,
    audioSettings.recognitionSoundUrl,
  ]);

  const currentRecognitionResults =
    rawCurrentRecognitionResults instanceof Map
      ? rawCurrentRecognitionResults
      : new Map();

  // 1. Stream State Hook
  useStreamState({
    isProcessingRef,
    animationFrameRef,
    isScanningRef,
    isStreamingRef,
    isStartingRef,
    isStoppingRef,
    lastStartTimeRef,
    lastStopTimeRef,
  });

  // 2. Attendance Cooldown Hook
  const { persistentCooldownsRef } = useAttendanceCooldown();

  // 3. Face Tracking Hook
  const { calculateAngleConsistencyRef } = useFaceTracking();

  // 4. Attendance Groups Hook
  const {
    currentGroupRef,
    memberCacheRef,
    loadAttendanceDataRef,
    handleSelectGroup,
    handleCreateGroup,
    handleDeleteGroup,
    confirmDeleteGroup,
    cancelDeleteGroup,
  } = useAttendanceGroups();

  // 5. Video Stream Hook
  const { captureFrame, getCameraDevices } = useVideoStream({
    videoRef,
    canvasRef,
    isStreamingRef,
    isScanningRef,
    videoRectRef,
    lastVideoRectUpdateRef,
    isStartingRef,
  });

  // 6. Face Detection Hook
  useFaceDetection({
    backendServiceRef,
    isScanningRef,
    isStreamingRef,
    captureFrame,
    lastDetectionFrameRef,
    frameCounterRef,
    skipFramesRef,
    lastFrameTimestampRef,
    lastDetectionRef,
    processCurrentFrameRef,
    fpsTrackingRef,
  });

  // 7. Face Recognition Hook
  const { performFaceRecognition } = useFaceRecognition({
    backendServiceRef,
    currentGroupRef,
    memberCacheRef,
    calculateAngleConsistencyRef,
    persistentCooldownsRef,
    loadAttendanceDataRef,
  });

  const { animate, resetOverlayRefs } =
    useOverlayRendering({
      videoRef,
      overlayCanvasRef,
      animationFrameRef,
      videoRectRef,
      lastVideoRectUpdateRef,
    });

  // 9. Backend Service Hook
  const stopCameraRef = useRef<((forceCleanup: boolean) => void) | null>(null);

  const { initializeWebSocket } = useBackendService({
    backendServiceRef,
    isStreamingRef,
    isScanningRef,
    isStartingRef,
    performFaceRecognition,
    lastDetectionFrameRef,
    lastFrameTimestampRef,
    lastDetectionRef,
    fpsTrackingRef,
    skipFramesRef,
    processCurrentFrameRef,
    stopCamera: stopCameraRef,
    animationFrameRef,
    streamRef,
    videoRef,
    backendServiceReadyRef,
  });

  // 9. Camera Control Hook
  const { startCamera, stopCamera } = useCameraControl({
    videoRef,
    streamRef,
    animationFrameRef,
    backendServiceRef,
    isStreamingRef,
    isScanningRef,
    isStartingRef,
    isStoppingRef,
    lastStartTimeRef,
    lastStopTimeRef,
    frameCounterRef,
    skipFramesRef,
    lastFrameTimestampRef,
    lastDetectionRef,
    lastDetectionFrameRef,
    fpsTrackingRef,
    backendServiceReadyRef,
    processCurrentFrameRef,
    resetOverlayRefs,
    overlayCanvasRef,
    setIsStreaming,
    setIsVideoLoading,
    setCameraActive,
    setSelectedCamera,
    setDetectionFps,
    setError,
    selectedCamera,
    cameraDevices,
    initializeWebSocket,
    getCameraDevices,
  });

  const requestGroupSelection = useCallback(() => {
    setSidebarCollapsed(false);

    if (attendanceGroups.length === 0) {
      setError("Create a group to start tracking.");
      setShowGroupManagement(true);
      return;
    }

    setError("Select a group from the sidebar to start tracking.");
  }, [
    attendanceGroups.length,
    setError,
    setShowGroupManagement,
    setSidebarCollapsed,
  ]);

  const startCameraGuarded = useCallback(() => {
    if (!currentGroup) {
      requestGroupSelection();
      return;
    }
    startCamera();
  }, [currentGroup, requestGroupSelection, startCamera]);

  // Handle start time changes from inline chip
  const handleStartTimeChange = useCallback(
    async (newTime: string) => {
      if (!currentGroup) return;

      try {
        const updatedSettings = {
          ...currentGroup.settings,
          class_start_time: newTime,
        };
        await attendanceManager.updateGroup(currentGroup.id, {
          settings: updatedSettings,
        });
        setCurrentGroup({
          ...currentGroup,
          settings: updatedSettings,
        });
      } catch (error) {
        console.error("Failed to update start time:", error);
      }
    },
    [currentGroup, setCurrentGroup],
  );

  // Set the ref after stopCamera is defined
  useEffect(() => {
    stopCameraRef.current = stopCamera;
  }, [stopCamera]);

  const cleanupOnUnload = useCallback(() => {
    try {
      cleanupStream(streamRef);
      cleanupVideo(videoRef, true);
      cleanupAnimationFrame(animationFrameRef);

      if (backendServiceRef.current) {
        try {
          const wsStatus = backendServiceRef.current.getWebSocketStatus();
          if (wsStatus === "connected" || wsStatus === "connecting") {
            backendServiceRef.current.disconnect();
          }
        } catch {
          // Ignore disconnect errors
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



  // ===== REMAINING USEEFFECTS =====

  // Animation loop
  useEffect(() => {
    if (isStreaming) {
      animate();
    }
    return () => {
      cleanupAnimationFrame(animationFrameRef);
    };
  }, [isStreaming, animate]);

  // Group change reset
  useEffect(() => {
    resetLastDetectionRef(lastDetectionRef);
    useDetectionStore.getState().resetDetectionState();

    if (isStreamingRef.current) {
      stopCamera(false);
    }
  }, [currentGroup, stopCamera, isStreamingRef, lastDetectionRef]);

  // Cleanup on unload
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

    window.addEventListener("beforeunload", handleBeforeUnload, {
      capture: true,
    });
    window.addEventListener("pagehide", handlePageHide, { capture: true });

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload, {
        capture: true,
      });
      window.removeEventListener("pagehide", handlePageHide, { capture: true });
    };
  }, [cleanupOnUnload]);

  // Listen for openSettings event (e.g., from WindowFooter update notification)
  useEffect(() => {
    const handleOpenSettings = (event: CustomEvent<{ section?: string }>) => {
      const section = event.detail?.section;
      if (section) {
        setSettingsInitialSection(section);
        setGroupInitialSection(undefined);
      }
      setShowSettings(true);
    };

    window.addEventListener(
      "openSettings",
      handleOpenSettings as EventListener,
    );

    return () => {
      window.removeEventListener(
        "openSettings",
        handleOpenSettings as EventListener,
      );
    };
  }, [setShowSettings, setGroupInitialSection, setSettingsInitialSection]);

  // Listen for system clock warnings emitted by AttendanceManager
  useEffect(() => {
    const handleClockWarning = (event: CustomEvent<{ message?: string }>) => {
      const message = event.detail?.message;
      if (message) {
        setWarning(message);
      }
    };

    window.addEventListener(
      "suri:clock-warning",
      handleClockWarning as unknown as EventListener,
    );

    return () => {
      window.removeEventListener(
        "suri:clock-warning",
        handleClockWarning as unknown as EventListener,
      );
    };
  }, [setWarning]);

  // Handle auto-pause on minimize
  const wasStreamingBeforeMinimize = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electron = (window as any).suriElectron;
    if (!electron) return;

    const cleanupMinimize = electron.onMinimize(() => {
      if (isStreamingRef.current) {
        wasStreamingBeforeMinimize.current = true;
        stopCamera(false); // Pause tracking
        console.log("App minimized: Pausing tracking...");
      } else {
        wasStreamingBeforeMinimize.current = false;
      }
    });

    const cleanupRestore = electron.onRestore(() => {
      if (wasStreamingBeforeMinimize.current) {
        console.log("App restored: Resuming tracking...");
        startCameraGuarded();
        wasStreamingBeforeMinimize.current = false;
      }
    });

    return () => {
      if (cleanupMinimize) cleanupMinimize();
      if (cleanupRestore) cleanupRestore();
    };
  }, [stopCamera, startCameraGuarded]);

  // ===== RENDER =====
  return (
    <div className="h-full bg-black text-white flex flex-col overflow-hidden">
      {warning && (
        <div
          className={`mx-4 mt-3 ${colorClasses.warningBg} border ${colorClasses.warningBorder} p-3 rounded-lg flex items-start justify-between gap-4`}
        >
          <div className="text-sm leading-relaxed">
            <span className={`${colorClasses.warning} font-semibold`}>
              Warning:
            </span>{" "}
            <span className="text-white/80">{warning}</span>
          </div>
          <button
            type="button"
            onClick={() => setWarning(null)}
            className="text-white/60 hover:text-white/90 transition-colors"
            aria-label="Dismiss warning"
            title="Dismiss"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
      )}

      {error && (
        <div className="mx-4 mt-3 bg-red-900/60 border border-red-600/70 p-3 rounded-lg text-red-100 flex items-start justify-between gap-4">
          <div className="text-sm leading-relaxed">{error}</div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-100/70 hover:text-red-100 transition-colors"
            aria-label="Dismiss error"
            title="Dismiss"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
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
              hasSelectedGroup={Boolean(currentGroup)}
            // trackingMode removed

            />

            {/* New Cooldown Overlay */}
            <CooldownOverlay
              // trackingMode removed
              persistentCooldowns={persistentCooldowns}
              attendanceCooldownSeconds={attendanceCooldownSeconds}
            />
          </div>

          <ControlBar
            cameraDevices={cameraDevices}
            selectedCamera={selectedCamera}
            setSelectedCamera={setSelectedCamera}
            isStreaming={isStreaming}
            startCamera={startCameraGuarded}
            stopCamera={stopCamera}
            hasSelectedGroup={Boolean(currentGroup)}
            requestGroupSelection={requestGroupSelection}
            lateTrackingEnabled={
              (currentGroup?.settings as { late_threshold_enabled?: boolean })
                ?.late_threshold_enabled ?? false
            }
            classStartTime={currentGroup?.settings?.class_start_time ?? "08:00"}
            onStartTimeChange={handleStartTimeChange}
          />
        </div>

        <Sidebar
          currentDetections={currentDetections}
          currentRecognitionResults={currentRecognitionResults}
          recognitionEnabled={recognitionEnabled}
          trackedFaces={trackedFaces}
          isStreaming={isStreaming}
          isVideoLoading={isVideoLoading}
          // persistentCooldowns and attendanceCooldownSeconds removed from here
          // handleSelectGroup kept
          handleSelectGroup={handleSelectGroup}
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
        <Suspense
          fallback={
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 border-4 border-white/10 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-cyan-400 rounded-full border-t-transparent animate-spin"></div>
              </div>
            </div>
          }
        >
          <Settings
            onBack={() => {
              setShowSettings(false);
              setIsSettingsFullScreen(false);
              setGroupInitialSection(undefined);
              setSettingsInitialSection(undefined);
              loadAttendanceDataRef.current();
            }}
            isFullScreen={isSettingsFullScreen}
            onToggleFullScreen={() =>
              setIsSettingsFullScreen(!isSettingsFullScreen)
            }
            isModal={true}
            quickSettings={quickSettings}
            onQuickSettingsChange={setQuickSettings}
            audioSettings={audioSettings}
            onAudioSettingsChange={setAudioSettings}
            attendanceSettings={{
              // trackingMode removed
              lateThresholdEnabled:
                (currentGroup?.settings as { late_threshold_enabled?: boolean })
                  ?.late_threshold_enabled ?? false,
              lateThresholdMinutes:
                currentGroup?.settings?.late_threshold_minutes ?? 15,
              classStartTime:
                currentGroup?.settings?.class_start_time ?? "08:00",
              attendanceCooldownSeconds: attendanceCooldownSeconds,
              reLogCooldownSeconds: reLogCooldownSeconds,
              enableSpoofDetection: enableSpoofDetection,
            }}
            onAttendanceSettingsChange={async (updates) => {
              // trackingMode update logic removed

              if (updates.enableSpoofDetection !== undefined) {
                setEnableSpoofDetection(updates.enableSpoofDetection);
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

              if (updates.reLogCooldownSeconds !== undefined) {
                setReLogCooldownSeconds(updates.reLogCooldownSeconds);
                try {
                  await attendanceManager.updateSettings({
                    relog_cooldown_seconds: updates.reLogCooldownSeconds,
                  });
                } catch (error) {
                  console.error(
                    "Failed to update re-log cooldown setting:",
                    error,
                  );
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
            initialSection={settingsInitialSection}
            currentGroup={currentGroup}
            onGroupSelect={handleSelectGroup}
            onGroupsChanged={() => loadAttendanceDataRef.current()}
            initialGroups={attendanceGroups}
          />
        </Suspense>
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
