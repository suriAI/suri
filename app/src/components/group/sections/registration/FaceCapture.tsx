import { useState, useEffect, useMemo, useCallback } from "react";
import { useGroupUIStore } from "../../stores";
import type {
  AttendanceGroup,
  AttendanceMember,
} from "../../../../types/recognition.js";
import { useCamera } from "../registration/hooks/useCamera";
import { useFaceCapture } from "../registration/hooks/useFaceCapture";
import { CaptureControls } from "./components/CaptureControls";
import { CameraFeed } from "./components/CameraFeed";
import { UploadArea } from "./components/UploadArea";
import { MemberSidebar } from "./components/MemberSidebar";
import { ResultView } from "./components/ResultView";

interface FaceCaptureProps {
  group: AttendanceGroup;
  members: AttendanceMember[];
  onRefresh: () => void;
  initialSource?: "live" | "upload";
  deselectMemberTrigger?: number;
  onSelectedMemberChange?: (hasSelectedMember: boolean) => void;
}

type CaptureSource = "live" | "upload";

export function FaceCapture({
  group,
  members,
  onRefresh,
  initialSource,
  deselectMemberTrigger,
  onSelectedMemberChange,
}: FaceCaptureProps) {
  // Store integration
  const preSelectedId = useGroupUIStore((state) => state.preSelectedMemberId);

  // --- View State ---
  const [source, setSource] = useState<CaptureSource>(
    initialSource ?? "upload",
  );
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [registrationFilter, setRegistrationFilter] = useState<
    "all" | "registered" | "non-registered"
  >("all");
  const [memberStatus, setMemberStatus] = useState<Map<string, boolean>>(
    new Map(),
  );

  // Handle pre-selection from deep links
  useEffect(() => {
    if (preSelectedId) {
      setSelectedMemberId(preSelectedId);
    }
  }, [preSelectedId]);

  // --- Hooks ---
  const {
    videoRef,
    isStreaming,
    isVideoReady,
    cameraError,
    cameraDevices,
    selectedCamera,
    setSelectedCamera,
    startCamera,
    stopCamera,
  } = useCamera();

  const loadStatus = useCallback(async () => {
    const status = new Map<string, boolean>();
    for (const member of members) {
      status.set(member.person_id, !!member.has_face_data);
    }
    setMemberStatus(status);
  }, [members]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const {
    frames,
    isRegistering,
    successMessage,
    globalError,
    setSuccessMessage,
    setGlobalError,
    captureProcessedFrame,
    handleRegister,
    handleRemoveFaceData,
    resetFrames,
  } = useFaceCapture(group, members, onRefresh);

  const framesReady = frames.length > 0;

  // --- Lifecycle & Sync ---
  useEffect(() => {
    if (onSelectedMemberChange) {
      onSelectedMemberChange(!!selectedMemberId);
    }
  }, [selectedMemberId, onSelectedMemberChange]);

  useEffect(() => {
    if (deselectMemberTrigger) {
      setSelectedMemberId("");
    }
  }, [deselectMemberTrigger]);

  // --- Handlers ---
  const handleCaptureFromCamera = useCallback(() => {
    if (!videoRef.current || !selectedMemberId) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0);
    const url = canvas.toDataURL("image/jpeg", 0.95);
    captureProcessedFrame("Front", url, canvas.width, canvas.height);
  }, [videoRef, selectedMemberId, captureProcessedFrame]);

  const handleWrapperRegister = useCallback(async () => {
    if (!selectedMemberId) return;
    await handleRegister(selectedMemberId, loadStatus, memberStatus);
  }, [selectedMemberId, handleRegister, loadStatus, memberStatus]);

  const handleWrapperRemoveData = useCallback(
    async (member: AttendanceMember) => {
      await handleRemoveFaceData(member, loadStatus);
    },
    [handleRemoveFaceData, loadStatus],
  );

  const resetWorkflow = useCallback(() => {
    resetFrames();
    if (source === "live") {
      startCamera();
    }
  }, [resetFrames, source, startCamera]);

  const selectedMemberName = useMemo(() => {
    const m = members.find((m) => m.person_id === selectedMemberId);
    return m ? m.name || "Member" : "";
  }, [members, selectedMemberId]);

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      {/* Messages */}
      {successMessage && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 rounded-[1.5rem] border border-cyan-500/30 bg-black/80 backdrop-blur-xl p-5 text-sm text-cyan-200 flex flex-col items-center gap-4 min-w-[400px] max-w-[95%] intro-y shadow-[0_20px_50px_rgba(0,0,0,0.5)] border-b-cyan-500/50">
          <div className="w-12 h-12 rounded-2xl bg-cyan-500/20 flex items-center justify-center mb-1">
            <i className="fa-solid fa-check-double text-xl text-cyan-400"></i>
          </div>
          <div className="text-center">
            <h4 className="text-base font-black text-white mb-1">Success</h4>
            <p className="text-xs text-cyan-200/60 font-medium">
              {successMessage}
            </p>
          </div>

          <div className="flex items-center gap-2 w-full pt-1">
            <button
              onClick={() => {
                setSuccessMessage(null);
                useGroupUIStore.getState().setActiveSection("reports");
              }}
              className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 text-[10px] font-black uppercase tracking-widest transition-all"
            >
              See results
            </button>
            <button
              onClick={() => {
                setSuccessMessage(null);
                setSelectedMemberId("");
                resetFrames();
              }}
              className="flex-1 px-4 py-2.5 rounded-xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/30 text-[10px] font-black uppercase tracking-widest transition-all"
            >
              Next person
            </button>
          </div>

          <button
            onClick={() => setSuccessMessage(null)}
            className="absolute top-4 right-4 text-white/20 hover:text-white transition-colors"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
      )}

      {globalError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 rounded-[1.5rem] border border-red-500/30 bg-black/80 backdrop-blur-xl p-5 text-sm text-red-200 flex flex-col items-center gap-4 min-w-[400px] max-w-[95%] intro-y shadow-[0_20px_50px_rgba(239,68,68,0.2)]">
          <div className="w-12 h-12 rounded-2xl bg-red-500/20 flex items-center justify-center mb-1">
            <i className="fa-solid fa-triangle-exclamation text-xl text-red-400"></i>
          </div>
          <div className="text-center">
            <h4 className="text-base font-black text-white mb-1">
              Something went wrong
            </h4>
            <p className="text-xs text-red-200/60 font-medium">{globalError}</p>
          </div>

          <button
            onClick={() => setGlobalError(null)}
            className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 text-[10px] font-black uppercase tracking-widest transition-all mt-2"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex-1 overflow-hidden min-h-0">
        {!selectedMemberId && (
          <MemberSidebar
            members={members}
            memberStatus={memberStatus}
            selectedMemberId={selectedMemberId}
            onSelectMember={setSelectedMemberId}
            memberSearch={memberSearch}
            setMemberSearch={setMemberSearch}
            registrationFilter={registrationFilter}
            setRegistrationFilter={setRegistrationFilter}
            onRemoveFaceData={handleWrapperRemoveData}
          />
        )}

        {selectedMemberId && (
          <div className="flex flex-col h-full overflow-hidden p-6 space-y-2">
            <div className="flex-1 min-h-0 flex flex-col space-y-4 overflow-hidden">
              <CaptureControls
                source={source}
                setSource={setSource}
                hasRequiredFrame={!!framesReady}
                cameraDevices={cameraDevices}
                selectedCamera={selectedCamera}
                setSelectedCamera={setSelectedCamera}
                isStreaming={isStreaming}
                stopCamera={stopCamera}
              />

              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                {!framesReady ? (
                  source === "live" ? (
                    <CameraFeed
                      videoRef={videoRef}
                      isStreaming={isStreaming}
                      isVideoReady={isVideoReady}
                      cameraError={cameraError}
                      onCapture={handleCaptureFromCamera}
                      onStart={startCamera}
                      onStop={stopCamera}
                      source={source}
                      isCameraSelected={!!selectedCamera}
                    />
                  ) : (
                    <UploadArea
                      onFileProcessed={(url: string, w: number, h: number) =>
                        captureProcessedFrame("Front", url, w, h)
                      }
                      onError={setGlobalError}
                    />
                  )
                ) : (
                  <ResultView
                    frames={frames}
                    selectedMemberName={selectedMemberName}
                    onRetake={resetWorkflow}
                    onRegister={handleWrapperRegister}
                    isRegistering={isRegistering}
                    framesReady={!!framesReady}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
