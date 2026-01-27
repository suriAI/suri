import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { attendanceManager, backendService } from "../../../../services";
import type {
  AttendanceGroup,
  AttendanceMember,
} from "../../../../types/recognition";
import { useCamera } from "./hooks/useCamera";
import { toBase64Payload } from "./hooks/useImageProcessing";

type CaptureStatus =
  | "pending"
  | "capturing"
  | "processing"
  | "completed"
  | "skipped"
  | "error";

interface QueuedMember {
  personId: string;
  name: string;
  role?: string;
  status: CaptureStatus;
  capturedAngles: string[];
  error?: string;
  qualityWarning?: string;
  previewUrl?: string;
}

interface CameraQueueProps {
  group: AttendanceGroup;
  members: AttendanceMember[];
  onRefresh?: () => Promise<void> | void;
  onClose?: () => void;
}

const REQUIRED_ANGLE = "Front";

export function CameraQueue({
  group,
  members,
  onRefresh,
  onClose,
}: CameraQueueProps) {
  const [memberQueue, setMemberQueue] = useState<QueuedMember[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [queueStarted, setQueueStarted] = useState(false);
  const autoAdvance = true;
  const showQualityFeedback = true;
  const [memberSearch, setMemberSearch] = useState("");
  const [registrationFilter, setRegistrationFilter] = useState<
    "all" | "registered" | "non-registered"
  >("all");

  // Use camera hook
  const { videoRef, isVideoReady, cameraError, startCamera, stopCamera } =
    useCamera();

  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const currentMember = memberQueue[currentIndex];
  const totalMembers = memberQueue.length;
  const completedMembers = memberQueue.filter(
    (m) => m.status === "completed" || m.status === "skipped",
  ).length;
  const memberOrderMap = useMemo(
    () => new Map(members.map((member, index) => [member.person_id, index])),
    [members],
  );
  const filteredMembers = useMemo(() => {
    let result = members;
    if (memberSearch.trim()) {
      const query = memberSearch.toLowerCase();
      result = result.filter(
        (member) =>
          member.name.toLowerCase().includes(query) ||
          member.person_id.toLowerCase().includes(query),
      );
    }
    if (registrationFilter !== "all") {
      result = result.filter((member) => {
        const isRegistered = member.has_face_data ?? false;
        return registrationFilter === "registered"
          ? isRegistered
          : !isRegistered;
      });
    }
    return result;
  }, [members, memberSearch, registrationFilter]);

  // Setup member queue
  const setupQueue = useCallback((selectedMembers: AttendanceMember[]) => {
    const queue: QueuedMember[] = selectedMembers.map((member) => ({
      personId: member.person_id,
      name: member.name,
      role: member.role,
      status: "pending" as CaptureStatus,
      capturedAngles: [],
    }));
    setMemberQueue(queue);
    setCurrentIndex(0);
    setQueueStarted(false);
  }, []);

  useEffect(() => {
    if (
      totalMembers > 0 &&
      completedMembers === totalMembers &&
      !isProcessing
    ) {
      setSuccessMessage(`All ${totalMembers} members registered successfully!`);
    }
  }, [completedMembers, totalMembers, isProcessing]);

  // Capture from camera
  const capturePhoto = useCallback(async () => {
    if (!videoRef.current || !currentMember) {
      return;
    }

    if (!captureCanvasRef.current) {
      captureCanvasRef.current = document.createElement("canvas");
    }

    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    const width = video.videoWidth;
    const height = video.videoHeight;

    if (!width || !height) {
      return;
    }

    // Update status
    setMemberQueue((prev) =>
      prev.map((m, idx) =>
        idx === currentIndex
          ? { ...m, status: "capturing" as CaptureStatus }
          : m,
      ),
    );

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Unable to capture from camera context.");
      return;
    }

    // Mirror the capture to match preview
    ctx.scale(-1, 1);
    ctx.drawImage(video, -width, 0, width, height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const base64Payload = toBase64Payload(dataUrl);

    setIsProcessing(true);
    setError(null);

    try {
      // Detect face
      const detection = await backendService.detectFaces(base64Payload, {
        model_type: "face_detector",
      });

      if (!detection.faces || detection.faces.length === 0) {
        throw new Error(
          "No face detected. Please face the camera directly with good lighting.",
        );
      }

      const bestFace = detection.faces.reduce(
        (best, current) =>
          (current.confidence ?? 0) > (best.confidence ?? 0) ? current : best,
        detection.faces[0],
      );

      if (!bestFace.bbox) {
        throw new Error("Face detected but bounding box missing.");
      }

      // Update status
      setMemberQueue((prev) =>
        prev.map((m, idx) =>
          idx === currentIndex
            ? {
                ...m,
                status: "processing" as CaptureStatus,
                previewUrl: dataUrl,
              }
            : m,
        ),
      );

      // Register face
      const result = await attendanceManager.registerFaceForGroupPerson(
        group.id,
        currentMember.personId,
        base64Payload,
        bestFace.bbox,
        bestFace.landmarks_5,
      );

      if (!result.success) {
        throw new Error(result.error || "Registration failed");
      }

      // Mark member as completed since we only need one angle
      setMemberQueue((prev) =>
        prev.map((m, idx) =>
          idx === currentIndex
            ? {
                ...m,
                capturedAngles: [REQUIRED_ANGLE],
                status: "completed" as CaptureStatus,
                qualityWarning:
                  bestFace.confidence && bestFace.confidence < 0.8
                    ? "Low confidence - consider retaking"
                    : undefined,
              }
            : m,
        ),
      );

      // Auto-advance to next member since we only need one angle
      if (autoAdvance) {
        if (currentIndex < memberQueue.length - 1) {
          // Next member
          setTimeout(() => setCurrentIndex((prev) => prev + 1), 1000);
        } else {
          // All done
          setSuccessMessage(
            `All ${totalMembers} members registered successfully!`,
          );
          if (onRefresh) {
            await onRefresh();
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Capture failed";
      setMemberQueue((prev) =>
        prev.map((m, idx) =>
          idx === currentIndex
            ? {
                ...m,
                status: "error" as CaptureStatus,
                error: message,
              }
            : m,
        ),
      );
      setError(message);
    } finally {
      setIsProcessing(false);
    }
  }, [
    currentMember,
    currentIndex,
    memberQueue,
    group.id,
    autoAdvance,
    totalMembers,
    onRefresh,
    videoRef,
  ]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (!queueStarted || !currentMember) return;

      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!isProcessing && isVideoReady) {
          void capturePhoto();
        }
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        // Next member
        if (currentIndex < memberQueue.length - 1) {
          setCurrentIndex((prev) => prev + 1);
          setError(null);
        }
      } else if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        // Previous member
        if (currentIndex > 0) {
          setCurrentIndex((prev) => prev - 1);
          setError(null);
        }
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        // Retry current
        setMemberQueue((prev) =>
          prev.map((m, idx) =>
            idx === currentIndex
              ? { ...m, status: "pending" as CaptureStatus, error: undefined }
              : m,
          ),
        );
        setError(null);
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        // Skip current member
        setMemberQueue((prev) =>
          prev.map((m, idx) =>
            idx === currentIndex
              ? { ...m, status: "skipped" as CaptureStatus }
              : m,
          ),
        );
        if (currentIndex < memberQueue.length - 1) {
          setCurrentIndex((prev) => prev + 1);
        }
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [
    queueStarted,
    currentMember,
    isProcessing,
    isVideoReady,
    currentIndex,
    memberQueue.length,
    capturePhoto,
  ]);

  // Camera lifecycle
  useEffect(() => {
    if (queueStarted) {
      void startCamera();
      return () => stopCamera();
    }
  }, [queueStarted, startCamera, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0f0f0f] text-white">
      {/* Error Alert */}
      {error && (
        <div className="mx-6 mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200 flex items-center gap-3 flex-shrink-0">
          <div className="h-1 w-1 rounded-full bg-red-400 animate-pulse" />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-200/50 hover:text-red-100 transition"
          >
            <i className="fa fa-times text-xs"></i>
          </button>
        </div>
      )}

      {successMessage && (
        <div className="mx-6 mt-4 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-200 flex items-center gap-3 flex-shrink-0">
          <div className="h-1 w-1 rounded-full bg-cyan-400 animate-pulse" />
          <span className="flex-1">{successMessage}</span>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
        {!queueStarted ? (
          /* Setup Phase */
          <div className="space-y-6">
            {/* Member Selection */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white">
                  Select Members to Register
                </h3>
                <div className="flex items-center gap-3">
                  {memberQueue.length > 0 && (
                    <button
                      onClick={() => setupQueue([])}
                      className="text-xs text-white/40 hover:text-white/70 transition"
                    >
                      Clear
                    </button>
                  )}
                  {memberQueue.length < members.length && (
                    <button
                      onClick={() => setupQueue(members)}
                      className="text-xs text-cyan-300 hover:text-cyan-200 transition"
                    >
                      Select All
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <div className="relative flex-1 min-w-[220px]">
                    <svg
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                    <input
                      type="search"
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Search members..."
                      className="w-full rounded-lg border border-white/10 bg-white/5 pl-10 pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-cyan-400/50 focus:bg-white/10 focus:outline-none transition-all"
                    />
                  </div>
                  <select
                    value={registrationFilter}
                    onChange={(e) =>
                      setRegistrationFilter(
                        e.target.value as
                          | "all"
                          | "registered"
                          | "non-registered",
                      )
                    }
                    className="min-w-[170px] rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-cyan-400/50 focus:bg-white/10 focus:outline-none"
                  >
                    <option value="all">All members</option>
                    <option value="non-registered">Unregistered</option>
                    <option value="registered">Registered</option>
                  </select>
                </div>

                <div className="max-h-64 overflow-y-auto space-y-1.5 custom-scroll">
                  {members.length === 0 && (
                    <div className="rounded-xl border border-dashed border-white/5 bg-white/[0.02] px-3 py-8 text-center">
                      <div className="text-xs text-white/40">
                        No members yet
                      </div>
                    </div>
                  )}

                  {members.length > 0 && filteredMembers.length === 0 && (
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-6 text-center">
                      <div className="text-xs text-white/40">
                        {memberSearch.trim()
                          ? `No results for "${memberSearch}"`
                          : registrationFilter === "registered"
                            ? "No registered members"
                            : registrationFilter === "non-registered"
                              ? "All members are registered"
                              : "No members found"}
                      </div>
                    </div>
                  )}

                  {filteredMembers.map((member) => {
                    const isInQueue = memberQueue.some(
                      (m) => m.personId === member.person_id,
                    );
                    const isRegistered = member.has_face_data ?? false;
                    return (
                      <button
                        key={member.person_id}
                        type="button"
                        onClick={() => {
                          if (isInQueue) {
                            const memberIndex = memberQueue.findIndex(
                              (m) => m.personId === member.person_id,
                            );
                            setMemberQueue((prev) =>
                              prev.filter(
                                (m) => m.personId !== member.person_id,
                              ),
                            );
                            if (
                              memberIndex !== -1 &&
                              memberIndex < currentIndex
                            ) {
                              setCurrentIndex((prev) => Math.max(0, prev - 1));
                            }
                            return;
                          }
                          const newMember: QueuedMember = {
                            personId: member.person_id,
                            name: member.name,
                            role: member.role,
                            status: "pending",
                            capturedAngles: [],
                          };
                          setMemberQueue((prev) => {
                            const next = [...prev, newMember];
                            return next.sort(
                              (a, b) =>
                                (memberOrderMap.get(a.personId) ?? 0) -
                                (memberOrderMap.get(b.personId) ?? 0),
                            );
                          });
                        }}
                        className={`group w-full rounded-xl border px-3 py-2 text-left transition-all ${
                          isInQueue
                            ? "border-cyan-400/50 bg-gradient-to-br from-cyan-500/10 to-cyan-500/5"
                            : "border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/5"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-white truncate">
                              {member.name}
                            </div>
                            {member.role && (
                              <div className="text-xs text-white/40 truncate">
                                {member.role}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {isRegistered && (
                              <span className="px-2 py-0.5 rounded-md bg-cyan-500/20 border border-cyan-500/30 text-[10px] text-cyan-200">
                                Registered
                              </span>
                            )}
                            {isInQueue && (
                              <span className="text-cyan-300 text-xs">
                                Queued
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {memberQueue.length === 0 && (
              <div className="text-xs text-white/40">
                Select at least one member to start.
              </div>
            )}

            {/* Start Button */}
            {memberQueue.length > 0 && (
              <button
                onClick={() => setQueueStarted(true)}
                className="btn-success w-full px-4 py-3 text-sm font-semibold"
              >
                Start Queue ({memberQueue.length} members)
              </button>
            )}
          </div>
        ) : (
          /* Capture Phase */
          <div className="grid gap-4 lg:grid-cols-[2fr,1fr] h-full">
            {/* Camera Feed */}
            <div className="space-y-3 flex flex-col">
              <div className="flex items-center justify-between flex-shrink-0">
                <h3 className="text-sm font-semibold text-white">
                  Live Camera Feed
                </h3>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setQueueStarted(false)}
                    className="text-xs text-white/50 hover:text-white transition"
                  >
                    Edit Queue
                  </button>
                  <span
                    className={`text-xs uppercase ${isVideoReady ? "text-cyan-300" : "text-yellow-200"}`}
                  >
                    {isVideoReady ? "● Active" : "○ Loading"}
                  </span>
                </div>
              </div>

              <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black aspect-video flex-grow max-h-[500px]">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover scale-x-[-1]"
                  playsInline
                  muted
                />
                {!isVideoReady && !cameraError && (
                  <div className="absolute inset-0 flex items-center justify-center text-white/60 text-sm">
                    Initializing camera...
                  </div>
                )}
                {cameraError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-center text-sm text-red-200 p-4">
                    {cameraError}
                  </div>
                )}
                {currentMember && isVideoReady && (
                  <div className="absolute top-4 left-4 right-4">
                    <div className="bg-black/70 rounded-lg p-3 border border-white/10">
                      <div className="text-lg font-semibold text-white">
                        {currentMember.name}
                      </div>
                      <div className="text-sm text-white/60 mt-1">
                        Capture: {REQUIRED_ANGLE}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Capture Button */}
              <button
                onClick={() => void capturePhoto()}
                disabled={
                  !isVideoReady ||
                  isProcessing ||
                  !currentMember ||
                  !!cameraError
                }
                className="btn-success w-full px-4 py-3 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing
                  ? "Processing..."
                  : `Capture ${REQUIRED_ANGLE} (Space)`}
              </button>

              <div className="grid grid-cols-4 gap-2 text-xs">
                <button
                  onClick={() => {
                    if (currentIndex > 0) {
                      setCurrentIndex((prev) => prev - 1);
                      setError(null);
                    }
                  }}
                  disabled={currentIndex === 0}
                  className="px-3 py-2 rounded bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition disabled:opacity-40"
                >
                  Prev
                </button>
                <button
                  onClick={() => {
                    if (currentMember) {
                      setMemberQueue((prev) =>
                        prev.map((m, idx) =>
                          idx === currentIndex
                            ? { ...m, status: "skipped" as CaptureStatus }
                            : m,
                        ),
                      );
                      if (currentIndex < memberQueue.length - 1) {
                        setCurrentIndex((prev) => prev + 1);
                      }
                    }
                  }}
                  disabled={!currentMember}
                  className="px-3 py-2 rounded bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition disabled:opacity-40"
                >
                  Skip
                </button>
                <button
                  onClick={() => {
                    if (currentMember) {
                      setMemberQueue((prev) =>
                        prev.map((m, idx) =>
                          idx === currentIndex
                            ? {
                                ...m,
                                status: "pending" as CaptureStatus,
                                error: undefined,
                                qualityWarning: undefined,
                              }
                            : m,
                        ),
                      );
                      setError(null);
                    }
                  }}
                  disabled={!currentMember}
                  className="px-3 py-2 rounded bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition disabled:opacity-40"
                >
                  Retry
                </button>
                <button
                  onClick={() => {
                    if (currentIndex < memberQueue.length - 1) {
                      setCurrentIndex((prev) => prev + 1);
                      setError(null);
                    }
                  }}
                  disabled={currentIndex >= memberQueue.length - 1}
                  className="px-3 py-2 rounded bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition disabled:opacity-40"
                >
                  Next
                </button>
              </div>

              {/* Keyboard Shortcuts */}
              <div className="rounded-lg bg-white/5 border border-white/10 p-3 flex-shrink-0">
                <div className="text-xs font-semibold text-white/60 uppercase mb-2">
                  Shortcuts
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <kbd className="px-2 py-1 rounded bg-white/10 text-white/80">
                      Space
                    </kbd>
                    <span className="text-white/60">Capture</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <kbd className="px-2 py-1 rounded bg-white/10 text-white/80">
                      N
                    </kbd>
                    <span className="text-white/60">Next</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <kbd className="px-2 py-1 rounded bg-white/10 text-white/80">
                      P
                    </kbd>
                    <span className="text-white/60">Prev</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <kbd className="px-2 py-1 rounded bg-white/10 text-white/80">
                      R
                    </kbd>
                    <span className="text-white/60">Retry</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Queue Status */}
            <div className="space-y-3 flex flex-col h-full overflow-hidden">
              <div className="flex items-center justify-between flex-shrink-0">
                <h3 className="text-sm font-semibold text-white">Queue</h3>
                <span className="text-xs text-white/50">
                  {completedMembers}/{totalMembers}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 scrollbar-thin scrollbar-thumb-white/10 pr-2">
                {memberQueue.map((member, idx) => {
                  const isCurrent = idx === currentIndex;
                  const statusColor =
                    member.status === "completed"
                      ? "border-cyan-400/60 bg-cyan-500/10"
                      : member.status === "skipped"
                        ? "border-white/20 bg-white/5"
                        : member.status === "error"
                          ? "border-red-400/60 bg-red-500/10"
                          : isCurrent
                            ? "border-white/20 bg-white/10"
                            : "border-white/10 bg-white/5";

                  return (
                    <div
                      key={member.personId}
                      className={`rounded-lg border p-3 ${statusColor}`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-white flex items-center gap-2">
                            {isCurrent && (
                              <span className="text-cyan-300">→</span>
                            )}
                            {member.name}
                          </div>
                          {member.role && (
                            <div className="text-xs text-white/50">
                              {member.role}
                            </div>
                          )}
                        </div>
                        <span
                          className={`text-xs px-2 py-0.5 rounded ${
                            member.status === "completed"
                              ? "bg-cyan-500/20 text-cyan-200"
                              : member.status === "skipped"
                                ? "bg-white/10 text-white/60"
                                : member.status === "error"
                                  ? "bg-red-500/20 text-red-200"
                                  : member.status === "processing"
                                    ? "bg-amber-500/20 text-amber-200"
                                    : "bg-white/10 text-white/60"
                          }`}
                        >
                          {member.status === "completed"
                            ? "✓ Done"
                            : member.status === "skipped"
                              ? "Skipped"
                              : member.status === "error"
                                ? "✕"
                                : member.status === "processing"
                                  ? "..."
                                  : "Pending"}
                        </span>
                      </div>
                      {member.capturedAngles.length > 0 && (
                        <div className="text-xs text-white/50">
                          Captured: {member.capturedAngles.join(", ")}
                        </div>
                      )}
                      {member.error && (
                        <div className="text-xs text-red-300 mt-1">
                          {member.error}
                        </div>
                      )}
                      {member.qualityWarning && showQualityFeedback && (
                        <div className="text-xs text-yellow-300 mt-1">
                          ⚠️ {member.qualityWarning}
                        </div>
                      )}
                      {member.previewUrl && (
                        <img
                          src={member.previewUrl}
                          alt="Preview"
                          className="w-full h-20 object-cover rounded-lg mt-2"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              {completedMembers === totalMembers && totalMembers > 0 && (
                <button
                  onClick={async () => {
                    if (onRefresh) {
                      await onRefresh();
                    }
                    if (onClose) {
                      onClose();
                    }
                  }}
                  className="btn-success w-full px-4 py-3 text-sm font-semibold"
                >
                  Finish Registration
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
