import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { attendanceManager, backendService } from "../../../../services";
import { generateDisplayNames } from "../../../../utils";
import type {
  AttendanceGroup,
  AttendanceMember,
} from "../../../../types/recognition";

type CaptureSource = "upload" | "live";

type FrameStatus = "pending" | "processing" | "ready" | "error" | "registered";

type BoundingBox = [number, number, number, number];

interface CapturedFrame {
  id: string;
  angle: string;
  label: string;
  dataUrl: string;
  width: number;
  height: number;
  status: FrameStatus;
  confidence?: number;
  bbox?: BoundingBox;
  landmarks_5?: number[][];
  error?: string;
}

interface FaceCaptureProps {
  group: AttendanceGroup | null;
  members: AttendanceMember[];
  onRefresh?: () => Promise<void> | void;
  initialSource?: CaptureSource;
  deselectMemberTrigger?: number; // When this changes, deselect the member
  onSelectedMemberChange?: (hasSelectedMember: boolean) => void; // Notify parent when member selection changes
}

const REQUIRED_ANGLE = "Front";

function ImagePreviewWithBbox({ frame }: { frame: CapturedFrame }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [bboxStyle, setBboxStyle] = useState<{
    left: string;
    top: string;
    width: string;
    height: string;
  } | null>(null);
  const lastBboxStyleRef = useRef<string>("");

  useEffect(() => {
    if (!frame.bbox || !frame.width || !frame.height || !containerRef.current) {
      setBboxStyle(null);
      lastBboxStyleRef.current = "";
      return;
    }

    const calculateBbox = () => {
      const container = containerRef.current;
      if (!container) return;

      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      if (containerWidth === 0 || containerHeight === 0) {
        return;
      }

      const imageAspectRatio = frame.width / frame.height;
      const containerAspectRatio = containerWidth / containerHeight;

      // Calculate how the image is displayed with object-contain
      let displayedWidth: number;
      let displayedHeight: number;
      let offsetX = 0;
      let offsetY = 0;

      if (imageAspectRatio > containerAspectRatio) {
        // Image is wider - fits to container width
        displayedWidth = containerWidth;
        displayedHeight = containerWidth / imageAspectRatio;
        offsetY = (containerHeight - displayedHeight) / 2;
      } else {
        // Image is taller - fits to container height
        displayedHeight = containerHeight;
        displayedWidth = containerHeight * imageAspectRatio;
        offsetX = (containerWidth - displayedWidth) / 2;
      }

      const bbox = frame.bbox;
      if (!bbox) {
        return;
      }

      // Calculate bbox position in pixels relative to displayed image
      const scaleX = displayedWidth / frame.width;
      const scaleY = displayedHeight / frame.height;

      const bboxLeft = bbox[0] * scaleX + offsetX;
      const bboxTop = bbox[1] * scaleY + offsetY;
      const bboxWidth = bbox[2] * scaleX;
      const bboxHeight = bbox[3] * scaleY;

      const newStyle = {
        left: `${bboxLeft}px`,
        top: `${bboxTop}px`,
        width: `${bboxWidth}px`,
        height: `${bboxHeight}px`,
      };

      // Only update if values actually changed to prevent blinking
      const styleKey = `${bboxLeft.toFixed(2)},${bboxTop.toFixed(
        2,
      )},${bboxWidth.toFixed(2)},${bboxHeight.toFixed(2)}`;
      if (lastBboxStyleRef.current !== styleKey) {
        lastBboxStyleRef.current = styleKey;
        setBboxStyle(newStyle);
      }
    };

    // Debounce resize calculations
    let timeoutId: NodeJS.Timeout;
    const debouncedCalculate = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(calculateBbox, 16); // ~60fps
    };

    calculateBbox();

    // Recalculate on resize with debouncing
    const resizeObserver = new ResizeObserver(debouncedCalculate);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
    };
  }, [frame.bbox, frame.width, frame.height]);

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 relative rounded-lg overflow-hidden bg-black"
    >
      <img
        src={frame.dataUrl}
        alt={frame.label}
        className="w-full h-full object-contain"
      />
      {frame.status === "processing" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="flex flex-col items-center gap-2">
            <div className="h-6 w-6 rounded-full border-2 border-white/20 border-t-cyan-400 animate-spin" />
            <span className="text-xs text-white/60">Analyzing...</span>
          </div>
        </div>
      )}
      {frame.status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-500/20 p-3 text-center">
          <div className="space-y-1">
            <div className="text-xl">⚠️</div>
            <div className="text-xs text-red-200">
              {frame.error || "Failed"}
            </div>
          </div>
        </div>
      )}
      {frame.status !== "error" && bboxStyle && (
        <div
          className="absolute border-2 border-cyan-400 shadow-lg shadow-cyan-400/50"
          style={bboxStyle}
        />
      )}
    </div>
  );
}

