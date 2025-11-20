import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  attendanceManager,
  backendService,
  persistentSettings,
} from "../../../../services";
import { generateDisplayNames } from "../../../../utils";
import type {
  AttendanceGroup,
  AttendanceMember,
} from "../../../../types/recognition";
import { Dropdown } from "../../../shared";

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

      let displayedWidth: number;
      let displayedHeight: number;
      let offsetX = 0;
      let offsetY = 0;

      if (imageAspectRatio > containerAspectRatio) {
        displayedWidth = containerWidth;
        displayedHeight = containerWidth / imageAspectRatio;
        offsetY = (containerHeight - displayedHeight) / 2;
      } else {
        displayedHeight = containerHeight;
        displayedWidth = containerHeight * imageAspectRatio;
        offsetX = (containerWidth - displayedWidth) / 2;
      }

      const bbox = frame.bbox;
      if (!bbox) {
        return;
      }

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

      const styleKey = `${bboxLeft.toFixed(2)},${bboxTop.toFixed(
        2,
      )},${bboxWidth.toFixed(2)},${bboxHeight.toFixed(2)}`;
      if (lastBboxStyleRef.current !== styleKey) {
        lastBboxStyleRef.current = styleKey;
        setBboxStyle(newStyle);
      }
    };

    let timeoutId: NodeJS.Timeout;
    const debouncedCalculate = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(calculateBbox, 16);
    };

    calculateBbox();
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
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCameraState] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);
  
  const setSelectedCamera = useCallback((deviceId: string) => {
    setSelectedCameraState(deviceId);
    persistentSettings
      .setUIState({ selectedCamera: deviceId })
      .catch(console.error);
  }, []);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const membersWithDisplayNames = useMemo(() => {
    return generateDisplayNames(members);
  }, [members]);

  const filteredMembers = useMemo(() => {
    let result = membersWithDisplayNames;

    if (memberSearch.trim()) {
      const query = memberSearch.toLowerCase();
      result = result.filter(
        (member) =>
          member.name.toLowerCase().includes(query) ||
          member.displayName.toLowerCase().includes(query) ||
          member.person_id.toLowerCase().includes(query),
      );
    }

    if (registrationFilter !== "all") {
      result = result.filter((member) => {
        const isRegistered = memberStatus.get(member.person_id) ?? false;
        return registrationFilter === "registered"
          ? isRegistered
          : !isRegistered;
      });
    }

    result = [...result].sort((a, b) => {
      const aRegistered = memberStatus.get(a.person_id) ?? false;
      const bRegistered = memberStatus.get(b.person_id) ?? false;

      if (aRegistered && !bRegistered) return -1;
      if (!aRegistered && bRegistered) return 1;
      return 0;
    });

    return result;
  }, [memberSearch, membersWithDisplayNames, registrationFilter, memberStatus]);

  const resetFrames = useCallback(() => {
    setFrames([]);
    setActiveAngle(REQUIRED_ANGLE);
  }, []);

  useEffect(() => {
    persistentSettings.getUIState().then((uiState) => {
      if (uiState.selectedCamera) {
        setSelectedCameraState(uiState.selectedCamera);
      }
    });
  }, []);

  const getCameraDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(
        (device) => device.kind === "videoinput",
      );
      setCameraDevices(videoDevices);
    } catch {
      setCameraError("Unable to detect cameras. Please make sure your camera is connected.");
    }
  }, []);

  useEffect(() => {
    getCameraDevices();
  }, [getCameraDevices]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
    setIsVideoReady(false);
    setCameraError(null);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      
      setIsStreaming(true);
      setIsVideoReady(false);

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(
        (device) => device.kind === "videoinput",
      );
      
      if (videoDevices.length === 0) {
        throw new Error("No camera detected. Please make sure your camera is connected and try again.");
      }

      setCameraDevices(videoDevices);

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      let deviceIdToUse: string | undefined = undefined;
      let cameraToSelect = selectedCamera;
      
      if (cameraToSelect && videoDevices.length > 0) {
        const deviceExists = videoDevices.some(
          (device) => device.deviceId && device.deviceId === cameraToSelect,
        );
        if (deviceExists) {
          deviceIdToUse = cameraToSelect;
        } else {
          console.warn(
            `Selected camera (${cameraToSelect}) not found. Falling back to first available camera.`,
          );
          const validDevice = videoDevices.find(
            (device) => device.deviceId && device.deviceId.trim() !== "",
          );
          if (validDevice) {
            deviceIdToUse = validDevice.deviceId;
            cameraToSelect = validDevice.deviceId;
            setSelectedCamera(validDevice.deviceId);
          }
        }
      } else if (videoDevices.length > 0 && !cameraToSelect) {
        const validDevice = videoDevices.find(
          (device) => device.deviceId && device.deviceId.trim() !== "",
        );
        if (validDevice) {
          deviceIdToUse = validDevice.deviceId;
          cameraToSelect = validDevice.deviceId;
          setSelectedCamera(validDevice.deviceId);
        }
      }

      if (!deviceIdToUse) {
        throw new Error("No valid camera device found.");
      }

      const constraints: MediaStreamConstraints = {
        video: { deviceId: { ideal: deviceIdToUse } },
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
                if (video.paused) {
                  return video.play();
                }
              })
              .then(() => {
                checkVideoReady();
              })
              .catch((err) => {
                console.error("Video play() failed:", err);
                checkVideoReady();
              });
          });
        };

        await waitForVideoReady();
        
        const video = videoRef.current;
        if (video && video.videoWidth > 0 && video.videoHeight > 0) {
          setIsVideoReady(true);
        }
      } else {
        throw new Error("Video element not available");
      }
    } catch (err) {
      console.error("Error starting camera:", err);
      
      let errorMessage = "Unable to access your camera. Please make sure your camera is connected and try again.";
      if (err instanceof Error) {
        const errorName = err.name;
        if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError") {
          const userAgent = navigator.userAgent.toLowerCase();
          let instructions = "";
          
          if (userAgent.includes("win")) {
            instructions = "Go to Settings → Privacy → Camera → Turn ON 'Allow apps to access your camera'";
          } else if (userAgent.includes("mac")) {
            instructions = "Go to System Settings → Privacy & Security → Camera → Turn ON for this app";
          } else {
            instructions = "Go to your system settings and allow camera access for this application";
          }
          
          errorMessage = `Camera access was blocked. ${instructions}.`;
        } else if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
          errorMessage = "No camera detected. Please make sure your camera is connected and try again.";
        } else if (errorName === "NotReadableError" || errorName === "TrackStartError") {
          errorMessage = "Your camera is being used by another app. Please close other apps (like Zoom, Teams, or your web browser) that might be using the camera, then try again.";
        } else if (errorName === "OverconstrainedError" || errorName === "ConstraintNotSatisfiedError") {
          errorMessage = "Switching to a different camera...";
          try {
            const fallbackConstraints: MediaStreamConstraints = {
              video: true,
              audio: false,
            };
            const fallbackStream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
            streamRef.current = fallbackStream;
            if (videoRef.current) {
              videoRef.current.srcObject = fallbackStream;
              await videoRef.current.play();
              setCameraError(null);
              return;
            }
          } catch (fallbackErr) {
            console.error("Fallback camera start failed:", fallbackErr);
            errorMessage = "Unable to start camera. Please check if your camera is working and not being used by another app.";
          }
        } else {
          errorMessage = "Unable to start camera. Please make sure your camera is connected and not being used by another app.";
        }
      }
      
      setCameraError(errorMessage);
      setIsStreaming(false);
      setIsVideoReady(false);
    }
  }, [selectedCamera, setSelectedCamera]);

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
      console.error("Failed to load member registration status:", error);
    }
  }, [group]);

  useEffect(() => {
    loadMemberStatus();
  }, [loadMemberStatus]);

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => {
        setSuccessMessage(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  useEffect(() => {
    if (onSelectedMemberChange) {
      onSelectedMemberChange(!!selectedMemberId);
    }
  }, [selectedMemberId, onSelectedMemberChange]);

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

  useEffect(() => {
    if (!group) {
      setSelectedMemberId("");
      resetFrames();
      setSuccessMessage(null);
      setGlobalError(null);
      return;
    }

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
  }, [group, resetFrames, members, selectedMemberId]);

  useEffect(() => {
    if (activeAngle !== REQUIRED_ANGLE) {
      setActiveAngle(REQUIRED_ANGLE);
    }
  }, [activeAngle]);

  useEffect(() => {
    if (source !== "live") {
      stopCamera();
    }
  }, [source, stopCamera]);

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
            "No face detected. Make sure your face is visible and in the frame.",
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

      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, -width, 0, width, height);
      ctx.restore();

      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      await captureProcessedFrame(angle, dataUrl, width, height);

      stopCamera();
    },
    [captureProcessedFrame, stopCamera],
  );

  const [isVideoReady, setIsVideoReady] = useState(false);

  useEffect(() => {
    if (!isStreaming) {
      setIsVideoReady(false);
    }
  }, [isStreaming]);

  useEffect(() => {
    if (!isStreaming || !isVideoReady) {
      return;
    }

    const video = videoRef.current;
    if (!video) {
      return;
    }

    const checkVideoUnready = () => {
      const hasSrcObject = !!video.srcObject;
      const hasDimensions = video.videoWidth > 0 && video.videoHeight > 0;
      const isPlaying = !video.paused;
      const noError = !cameraError;
      
      const ready = hasSrcObject && hasDimensions && isPlaying && noError;
      
      if (!ready && isVideoReady) {
        console.warn("Video became unready");
        setIsVideoReady(false);
      }
    };

    const interval = setInterval(checkVideoUnready, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [isStreaming, cameraError, isVideoReady]);

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
        {!selectedMemberId && (
          <div className="space-y-3 flex flex-col overflow-hidden min-h-0 h-full p-6">
            <div className="flex items-center gap-3 flex-shrink-0">
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

            <div className="flex items-center justify-between gap-2 flex-shrink-0">
              {members.length > 0 && filteredMembers.length > 0 && (
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
              )}
              <div className="flex items-center gap-2 ml-auto">
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
            </div>

            <div className="flex-1 space-y-1.5 overflow-y-auto custom-scroll overflow-x-hidden min-h-0">
              {members.length === 0 && (
                <div className="rounded-xl border border-dashed border-white/5 bg-white/[0.02] px-3 py-12 text-center w-full">
                  <div className="text-xs text-white/40">No members yet</div>
                </div>
              )}

              {members.length > 0 && filteredMembers.length === 0 && (
                <div className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-6 text-center w-full">
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

        {selectedMemberId && (
          <div className="flex flex-col h-full overflow-hidden p-6 space-y-2">
            <div className="flex-1 min-h-0 flex flex-col space-y-4 overflow-hidden">
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

              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                {source === "live"
                  ? !frames.find((f) => f.angle === REQUIRED_ANGLE) && (
                      <div className="h-full flex flex-col overflow-hidden relative">
                        <div className="flex-1 relative overflow-hidden rounded-xl border border-white/20 bg-black">
                          <video
                            ref={videoRef}
                            className="w-full h-full object-contain scale-x-[-1]"
                            playsInline
                            muted
                          />
                          {!isStreaming && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/90">
                              <div className="text-center space-y-2">
                                {cameraError ? (
                                  <div className="text-sm text-white/60">
                                    {cameraError}
                                  </div>
                                ) : (
                                  <div className="relative">
                                    <svg
                                      className="w-8 h-8 text-white/30 animate-pulse"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={1.5}
                                        d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                                      />
                                    </svg>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                          {isStreaming && !isVideoReady && !cameraError && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                              <div className="h-12 w-12 rounded-full border-2 border-white/20 border-t-cyan-400 animate-spin" />
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

                          {cameraDevices.length > 0 && !isStreaming && (
                            <div className="absolute bottom-2 left-2 z-10 max-w-[200px]">
                              <Dropdown
                                options={cameraDevices.map((device, index) => ({
                                  value: device.deviceId,
                                  label: device.label || `Camera ${index + 1}`,
                                }))}
                                value={selectedCamera}
                                onChange={(deviceId) => {
                                  if (deviceId) {
                                    setSelectedCamera(deviceId);
                                    if (isStreaming) {
                                      stopCamera();
                                    }
                                  }
                                }}
                                placeholder="Select camera…"
                                emptyMessage="No cameras available"
                                disabled={isStreaming || cameraDevices.length <= 1}
                                maxHeight={256}
                                buttonClassName="text-xs px-2 py-1 bg-black/60 backdrop-blur-sm border border-white/10"
                                showPlaceholderOption={false}
                                allowClear={false}
                              />
                            </div>
                          )}

                          {isStreaming && (
                            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10">
                              <button
                                onClick={() =>
                                  void captureFromCamera(REQUIRED_ANGLE)
                                }
                                disabled={!isVideoReady || !!cameraError}
                                className="px-3 py-1.5 rounded-md backdrop-blur-sm border border-cyan-400/50 bg-cyan-500/40 text-xs font-medium text-cyan-100 hover:bg-cyan-500/50 disabled:bg-black/40 disabled:border-white/10 disabled:text-white/30 disabled:cursor-not-allowed transition-all"
                              >
                                Capture Face
                              </button>
                            </div>
                          )}

                          <div className="absolute bottom-2 right-2 z-10">
                            {(() => {
                              const isCameraSelected =
                                !!selectedCamera &&
                                selectedCamera.trim() !== "" &&
                                cameraDevices.some((device) => device.deviceId === selectedCamera);
                              const canStartCamera = isCameraSelected && !isStreaming;
                              const isButtonEnabled = isStreaming || canStartCamera;
                              
                              return (
                                <button
                                  onClick={isStreaming ? stopCamera : startCamera}
                                  disabled={!isButtonEnabled}
                                  className={`px-2 py-2 rounded-md backdrop-blur-sm border text-xs font-medium transition-all min-w-[100px] ${
                                    isStreaming
                                      ? "bg-red-500/40 border-red-400/50 text-red-100 hover:bg-red-500/50"
                                      : isButtonEnabled
                                        ? "bg-cyan-500/40 border-cyan-400/50 text-cyan-100 hover:bg-cyan-500/50"
                                        : "bg-black/40 border-white/10 text-white/30 cursor-not-allowed opacity-50"
                                  }`}
                                  title={
                                    !isCameraSelected
                                      ? "Please select a camera first"
                                      : isStreaming
                                        ? "Stop camera"
                                        : "Start camera"
                                  }
                                >
                                  {isStreaming ? "Stop Camera" : "Start Camera"}
                                </button>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    )
                  : !frames.find((f) => f.angle === REQUIRED_ANGLE) && (
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

                {frames.find((f) => f.angle === REQUIRED_ANGLE) && (
                  <div className="h-full flex flex-col overflow-hidden relative">
                    {frames
                      .filter((f) => f.angle === REQUIRED_ANGLE)
                      .map((frame) => (
                        <div
                          key={frame.id}
                          className="flex-1 min-h-0 flex flex-col"
                        >
                          <ImagePreviewWithBbox frame={frame} />
                        </div>
                      ))}
                    <div className="absolute top-2 left-2 z-10">
                      <div className="text-md font-medium text-white/80 truncate">
                        {
                          membersWithDisplayNames.find(
                            (m) => m.person_id === selectedMemberId,
                          )?.displayName
                        }
                      </div>
                    </div>
                    
                    <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1.5">
                      <button
                        onClick={resetWorkflow}
                        className="px-2 py-2 rounded-md backdrop-blur-sm border border-white/10 bg-black/40 text-white/70 hover:text-white hover:bg-black/60 text-xs font-medium transition-all min-w-[100px]"
                      >
                        Retake
                      </button>
                      
                      <button
                        onClick={() => void handleRegister()}
                        disabled={!framesReady || !selectedMemberId || isRegistering}
                        className={`px-2 py-2 rounded-md backdrop-blur-sm border text-xs font-medium transition-all min-w-[100px] ${
                          memberStatus.get(selectedMemberId)
                            ? "bg-amber-500/40 border-amber-400/50 text-amber-100 hover:bg-amber-500/50"
                            : "bg-cyan-500/40 border-cyan-400/50 text-cyan-100 hover:bg-cyan-500/50"
                        } disabled:bg-black/40 disabled:border-white/10 disabled:text-white/30 disabled:cursor-not-allowed`}
                        title={
                          memberStatus.get(selectedMemberId)
                            ? "Override existing registration with new face data"
                            : framesReady
                              ? "Register this member"
                              : "Capture a face image first"
                        }
                      >
                        {isRegistering ? (
                          <div className="flex items-center gap-1.5">
                            <div className="h-2.5 w-2.5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                            <span>Processing...</span>
                          </div>
                        ) : memberStatus.get(selectedMemberId) ? (
                          <span className="flex items-center gap-1">
                            <svg
                              className="w-3 h-3"
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
                            Override
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
          </div>
        )}
      </div>
    </div>
  );
}
