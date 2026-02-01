import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { attendanceManager, backendService } from "@/services";
import type { AttendanceGroup, AttendanceMember } from "@/types/recognition";
import { useCamera } from "@/components/group/sections/registration/hooks/useCamera";
import { toBase64Payload } from "@/components/group/sections/registration/hooks/useImageProcessing";
import { Dropdown } from "@/components/shared";

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
  const [memberSearch, setMemberSearch] = useState("");
  const [registrationFilter, setRegistrationFilter] = useState<
    "all" | "registered" | "non-registered"
  >("all");

  // Use camera hook - get all needed values for camera selection
  const {
    videoRef,
    cameraDevices,
    selectedCamera,
    setSelectedCamera,
    isStreaming,
    isVideoReady,
    cameraError,
    startCamera,
    stopCamera,
  } = useCamera();

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

  // Camera cleanup on unmount
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
                  <Dropdown
                    options={[
                      { value: "all", label: "All members" },
                      { value: "non-registered", label: "Unregistered" },
                      { value: "registered", label: "Registered" },
                    ]}
                    value={registrationFilter}
                    onChange={(value) => {
                      if (value) {
                        setRegistrationFilter(
                          value as "all" | "registered" | "non-registered",
                        );
                      }
                    }}
                    showPlaceholderOption={false}
                    allowClear={false}
                    className="min-w-[170px]"
                  />
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
                        className={`group w-full rounded-xl border px-3 py-2 text-left transition-all ${isInQueue
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
          /* Capture Phase - Immersive style matching single registration */
          <div className="flex gap-4 h-full">
            {/* Camera Feed - Main Focus */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex-1 relative overflow-hidden rounded-xl border border-white/20 bg-black">
                <video
                  ref={videoRef}
                  className="w-full h-full object-contain scale-x-[-1]"
                  playsInline
                  muted
                />

                {/* Not Streaming State - Show Camera Selection */}
                {!isStreaming && !cameraError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/95">
                    <div className="text-center space-y-4 max-w-xs">
                      <div className="w-16 h-16 mx-auto rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                        <i className="fa-solid fa-video text-2xl text-white/30"></i>
                      </div>
                      <div className="text-sm text-white/60">
                        Select a camera to start
                      </div>
                      {/* Camera Selection Dropdown */}
                      {cameraDevices.length > 0 && (
                        <Dropdown
                          options={cameraDevices.map((device, index) => ({
                            value: device.deviceId,
                            label: device.label || `Camera ${index + 1}`,
                          }))}
                          value={selectedCamera || null}
                          onChange={(deviceId) => {
                            if (deviceId) {
                              setSelectedCamera(deviceId);
                            }
                          }}
                          placeholder="Select camera..."
                          emptyMessage="No cameras available"
                          showPlaceholderOption={false}
                          allowClear={false}
                          buttonClassName="bg-white/10 border-white/20"
                        />
                      )}
                      {cameraDevices.length === 0 && (
                        <div className="text-xs text-white/40">
                          No cameras detected
                        </div>
                      )}
                      {/* Start Button */}
                      <button
                        onClick={() => void startCamera()}
                        disabled={!selectedCamera && cameraDevices.length > 0}
                        className="w-full px-4 py-2.5 rounded-lg border border-cyan-400/50 bg-cyan-500/30 text-cyan-100 hover:bg-cyan-500/40 text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <i className="fa-solid fa-play mr-2"></i>
                        Start Camera
                      </button>
                    </div>
                  </div>
                )}

                {/* Loading State - Camera starting */}
                {isStreaming && !isVideoReady && !cameraError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/90">
                    <div className="text-center space-y-3">
                      <div className="h-10 w-10 mx-auto rounded-full border-2 border-white/20 border-t-cyan-400 animate-spin" />
                      <div className="text-xs text-white/50">
                        Starting camera...
                      </div>
                    </div>
                  </div>
                )}

                {/* Error State */}
                {cameraError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/90 p-4 text-center">
                    <div className="space-y-3">
                      <div className="w-12 h-12 mx-auto rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                        <i className="fa-solid fa-exclamation-triangle text-lg text-red-400"></i>
                      </div>
                      <div className="text-xs text-red-300 max-w-xs">
                        {cameraError}
                      </div>
                      <button
                        onClick={() => void startCamera()}
                        className="px-4 py-2 rounded-lg border border-white/20 bg-white/10 text-white/70 hover:text-white text-xs font-medium transition-all"
                      >
                        Try Again
                      </button>
                    </div>
                  </div>
                )}

                {/* Current Member Info - Minimal overlay */}
                {currentMember && (
                  <div className="absolute top-2 left-2 z-10">
                    <div className="text-md font-medium text-white/80 truncate">
                      {currentMember.name}
                    </div>
                    {currentMember.role && (
                      <div className="text-xs text-white/40">
                        {currentMember.role}
                      </div>
                    )}
                  </div>
                )}

                {/* Progress indicator and controls */}
                <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
                  <span className="text-xs text-white/50">
                    {currentIndex + 1}/{totalMembers}
                  </span>
                  {isStreaming && (
                    <button
                      onClick={() => stopCamera()}
                      className="px-2 py-1 rounded-md bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 text-xs font-medium transition-all"
                    >
                      <i className="fa-solid fa-stop mr-1"></i>
                      Stop
                    </button>
                  )}
                  <button
                    onClick={() => setQueueStarted(false)}
                    className="px-2 py-1 rounded-md bg-white/10 border border-white/10 text-white/50 hover:text-white hover:bg-white/20 text-xs font-medium transition-all"
                  >
                    <i className="fa-solid fa-list-ul mr-1"></i>
                    Queue
                  </button>
                </div>

                {/* Navigation Controls - Left/Right arrows */}
                <div className="absolute inset-y-0 left-2 flex items-center z-10">
                  <button
                    onClick={() => {
                      if (currentIndex > 0) {
                        setCurrentIndex((prev) => prev - 1);
                        setError(null);
                      }
                    }}
                    disabled={currentIndex === 0}
                    className="p-2 rounded-full bg-black/40 border border-white/10 text-white/60 hover:text-white hover:bg-black/60 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <i className="fa-solid fa-chevron-left text-sm"></i>
                  </button>
                </div>
                <div className="absolute inset-y-0 right-2 flex items-center z-10">
                  <button
                    onClick={() => {
                      if (currentIndex < memberQueue.length - 1) {
                        setCurrentIndex((prev) => prev + 1);
                        setError(null);
                      }
                    }}
                    disabled={currentIndex >= memberQueue.length - 1}
                    className="p-2 rounded-full bg-black/40 border border-white/10 text-white/60 hover:text-white hover:bg-black/60 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <i className="fa-solid fa-chevron-right text-sm"></i>
                  </button>
                </div>

                {/* Bottom Actions - Floating */}
                <div className="absolute bottom-2 left-2 right-2 z-10 flex items-center gap-2">
                  {/* Skip Button */}
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
                    className="px-3 py-2 rounded-md border border-white/10 bg-black/40 text-white/70 hover:text-white hover:bg-black/60 text-xs font-medium transition-all disabled:opacity-40"
                  >
                    Skip
                  </button>

                  {/* Capture Button - Primary Action */}
                  <button
                    onClick={() => void capturePhoto()}
                    disabled={
                      !isVideoReady ||
                      isProcessing ||
                      !currentMember ||
                      !!cameraError
                    }
                    className="flex-1 px-4 py-2 rounded-md border border-cyan-400/50 bg-cyan-500/40 text-cyan-100 hover:bg-cyan-500/50 text-xs font-medium transition-all disabled:bg-black/40 disabled:border-white/10 disabled:text-white/30 disabled:cursor-not-allowed"
                  >
                    {isProcessing ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                        Processing...
                      </span>
                    ) : (
                      "Capture (Space)"
                    )}
                  </button>

                  {/* Retry Button */}
                  {currentMember?.status === "error" && (
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
                      className="px-3 py-2 rounded-md border border-amber-400/50 bg-amber-500/40 text-amber-100 hover:bg-amber-500/50 text-xs font-medium transition-all"
                    >
                      Retry
                    </button>
                  )}
                </div>

                {/* Status Badge - Shows completed/error state */}
                {currentMember &&
                  currentMember.status !== "pending" &&
                  currentMember.status !== "capturing" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-20">
                      <div
                        className={`px-6 py-4 rounded-2xl border ${currentMember.status === "completed"
                            ? "bg-cyan-500/20 border-cyan-500/30"
                            : currentMember.status === "skipped"
                              ? "bg-white/10 border-white/20"
                              : "bg-red-500/20 border-red-500/30"
                          }`}
                      >
                        <div className="text-center">
                          <div
                            className={`text-2xl mb-1 ${currentMember.status === "completed"
                                ? "text-cyan-400"
                                : currentMember.status === "skipped"
                                  ? "text-white/60"
                                  : "text-red-400"
                              }`}
                          >
                            {currentMember.status === "completed" && (
                              <i className="fa-solid fa-check-circle"></i>
                            )}
                            {currentMember.status === "skipped" && (
                              <i className="fa-solid fa-forward"></i>
                            )}
                            {currentMember.status === "error" && (
                              <i className="fa-solid fa-exclamation-circle"></i>
                            )}
                          </div>
                          <div className="text-sm font-medium text-white">
                            {currentMember.status === "completed" &&
                              "Registered"}
                            {currentMember.status === "skipped" && "Skipped"}
                            {currentMember.status === "error" && "Error"}
                          </div>
                          {currentMember.error && (
                            <div className="text-xs text-red-300 mt-1 max-w-[200px]">
                              {currentMember.error}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
              </div>

              {/* Keyboard shortcuts - Compact */}
              <div className="mt-2 flex items-center justify-center gap-4 text-[10px] text-white/40">
                <span>
                  <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/60 mr-1">
                    Space
                  </kbd>
                  Capture
                </span>
                <span>
                  <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/60 mr-1">
                    ←
                  </kbd>
                  <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/60 mr-1">
                    →
                  </kbd>
                  Navigate
                </span>
                <span>
                  <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/60 mr-1">
                    S
                  </kbd>
                  Skip
                </span>
                <span>
                  <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/60 mr-1">
                    R
                  </kbd>
                  Retry
                </span>
              </div>
            </div>

            {/* Queue Sidebar - Compact */}
            <div className="w-64 flex-shrink-0 flex flex-col overflow-hidden rounded-xl border border-white/10 bg-white/5">
              <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
                <span className="text-xs font-semibold text-white/70">
                  Queue
                </span>
                <span className="text-xs text-white/40">
                  {completedMembers}/{totalMembers}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scroll">
                {memberQueue.map((member, idx) => {
                  const isCurrent = idx === currentIndex;
                  const statusIcon =
                    member.status === "completed"
                      ? "fa-check"
                      : member.status === "skipped"
                        ? "fa-forward"
                        : member.status === "error"
                          ? "fa-exclamation"
                          : member.status === "processing"
                            ? "fa-spinner fa-spin"
                            : "";

                  return (
                    <button
                      key={member.personId}
                      onClick={() => {
                        setCurrentIndex(idx);
                        setError(null);
                      }}
                      className={`w-full text-left rounded-lg px-2 py-1.5 transition-all flex items-center gap-2 ${isCurrent
                          ? "bg-white/10 border border-white/20"
                          : "hover:bg-white/5 border border-transparent"
                        }`}
                    >
                      {/* Status Icon */}
                      <div
                        className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 ${member.status === "completed"
                            ? "bg-cyan-500/20 text-cyan-400"
                            : member.status === "skipped"
                              ? "bg-white/10 text-white/40"
                              : member.status === "error"
                                ? "bg-red-500/20 text-red-400"
                                : member.status === "processing"
                                  ? "bg-amber-500/20 text-amber-400"
                                  : isCurrent
                                    ? "bg-white/20 text-white/60"
                                    : "bg-white/5 text-white/30"
                          }`}
                      >
                        {statusIcon ? (
                          <i className={`fa-solid ${statusIcon}`}></i>
                        ) : (
                          <span className="text-[8px]">{idx + 1}</span>
                        )}
                      </div>
                      {/* Name */}
                      <div className="flex-1 min-w-0">
                        <div
                          className={`text-xs font-medium truncate ${isCurrent ? "text-white" : "text-white/70"
                            }`}
                        >
                          {member.name}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {/* Finish Button */}
              {completedMembers === totalMembers && totalMembers > 0 && (
                <div className="p-2 border-t border-white/10">
                  <button
                    onClick={async () => {
                      if (onRefresh) {
                        await onRefresh();
                      }
                      if (onClose) {
                        onClose();
                      }
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/30 text-xs font-semibold transition-all"
                  >
                    <i className="fa-solid fa-check mr-1.5"></i>
                    Done
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