const makeId = () => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `frame-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const toBase64Payload = (dataUrl: string) => {
  const [, payload] = dataUrl.split(",");
  return payload || dataUrl;
};

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });

const getImageDimensions = (dataUrl: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => reject(new Error("Unable to load image preview"));
    img.src = dataUrl;
  });

export function FaceCapture({
  group,
  members,
  onRefresh,
  initialSource,
  deselectMemberTrigger,
  onSelectedMemberChange,
}: FaceCaptureProps) {
  const [source, setSource] = useState<CaptureSource>(
    initialSource ?? "upload",
  );
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [registrationFilter, setRegistrationFilter] = useState<
    "all" | "registered" | "non-registered"
  >("all");
  const [frames, setFrames] = useState<CapturedFrame[]>([]);
  const [activeAngle, setActiveAngle] = useState<string>(REQUIRED_ANGLE);
  const [memberStatus, setMemberStatus] = useState<Map<string, boolean>>(
    new Map(),
  );
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Generate display names with auto-differentiation for duplicates
  const membersWithDisplayNames = useMemo(() => {
    return generateDisplayNames(members);
  }, [members]);

  const filteredMembers = useMemo(() => {
    let result = membersWithDisplayNames;

    // Apply search filter
    if (memberSearch.trim()) {
      const query = memberSearch.toLowerCase();
      result = result.filter(
        (member) =>
          member.name.toLowerCase().includes(query) ||
          member.displayName.toLowerCase().includes(query) ||
          member.person_id.toLowerCase().includes(query),
      );
    }

    // Apply registration status filter
    if (registrationFilter !== "all") {
      result = result.filter((member) => {
        const isRegistered = memberStatus.get(member.person_id) ?? false;
        return registrationFilter === "registered"
          ? isRegistered
          : !isRegistered;
      });
    }

    // Sort: registered first, then non-registered (within each group, maintain original order)
    result = [...result].sort((a, b) => {
      const aRegistered = memberStatus.get(a.person_id) ?? false;
      const bRegistered = memberStatus.get(b.person_id) ?? false;

      if (aRegistered && !bRegistered) return -1; // Registered first
      if (!aRegistered && bRegistered) return 1; // Non-registered after
      return 0; // Maintain original order within same status
    });

    return result;
  }, [memberSearch, membersWithDisplayNames, registrationFilter, memberStatus]);

  const resetFrames = useCallback(() => {
    setFrames([]);
    setActiveAngle(REQUIRED_ANGLE);
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
    setCameraError(null);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      const constraints: MediaStreamConstraints = {
        video: true,
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch (error) {
      console.error("🚨 Camera start failed:", error);
      setCameraError(
        "Unable to access camera. Please check permissions or switch to upload mode.",
      );
      setCameraReady(false);
    }
  }, []);

  const loadMemberStatus = useCallback(async () => {
    if (!group) {
      setMemberStatus(new Map());
      return;
    }

    try {
      const persons = await attendanceManager.getGroupPersons(group.id);
      const status = new Map<string, boolean>();
      persons.forEach((person) =>
        status.set(person.person_id, person.has_face_data),
      );
      setMemberStatus(status);
    } catch (error) {
      console.error("⚠️ Failed to load member registration status:", error);
    }
  }, [group]);

  useEffect(() => {
    loadMemberStatus();
  }, [loadMemberStatus]);

  // Auto-dismiss success message after 5 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => {
        setSuccessMessage(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // Notify parent when selected member changes
  useEffect(() => {
    if (onSelectedMemberChange) {
      onSelectedMemberChange(!!selectedMemberId);
    }
  }, [selectedMemberId, onSelectedMemberChange]);

  // Deselect member when trigger changes
  const deselectedMemberTriggerRef = useRef(deselectMemberTrigger ?? 0);
  useEffect(() => {
    if (
      deselectMemberTrigger !== undefined &&
      deselectedMemberTriggerRef.current !== deselectMemberTrigger
    ) {
      deselectedMemberTriggerRef.current = deselectMemberTrigger;
      if (selectedMemberId) {
        setSelectedMemberId("");
        resetFrames();
      }
    }
  }, [deselectMemberTrigger, selectedMemberId, resetFrames]);

  // Only reset when group changes or selected member no longer exists
  useEffect(() => {
    if (!group) {
      setSelectedMemberId("");
      resetFrames();
      setSuccessMessage(null);
      setGlobalError(null);
      return;
    }

    // Only clear selection if selected member no longer exists
    if (selectedMemberId) {
      const memberExists = members.some(
        (m) => m.person_id === selectedMemberId,
      );
      if (!memberExists) {
        setSelectedMemberId("");
        resetFrames();
        setSuccessMessage(null);
        setGlobalError(null);
      }
    }
    // Don't reset frames/messages when members list refreshes after successful registration
  }, [group, resetFrames, members, selectedMemberId]);

  useEffect(() => {
    if (activeAngle !== REQUIRED_ANGLE) {
      setActiveAngle(REQUIRED_ANGLE);
    }
  }, [activeAngle]);

  useEffect(() => {
    if (source === "live") {
      startCamera();
      return () => stopCamera();
    }
    stopCamera();
  }, [source, startCamera, stopCamera]);

  // Restart camera when frames are cleared and source is 'live'
  useEffect(() => {
    const hasFrame = frames.find((f) => f.angle === REQUIRED_ANGLE);
    if (source === "live" && !hasFrame && !cameraReady) {
      startCamera();
    }
  }, [source, frames, cameraReady, startCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const updateFrame = useCallback(
    (frameId: string, updater: (frame: CapturedFrame) => CapturedFrame) => {
      setFrames((prev) =>
        prev.map((frame) => (frame.id === frameId ? updater(frame) : frame)),
      );
    },
    [],
  );

  const captureProcessedFrame = useCallback(
    async (angle: string, dataUrl: string, width: number, height: number) => {
      const id = makeId();
      const label = angle;

      setGlobalError(null);
      setSuccessMessage(null);

      setFrames((prev) => {
        const others = prev.filter((frame) => frame.angle !== angle);
        return [
          ...others,
          {
            id,
            angle,
            label,
            dataUrl,
            width,
            height,
            status: "processing",
          },
        ];
      });

      try {
        const detection = await backendService.detectFaces(
          toBase64Payload(dataUrl),
          {
            model_type: "face_detector",
          },
        );

        if (!detection.faces || detection.faces.length === 0) {
          throw new Error(
            "No face detected. Try better lighting, remove glasses, or face the camera directly.",
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

        updateFrame(id, (frame) => ({
          ...frame,
          status: "ready",
          confidence: bestFace.confidence,
          bbox: bestFace.bbox,
          landmarks_5: bestFace.landmarks_5,
          error: undefined,
        }));
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Face analysis failed. Please try again.";
        updateFrame(id, (frame) => ({
          ...frame,
          status: "error",
          error: message,
          confidence: undefined,
          bbox: undefined,
        }));
      }
    },
    [updateFrame],
  );

  const captureFromCamera = useCallback(
    async (angle: string) => {
      if (!videoRef.current) {
        setCameraError("Camera feed not ready yet.");
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
        setCameraError("Camera is still initializing. Please wait a moment.");
        return;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setCameraError("Unable to capture from camera.");
        return;
      }

      // Mirror the canvas to match the mirrored video preview
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, -width, 0, width, height);
      ctx.restore();

      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      await captureProcessedFrame(angle, dataUrl, width, height);

      // Stop camera after successful capture since the camera container will be hidden
      stopCamera();
    },
    [captureProcessedFrame, stopCamera],
  );

  const handleFileSelected = useCallback(
    async (angle: string, files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];

      if (!file.type.startsWith("image/")) {
        setGlobalError("Please upload a valid image file.");
        return;
      }

      try {
        const dataUrl = await readFileAsDataUrl(file);
        const { width, height } = await getImageDimensions(dataUrl);
        await captureProcessedFrame(angle, dataUrl, width, height);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to process the selected image.";
        setGlobalError(message);
      }
    },
    [captureProcessedFrame],
  );

  const framesReady = (() => {
    const frame = frames.find((item) => item.angle === REQUIRED_ANGLE);
    return frame && (frame.status === "ready" || frame.status === "registered");
  })();

  const handleRegister = useCallback(async () => {
    if (!group) {
      setGlobalError(
        "No group selected. Please go to Menu and select a group first.",
      );
      return;
    }

    if (!selectedMemberId) {
      setGlobalError(
        "No member selected. Please select a member from the list on the left.",
      );
      return;
    }

    // Validate member still exists
    const selectedMember = members.find(
      (m) => m.person_id === selectedMemberId,
    );
    if (!selectedMember) {
      setGlobalError(
        "Selected member no longer exists. Please select another member.",
      );
      setSelectedMemberId("");
      return;
    }

    const isAlreadyRegistered = memberStatus.get(selectedMemberId) ?? false;

    if (!framesReady) {
      const frame = frames.find((f) => f.angle === REQUIRED_ANGLE);
      if (!frame) {
        setGlobalError("Please capture a face image first.");
      } else if (frame.status === "error") {
        setGlobalError("Face capture failed. Please try again.");
      } else {
        setGlobalError("Face capture is still processing. Please wait.");
      }
      return;
    }

    setIsRegistering(true);
    setGlobalError(null);
    setSuccessMessage(null);

    try {
      const frame = frames.find((item) => item.angle === REQUIRED_ANGLE);
      if (!frame || !frame.bbox) {
        throw new Error(
          "Missing processed frame. Please capture a face image first.",
        );
      }

      if (!Array.isArray(frame.bbox) || frame.bbox.length !== 4) {
        throw new Error(
          "Invalid bbox format - expected array [x, y, width, height]",
        );
      }

      const payload = toBase64Payload(frame.dataUrl);
      const result = await attendanceManager.registerFaceForGroupPerson(
        group.id,
        selectedMemberId,
        payload,
        frame.bbox,
        frame.landmarks_5,
      );

      if (!result.success) {
        throw new Error(result.error || "Registration failed.");
      }

      updateFrame(frame.id, (current) => ({
        ...current,
        status: "registered",
      }));

      const memberName =
        membersWithDisplayNames.find((m) => m.person_id === selectedMemberId)
          ?.displayName || "Member";

      setSuccessMessage(
        isAlreadyRegistered
          ? `${memberName} Re-registered successfully!`
          : `${memberName} Registered successfully!`,
      );

      await loadMemberStatus();
      if (onRefresh) {
        await onRefresh();
      }

      // Don't auto-reset - let user stay on the success message and manually go back
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Registration failed. Please try again.";
      setGlobalError(message);
    } finally {
      setIsRegistering(false);
    }
  }, [
    group,
    selectedMemberId,
    framesReady,
    frames,
    loadMemberStatus,
    onRefresh,
    updateFrame,
    members,
    memberStatus,
    membersWithDisplayNames,
  ]);

  const handleRemoveFaceData = useCallback(
    async (member: AttendanceMember & { displayName: string }) => {
      if (!group) return;
      const confirmation = window.confirm(
        `Remove all face embeddings for ${member.displayName}?`,
      );
      if (!confirmation) return;

      try {
        const result = await attendanceManager.removeFaceDataForGroupPerson(
          group.id,
          member.person_id,
        );
        if (!result.success) {
          throw new Error(result.error || "Failed to remove embeddings");
        }
        await loadMemberStatus();
        if (onRefresh) {
          await onRefresh();
        }
        setSuccessMessage(`Embeddings purged for ${member.displayName}.`);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to remove face data.";
        setGlobalError(message);
      }
    },
    [group, loadMemberStatus, onRefresh],
  );

  const resetWorkflow = useCallback(() => {
    resetFrames();
    setSuccessMessage(null);
    setGlobalError(null);
  }, [resetFrames]);

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      {/* Success Message - Positioned absolutely to not affect layout */}
      {successMessage && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 rounded-xl border border-cyan-500/30 bg-cyan-500/10 backdrop-blur-sm px-4 py-3 text-sm text-cyan-200 flex items-center gap-3 min-w-[500px] max-w-[95%] transition-all duration-300 ease-out">
          <span className="flex-1">{successMessage}</span>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-cyan-200/50 hover:text-cyan-100 transition-colors flex-shrink-0"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Alerts */}
      {globalError && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-200 flex items-center gap-3 flex-shrink-0">
          <span className="flex-1">{globalError}</span>
          <button
            onClick={() => setGlobalError(null)}
            className="text-red-200/50 hover:text-red-100 transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      <div className="flex-1 overflow-hidden min-h-0">
        {/* Show member list only when no member selected */}
        {!selectedMemberId && (
          <div className="space-y-3 flex flex-col overflow-hidden min-h-0 h-full p-6">
            {/* Header Row with Search and Back Button */}
            <div className="flex items-center gap-3 flex-shrink-0">
              {/* Search Bar */}
              <div className="relative flex-1">
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
                  className="w-full rounded-xl border border-white/10 bg-white/5 pl-10 pr-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-cyan-400/50 focus:bg-white/10 focus:outline-none transition-all"
                />
              </div>
            </div>

            {/* Registration Status Filter Tabs */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setRegistrationFilter("all")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  registrationFilter === "all"
                    ? "bg-white/10 text-white border border-white/20"
                    : "bg-white/5 text-white/60 border border-white/10 hover:bg-white/8 hover:text-white/80"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setRegistrationFilter("non-registered")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  registrationFilter === "non-registered"
                    ? "bg-amber-500/20 text-amber-200 border border-amber-500/30"
                    : "bg-white/5 text-white/60 border border-white/10 hover:bg-white/8 hover:text-white/80"
                }`}
              >
                Needs Registration
              </button>
              <button
                onClick={() => setRegistrationFilter("registered")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  registrationFilter === "registered"
                    ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/30"
                    : "bg-white/5 text-white/60 border border-white/10 hover:bg-white/8 hover:text-white/80"
                }`}
              >
                Registered
              </button>
            </div>

            <div className="flex-1 space-y-1.5 overflow-y-auto custom-scroll overflow-x-hidden min-h-0 pr-2">
              {members.length === 0 && (
                <div className="rounded-xl border border-dashed border-white/5 bg-white/[0.02] px-3 py-12 text-center">
                  <div className="text-xs text-white/40">No members yet</div>
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

              {/* Show filter count info */}
              {members.length > 0 && filteredMembers.length > 0 && (
                <div className="px-1 pb-1">
                  <div className="text-xs text-white/30">
                    Showing {filteredMembers.length} of {members.length} member
                    {members.length !== 1 ? "s" : ""}
                    {registrationFilter !== "all" && (
                      <span className="ml-1">
                        (
                        {registrationFilter === "registered"
                          ? "registered"
                          : "needs registration"}
                        )
                      </span>
                    )}
                  </div>
                </div>
              )}

              {filteredMembers.map((member) => {
                const isSelected = selectedMemberId === member.person_id;
                const hasEmbeddings =
                  memberStatus.get(member.person_id) ?? false;
                return (
                  <button
                    key={member.person_id}
                    onClick={() => setSelectedMemberId(member.person_id)}
                    className={`group relative w-full rounded-xl border px-3 py-3 text-left transition-all ${
                      isSelected
                        ? "border-cyan-400/50 bg-gradient-to-br from-cyan-500/10 to-cyan-500/5 shadow-lg shadow-cyan-500/10"
                        : "border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/5"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div
                            className={`text-sm font-medium truncate transition-colors ${
                              isSelected ? "text-cyan-100" : "text-white"
                            }`}
                          >
                            {member.displayName}
                          </div>
                        </div>
                        {member.role && (
                          <div className="text-xs text-white/40 truncate mt-0.5">
                            {member.role}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {hasEmbeddings && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-cyan-500/20 border border-cyan-500/30">
                            <svg
                              className="w-3 h-3 text-cyan-400"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                            <span className="text-xs font-medium text-cyan-300">
                              Registered
                            </span>
                          </span>
                        )}
                        {isSelected && (
                          <div className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
                        )}
                      </div>
                    </div>
                    {hasEmbeddings && isSelected && (
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveFaceData(member);
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            handleRemoveFaceData(member);
                          }
                        }}
                        className="mt-2 w-full rounded-lg bg-red-500/10 px-2 py-1.5 text-xs text-red-300 hover:bg-red-500/20 hover:text-red-200 transition-colors cursor-pointer"
                      >
                        Remove Face Data
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Registration Panel - Show only when member selected */}
        {selectedMemberId && (
          <div className="flex flex-col h-full overflow-hidden p-6 space-y-2">
            {/* Content Area - Takes available space */}
            <div className="flex-1 min-h-0 flex flex-col space-y-4 overflow-hidden">
              {/* Only show source toggle if no initialSource was provided (direct access) */}
              {!initialSource && (
                <div className="flex gap-2 flex-shrink-0">
                  {(["upload", "live"] as CaptureSource[]).map((option) => (
                    <button
                      key={option}
                      onClick={() => setSource(option)}
                      disabled={
                        !!frames.find((f) => f.angle === REQUIRED_ANGLE)
                      }
                      className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                        source === option
                          ? "bg-white/10 text-white border border-white/20"
                          : "bg-white/5 text-white/40 border border-white/10 hover:bg-white/10 hover:text-white/60"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {option === "upload" ? "Upload" : "Camera"}
                    </button>
                  ))}
                </div>
              )}

              {/* Capture/Preview Area - Takes remaining space */}
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                {source === "live"
                  ? // Camera mode - only show camera if no frame exists
                    !frames.find((f) => f.angle === REQUIRED_ANGLE) && (
                      <div className="h-full flex flex-col rounded-2xl border border-white/10 bg-black/40 overflow-hidden">
                        <div className="p-4 space-y-3 flex-shrink-0">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div
                                className={`h-2 w-2 rounded-full ${cameraReady ? "bg-cyan-400 animate-pulse" : "bg-yellow-400"}`}
                              />
                              <span className="text-xs text-white/60">
                                {cameraReady ? "Ready" : "Initializing..."}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex-1 min-h-0 flex flex-col p-4 pt-0">
                          <div className="flex-1 relative overflow-hidden rounded-xl border border-white/20 bg-black">
                            <video
                              ref={videoRef}
                              className="w-full h-full object-cover scale-x-[-1]"
                              playsInline
                              muted
                            />
                            {!cameraReady && !cameraError && (
                              <div className="absolute inset-0 flex items-center justify-center">
                                <div className="flex flex-col items-center gap-2">
                                  <div className="h-12 w-12 rounded-full border-2 border-white/20 border-t-cyan-400 animate-spin" />
                                  <span className="text-xs text-white/40">
                                    Loading...
                                  </span>
                                </div>
                              </div>
                            )}
                            {cameraError && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/90 p-4 text-center">
                                <div className="space-y-2">
                                  <div className="text-xs text-red-300">
                                    {cameraError}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() =>
                              void captureFromCamera(REQUIRED_ANGLE)
                            }
                            disabled={!cameraReady || !!cameraError}
                            className="w-full flex items-center justify-center gap-2 rounded-xl bg-white/10 border border-white/20 py-4 text-sm font-medium text-white hover:bg-white/15 disabled:bg-white/5 disabled:border-white/10 disabled:text-white/30 transition-all mt-3 flex-shrink-0"
                          >
                            Capture Face
                          </button>
                        </div>
                      </div>
                    )
                  : // Upload mode - only show upload area if no frame exists
                    !frames.find((f) => f.angle === REQUIRED_ANGLE) && (
                      <div className="h-full rounded-2xl border border-white/10 bg-black/40 overflow-hidden">
                        <label className="h-full flex cursor-pointer flex-col items-center justify-center p-8 text-center hover:bg-white/5 transition-all group">
                          <div className="flex flex-col items-center gap-4">
                            <div>
                              <div className="text-sm text-white/60 mb-1">
                                Drop image or click to browse
                              </div>
                              <div className="text-xs text-white/30">
                                PNG, JPG up to 10MB
                              </div>
                            </div>
                          </div>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              void handleFileSelected(
                                REQUIRED_ANGLE,
                                e.target.files,
                              );
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </div>
                    )}

                {/* Face Preview - Only show when frame exists */}
                {frames.find((f) => f.angle === REQUIRED_ANGLE) && (
                  <div className="h-full flex flex-col rounded-xl border border-white/10 bg-black/20 overflow-hidden">
                    <div className="flex-1 min-h-0 p-3 flex flex-col">
                      {frames
                        .filter((f) => f.angle === REQUIRED_ANGLE)
                        .map((frame) => (
                          <div
                            key={frame.id}
                            className="flex-1 min-h-0 flex flex-col space-y-2"
                          >
                            <ImagePreviewWithBbox frame={frame} />
                            {/* Name and Change button container */}
                            <div className="flex-shrink-0 rounded-xl border border-white/10 bg-white/5 p-1.5">
                              <div className="flex items-center gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-white truncate">
                                    {
                                      membersWithDisplayNames.find(
                                        (m) => m.person_id === selectedMemberId,
                                      )?.displayName
                                    }
                                  </div>
                                </div>
                                <button
                                  onClick={() => {
                                    setSelectedMemberId("");
                                    resetFrames();
                                  }}
                                  className="rounded-lg px-3 py-1.5 text-xs text-white/60 border border-white/10 bg-white/5 hover:bg-white/10 hover:text-white transition-all"
                                >
                                  Change
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Actions - Fixed at bottom */}
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={resetWorkflow}
                className="flex-1 rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white/50 hover:bg-white/10 hover:text-white/70 transition-all"
              >
                Reset
              </button>
              <button
                onClick={() => void handleRegister()}
                disabled={!framesReady || !selectedMemberId || isRegistering}
                className={`flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all ${
                  memberStatus.get(selectedMemberId)
                    ? "bg-amber-500/20 border-amber-400/40 text-amber-100 hover:bg-amber-500/30"
                    : "bg-cyan-500/20 border-cyan-400/40 text-cyan-100 hover:bg-cyan-500/30"
                } disabled:bg-white/5 disabled:border-white/10 disabled:text-white/30`}
                title={
                  memberStatus.get(selectedMemberId)
                    ? "Override existing registration with new face data"
                    : framesReady
                      ? "Register this member"
                      : "Capture a face image first"
                }
              >
                {isRegistering ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="h-3 w-3 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                    <span>Processing...</span>
                  </div>
                ) : memberStatus.get(selectedMemberId) ? (
                  <span className="flex items-center justify-center gap-1.5">
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                    Override Registration
                  </span>
                ) : (
                  "Register"
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
