import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { attendanceManager } from '../services/AttendanceManager';
import { backendService } from '../services/BackendService';
import type { AttendanceGroup, AttendanceMember } from '../types/recognition';

type RegistrationMode = 'quick' | 'full';
type CaptureSource = 'upload' | 'live';

type FrameStatus = 'pending' | 'processing' | 'ready' | 'error' | 'registered';

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
  error?: string;
}

interface FaceRegistrationLabProps {
  group: AttendanceGroup | null;
  members: AttendanceMember[];
  onRefresh?: () => Promise<void> | void;
}

const REQUIRED_ANGLES: Record<RegistrationMode, string[]> = {
  quick: ['Front'],
  full: ['Front', 'Profile Left', 'Profile Right']
};

const makeId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `frame-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const toBase64Payload = (dataUrl: string) => {
  const [, payload] = dataUrl.split(',');
  return payload || dataUrl;
};

const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
  reader.readAsDataURL(file);
});

const getImageDimensions = (dataUrl: string) => new Promise<{ width: number; height: number }>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve({ width: img.width, height: img.height });
  img.onerror = () => reject(new Error('Unable to load image preview'));
  img.src = dataUrl;
});

export function FaceRegistrationLab({ group, members, onRefresh }: FaceRegistrationLabProps) {
  const [mode, setMode] = useState<RegistrationMode>('quick');
  const [source, setSource] = useState<CaptureSource>('upload');
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [frames, setFrames] = useState<CapturedFrame[]>([]);
  const [activeAngle, setActiveAngle] = useState<string>(REQUIRED_ANGLES.quick[0]);
  const [memberStatus, setMemberStatus] = useState<Map<string, boolean>>(new Map());
  const [backendReady, setBackendReady] = useState(false);
  const [backendStatus, setBackendStatus] = useState<string>('Checking systems...');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isCheckingBackend, setIsCheckingBackend] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const requiredAngles = useMemo(() => REQUIRED_ANGLES[mode], [mode]);

  const filteredMembers = useMemo(() => {
    if (!memberSearch.trim()) return members;
    const query = memberSearch.toLowerCase();
    return members.filter(member =>
      member.name.toLowerCase().includes(query) ||
      member.person_id.toLowerCase().includes(query)
    );
  }, [memberSearch, members]);

  const resetFrames = useCallback(() => {
    setFrames([]);
    setActiveAngle(REQUIRED_ANGLES[mode][0]);
  }, [mode]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
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
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch (error) {
      console.error('🚨 Camera start failed:', error);
      setCameraError('Unable to access camera. Please check permissions or switch to upload mode.');
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
      persons.forEach(person => status.set(person.person_id, person.has_face_data));
      setMemberStatus(status);
    } catch (error) {
      console.error('⚠️ Failed to load member registration status:', error);
    }
  }, [group]);

  const checkBackend = useCallback(async () => {
    setIsCheckingBackend(true);
    try {
      setBackendStatus('Aligning recognition engines...');
      const readiness = await backendService.checkReadiness();
      if (readiness.ready && readiness.modelsLoaded) {
        setBackendReady(true);
        setBackendStatus('Recognition core online');
      } else {
        setBackendReady(false);
        setBackendStatus(readiness.error || 'Models are still loading. Please wait a few seconds.');
      }
    } catch (error) {
      setBackendReady(false);
      setBackendStatus('Backend unreachable. Please start the FastAPI backend.');
      console.error('⚠️ Backend readiness check failed:', error);
    } finally {
      setIsCheckingBackend(false);
    }
  }, []);

  useEffect(() => {
    checkBackend();
    const interval = setInterval(checkBackend, 20000);
    return () => clearInterval(interval);
  }, [checkBackend]);

  useEffect(() => {
    loadMemberStatus();
  }, [loadMemberStatus]);

  useEffect(() => {
    if (group) {
      setSelectedMemberId('');
    }
    resetFrames();
    setSuccessMessage(null);
    setGlobalError(null);
  }, [group, mode, resetFrames]);

  useEffect(() => {
    if (!requiredAngles.includes(activeAngle)) {
      setActiveAngle(requiredAngles[0]);
    }
  }, [requiredAngles, activeAngle]);

  useEffect(() => {
    if (source === 'live') {
      startCamera();
      return () => stopCamera();
    }
    stopCamera();
  }, [source, startCamera, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const updateFrame = useCallback((frameId: string, updater: (frame: CapturedFrame) => CapturedFrame) => {
    setFrames(prev => prev.map(frame => (frame.id === frameId ? updater(frame) : frame)));
  }, []);

  const captureProcessedFrame = useCallback(async (angle: string, dataUrl: string, width: number, height: number) => {
    const id = makeId();
    const label = angle;

    setGlobalError(null);
    setSuccessMessage(null);

    setFrames(prev => {
      const others = prev.filter(frame => frame.angle !== angle);
      return [
        ...others,
        {
          id,
          angle,
          label,
          dataUrl,
          width,
          height,
          status: 'processing'
        }
      ];
    });

    try {
      const detection = await backendService.detectFaces(toBase64Payload(dataUrl), {
        model_type: 'yunet',
        confidence_threshold: mode === 'quick' ? 0.5 : 0.55,
        nms_threshold: 0.3
      });

      if (!detection.faces || detection.faces.length === 0) {
        throw new Error('No face detected. Please try again with better lighting or framing.');
      }

      const bestFace = detection.faces.reduce((best, current) =>
        (current.confidence ?? 0) > (best.confidence ?? 0) ? current : best,
        detection.faces[0]
      );

      if (!bestFace.bbox) {
        throw new Error('Face detected but bounding box missing.');
      }

      updateFrame(id, frame => ({
        ...frame,
        status: 'ready',
        confidence: bestFace.confidence,
        bbox: bestFace.bbox,
        error: undefined
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Face analysis failed. Please try again.';
      updateFrame(id, frame => ({
        ...frame,
        status: 'error',
        error: message,
        confidence: undefined,
        bbox: undefined
      }));
    }
  }, [mode, updateFrame]);

  const captureFromCamera = useCallback(async (angle: string) => {
    if (!videoRef.current) {
      setCameraError('Camera feed not ready yet.');
      return;
    }

    if (!captureCanvasRef.current) {
      captureCanvasRef.current = document.createElement('canvas');
    }

    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    const width = video.videoWidth;
    const height = video.videoHeight;

    if (!width || !height) {
      setCameraError('Camera is still initializing. Please wait a moment.');
      return;
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setCameraError('Unable to capture from camera.');
      return;
    }

    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    await captureProcessedFrame(angle, dataUrl, width, height);
  }, [captureProcessedFrame]);

  const handleFileSelected = useCallback(async (angle: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];

    if (!file.type.startsWith('image/')) {
      setGlobalError('Please upload a valid image file.');
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const { width, height } = await getImageDimensions(dataUrl);
      await captureProcessedFrame(angle, dataUrl, width, height);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to process the selected image.';
      setGlobalError(message);
    }
  }, [captureProcessedFrame]);

  const handleRemoveFrame = useCallback((angle: string) => {
    setFrames(prev => prev.filter(frame => frame.angle !== angle));
  }, []);

  const framesReady = requiredAngles.every(angle => {
    const frame = frames.find(item => item.angle === angle);
    return frame && (frame.status === 'ready' || frame.status === 'registered');
  });

  const handleRegister = useCallback(async () => {
    if (!group) {
      setGlobalError('Please select a group in the Attendance Dashboard to continue.');
      return;
    }

    if (!selectedMemberId) {
      setGlobalError('Select a member to bind these embeddings to.');
      return;
    }

    if (!framesReady) {
      setGlobalError('Capture or upload all required angles before registering.');
      return;
    }

    setIsRegistering(true);
    setGlobalError(null);
    setSuccessMessage(null);

    try {
      for (const angle of requiredAngles) {
        const frame = frames.find(item => item.angle === angle);
        if (!frame || !frame.bbox) {
          throw new Error(`Missing processed frame for ${angle}.`);
        }

        const payload = toBase64Payload(frame.dataUrl);
        const result = await attendanceManager.registerFaceForGroupPerson(
          group.id,
          selectedMemberId,
          payload,
          frame.bbox
        );

        if (!result.success) {
          throw new Error(result.error || `Registration failed for ${angle}.`);
        }

        updateFrame(frame.id, current => ({ ...current, status: 'registered' }));
      }

      setSuccessMessage(
        mode === 'quick'
          ? 'Quick registration synced. Identity embedded successfully.'
          : 'Full-spectrum registration complete. Multi-angle embeddings secured.'
      );

      await loadMemberStatus();
      if (onRefresh) {
        await onRefresh();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed. Please try again.';
      setGlobalError(message);
    } finally {
      setIsRegistering(false);
    }
  }, [group, selectedMemberId, framesReady, requiredAngles, frames, mode, loadMemberStatus, onRefresh, updateFrame]);

  const handleRemoveFaceData = useCallback(async (member: AttendanceMember) => {
    if (!group) return;
    const confirmation = window.confirm(`Remove all face embeddings for ${member.name}?`);
    if (!confirmation) return;

    try {
      const result = await attendanceManager.removeFaceDataForGroupPerson(group.id, member.person_id);
      if (!result.success) {
        throw new Error(result.error || 'Failed to remove embeddings');
      }
      await loadMemberStatus();
      if (onRefresh) {
        await onRefresh();
      }
      setSuccessMessage(`Embeddings purged for ${member.name}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove face data.';
      setGlobalError(message);
    }
  }, [group, loadMemberStatus, onRefresh]);

  const resetWorkflow = useCallback(() => {
    resetFrames();
    setSuccessMessage(null);
    setGlobalError(null);
  }, [resetFrames]);

  return (
    <div className="h-full overflow-y-auto p-6 bg-gradient-to-br from-black via-slate-950 to-black">
      {!backendReady && (
        <div className="mb-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-yellow-200">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium tracking-wide uppercase">{backendStatus}</span>
            <button
              type="button"
              onClick={checkBackend}
              disabled={isCheckingBackend}
              className="rounded-full border border-yellow-500/40 px-3 py-1 text-xs uppercase tracking-wider text-yellow-200 transition hover:bg-yellow-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCheckingBackend ? 'Syncing...' : 'Re-check'}
            </button>
          </div>
          <p className="mt-2 text-xs text-yellow-200/80">
            Make sure the FastAPI backend is running so we can analyse faces in real-time.
          </p>
        </div>
      )}

      {globalError && (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-200">
          <div className="flex items-center justify-between">
            <span className="font-semibold uppercase tracking-wide">{globalError}</span>
            <button
              type="button"
              onClick={() => setGlobalError(null)}
              className="text-red-200/70 transition hover:text-red-100"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-emerald-200">
          <div className="flex items-center justify-between">
            <span className="font-semibold uppercase tracking-wide">{successMessage}</span>
            <button
              type="button"
              onClick={() => setSuccessMessage(null)}
              className="text-emerald-200/70 transition hover:text-emerald-100"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px,1fr]">
  <div className="rounded-2xl border border-white/5 bg-white/5 bg-gradient-to-br from-slate-900/80 via-black to-slate-950/80 p-5 backdrop-blur-xl">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Members</h2>
              <p className="text-xs uppercase tracking-[0.3em] text-white/50">Select identity target</p>
            </div>
          </div>

          <input
            type="search"
            value={memberSearch}
            onChange={(event) => setMemberSearch(event.target.value)}
            placeholder="Search by name or ID..."
            className="mb-4 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-cyan-400 focus:outline-none"
          />

          <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
            {filteredMembers.length === 0 && (
              <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-4 text-center text-sm text-white/60">
                No members found.
              </div>
            )}

            {filteredMembers.map(member => {
              const isSelected = selectedMemberId === member.person_id;
              const hasEmbeddings = memberStatus.get(member.person_id) ?? false;
              return (
                <div
                  key={member.person_id}
                  className={`group rounded-xl border px-3 py-3 transition-all ${
                    isSelected
                      ? 'border-cyan-400/60 bg-cyan-500/10'
                      : 'border-white/10 bg-white/5 hover:border-cyan-500/30 hover:bg-white/10'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedMemberId(member.person_id)}
                    className="flex w-full items-start justify-between text-left"
                  >
                    <div>
                      <div className="text-sm font-semibold text-white">
                        {member.name}
                      </div>
                      <div className="text-xs text-white/60">ID: {member.person_id}</div>
                      {member.role && (
                        <div className="mt-1 inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-widest text-white/60">
                          {member.role}
                        </div>
                      )}
                    </div>
                    <div className="ml-3 flex items-center space-x-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                          hasEmbeddings
                            ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                            : 'border border-white/10 bg-white/5 text-white/50'
                        }`}
                      >
                        {hasEmbeddings ? 'Registered' : 'No Embeddings'}
                      </span>
                    </div>
                  </button>

                  {hasEmbeddings && (
                    <button
                      type="button"
                      onClick={() => handleRemoveFaceData(member)}
                      className="mt-3 w-full rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs uppercase tracking-wider text-red-200 transition-all hover:bg-red-500/20"
                    >
                      Remove Embeddings
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-3xl border border-white/5 bg-gradient-to-br from-slate-900/80 via-black to-slate-950/90 p-6 backdrop-blur-xl shadow-[0_0_60px_rgba(14,116,144,0.25)]">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-2xl font-light tracking-[0.2em] text-white uppercase">Face Registration Lab</h2>
                <p className="text-sm text-white/60">Craft high-fidelity embeddings via upload or live capture.</p>
              </div>
              <div className="flex gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.3em] text-white/60">
                  Group: {group ? group.name : 'None selected'}
                </div>
                <div className={`rounded-2xl border px-3 py-2 text-xs uppercase tracking-[0.3em] ${
                  backendReady ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200'
                }`}>
                  {backendReady ? 'Engines Online' : 'Awaiting Backend'}
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4">
                <span className="text-xs uppercase tracking-[0.4em] text-cyan-200">Mode</span>
                <div className="mt-3 flex gap-2">
                  {(['quick', 'full'] as RegistrationMode[]).map(option => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setMode(option)}
                      className={`flex-1 rounded-xl border px-3 py-2 text-sm uppercase tracking-[0.3em] transition ${
                        mode === option
                          ? 'border-cyan-300 bg-cyan-400/20 text-cyan-100'
                          : 'border-white/10 bg-white/5 text-white/50 hover:border-cyan-400/40 hover:text-cyan-200'
                      }`}
                    >
                      {option === 'quick' ? 'Quick Capture' : 'Full Spectrum'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-purple-500/30 bg-purple-500/10 p-4">
                <span className="text-xs uppercase tracking-[0.4em] text-purple-200">Source</span>
                <div className="mt-3 flex gap-2">
                  {(['upload', 'live'] as CaptureSource[]).map(option => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setSource(option)}
                      className={`flex-1 rounded-xl border px-3 py-2 text-sm uppercase tracking-[0.3em] transition ${
                        source === option
                          ? 'border-purple-300 bg-purple-400/20 text-purple-100'
                          : 'border-white/10 bg-white/5 text-white/50 hover:border-purple-400/40 hover:text-purple-200'
                      }`}
                    >
                      {option === 'upload' ? 'Upload' : 'Live Camera'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {source === 'live' && (
              <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Live Capture Feed</h3>
                    <p className="text-xs text-white/50">Align the subject, then capture per required angle.</p>
                  </div>
                  <div className={`text-xs uppercase tracking-[0.3em] ${cameraReady ? 'text-emerald-300' : 'text-yellow-200'}`}>
                    {cameraReady ? 'Camera Ready' : 'Booting Camera'}
                  </div>
                </div>
                <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black/80">
                  <video
                    ref={videoRef}
                    className="w-full rounded-xl"
                    playsInline
                    muted
                  />
                  {!cameraReady && !cameraError && (
                    <div className="absolute inset-0 flex items-center justify-center text-white/60">
                      Initializing camera...
                    </div>
                  )}
                  {cameraError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-center text-sm text-red-200">
                      {cameraError}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-center gap-3">
                {requiredAngles.map(angle => {
                  const frame = frames.find(item => item.angle === angle);
                  return (
                    <button
                      key={angle}
                      type="button"
                      onClick={() => setActiveAngle(angle)}
                      className={`rounded-xl border px-3 py-2 text-xs uppercase tracking-[0.3em] transition ${
                        activeAngle === angle
                          ? 'border-white/60 bg-white/20 text-white'
                          : 'border-white/10 bg-white/5 text-white/50 hover:border-white/40 hover:text-white/80'
                      }`}
                    >
                      {angle}
                      {frame && (
                        <span className="ml-2 inline-flex items-center rounded-full border border-white/10 bg-black/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] text-white/60">
                          {frame.status === 'ready' && 'Analysed'}
                          {frame.status === 'processing' && 'Processing'}
                          {frame.status === 'error' && 'Retry needed'}
                          {frame.status === 'registered' && 'Synced'}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-black/60 p-4">
                <h3 className="text-sm font-semibold text-white">{activeAngle}</h3>
                <p className="text-xs text-white/50">{mode === 'quick' ? 'Capture a clean frontal face.' : 'Capture each angle for extreme precision.'}</p>

                <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,360px),1fr]">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    {source === 'upload' ? (
                      <label className="flex h-48 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/20 bg-black/60 px-4 text-center text-xs text-white/50 transition hover:border-cyan-400/40 hover:text-cyan-200">
                        <span>Drop an image here or click to browse</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(event) => {
                            void handleFileSelected(activeAngle, event.target.files);
                            event.target.value = '';
                          }}
                        />
                      </label>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void captureFromCamera(activeAngle)}
                        disabled={!cameraReady || !!cameraError}
                        className="flex h-48 w-full items-center justify-center rounded-xl border border-cyan-400/40 bg-cyan-500/10 text-sm uppercase tracking-[0.3em] text-cyan-100 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-white/40"
                      >
                        {cameraError ? 'Camera unavailable' : 'Capture frame'}
                      </button>
                    )}
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/40 p-4">
                    {frames.find(frame => frame.angle === activeAngle) ? (
                      frames.filter(frame => frame.angle === activeAngle).map(frame => {
                        const left = frame.bbox ? (frame.bbox[0] / frame.width) * 100 : 0;
                        const top = frame.bbox ? (frame.bbox[1] / frame.height) * 100 : 0;
                        const width = frame.bbox ? (frame.bbox[2] / frame.width) * 100 : 0;
                        const height = frame.bbox ? (frame.bbox[3] / frame.height) * 100 : 0;
                        return (
                          <div key={frame.id} className="space-y-3">
                            <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
                              <img src={frame.dataUrl} alt={`${frame.label} capture`} className="w-full" />
                              {frame.status === 'processing' && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm text-white/70">
                                  Analysing facial geometry...
                                </div>
                              )}
                              {frame.status === 'error' && (
                                <div className="absolute inset-0 flex items-center justify-center bg-red-500/30 text-center text-sm text-red-100">
                                  {frame.error || 'Detection failed. Retake required.'}
                                </div>
                              )}
                              {frame.status !== 'error' && frame.bbox && (
                                <div
                                  className="absolute border border-cyan-300/90 bg-cyan-400/10"
                                  style={{
                                    left: `${left}%`,
                                    top: `${top}%`,
                                    width: `${width}%`,
                                    height: `${height}%`
                                  }}
                                />
                              )}
                            </div>
                            <div className="flex items-center justify-between text-xs text-white/60">
                              <span>Status: {frame.status === 'ready' ? 'Ready for embedding' : frame.status === 'registered' ? 'Registered' : frame.status === 'error' ? 'Needs attention' : 'Processing'}</span>
                              {frame.confidence && (
                                <span className="font-mono text-emerald-300">Confidence: {(frame.confidence * 100).toFixed(1)}%</span>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => handleRemoveFrame(frame.angle)}
                                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.3em] text-white/60 transition hover:border-red-400/40 hover:text-red-200"
                              >
                                Retake
                              </button>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-white/10 bg-black/60 text-xs text-white/40">
                        Awaiting capture for {activeAngle}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="text-xs uppercase tracking-[0.3em] text-white/60">
                {framesReady ? 'All required captures analysed. Ready to embed.' : 'Complete all captures to unlock registration.'}
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={resetWorkflow}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.3em] text-white/60 transition hover:border-white/40 hover:text-white"
                >
                  Reset Workflow
                </button>
                <button
                  type="button"
                  onClick={() => void handleRegister()}
                  disabled={!framesReady || !selectedMemberId || !backendReady || isRegistering}
                  className="rounded-xl border border-cyan-400/60 bg-cyan-500/20 px-5 py-2 text-xs uppercase tracking-[0.4em] text-cyan-100 transition hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-white/40"
                >
                  {isRegistering ? 'Embedding...' : 'Register Identity'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
