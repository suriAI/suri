import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { attendanceManager } from '../../../../services/AttendanceManager';
import { backendService } from '../../../../services/BackendService';
import type { AttendanceGroup, AttendanceMember } from '../../../../types/recognition';

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

interface FaceCaptureProps {
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

export function FaceCapture({ group, members, onRefresh }: FaceCaptureProps) {
  const [mode, setMode] = useState<RegistrationMode>('quick');
  const [source, setSource] = useState<CaptureSource>('upload');
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [frames, setFrames] = useState<CapturedFrame[]>([]);
  const [activeAngle, setActiveAngle] = useState<string>(REQUIRED_ANGLES.quick[0]);
  const [memberStatus, setMemberStatus] = useState<Map<string, boolean>>(new Map());
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

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
        video: true,
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

  useEffect(() => {
    loadMemberStatus();
  }, [loadMemberStatus]);

  // Auto-select first member without embeddings if none selected
  useEffect(() => {
    if (!selectedMemberId && members.length > 0 && memberStatus.size > 0) {
      const unregisteredMember = members.find(m => !memberStatus.get(m.person_id));
      if (unregisteredMember) {
        setSelectedMemberId(unregisteredMember.person_id);
      }
    }
  }, [selectedMemberId, members, memberStatus]);

  useEffect(() => {
    if (group) {
      // Keep selection if member still exists in the group
      const memberExists = members.some(m => m.person_id === selectedMemberId);
      if (!memberExists) {
        setSelectedMemberId('');
      }
    } else {
      setSelectedMemberId('');
    }
    resetFrames();
    setSuccessMessage(null);
    setGlobalError(null);
  }, [group, mode, resetFrames, members, selectedMemberId]);

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
        model_type: 'yunet'
      });

      if (!detection.faces || detection.faces.length === 0) {
        throw new Error('No face detected. Try better lighting, remove glasses, or face the camera directly.');
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
  }, [updateFrame]);

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
    
    // Auto-advance to next angle in Full Spectrum mode
    const currentIndex = requiredAngles.indexOf(angle);
    if (currentIndex >= 0 && currentIndex < requiredAngles.length - 1) {
      setActiveAngle(requiredAngles[currentIndex + 1]);
    }
  }, [captureProcessedFrame, requiredAngles]);

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
      setGlobalError('No group selected. Please go to Menu and select a group first.');
      return;
    }

    if (!selectedMemberId) {
      setGlobalError('No member selected. Please select a member from the list on the left.');
      return;
    }

    // Validate member still exists
    const selectedMember = members.find(m => m.person_id === selectedMemberId);
    if (!selectedMember) {
      setGlobalError('Selected member no longer exists. Please select another member.');
      setSelectedMemberId('');
      return;
    }

    if (!framesReady) {
      const missingAngles = requiredAngles.filter(angle => {
        const frame = frames.find(f => f.angle === angle);
        return !frame || (frame.status !== 'ready' && frame.status !== 'registered');
      });
      setGlobalError(`Missing or invalid captures for: ${missingAngles.join(', ')}. Please complete all required angles.`);
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
  }, [group, selectedMemberId, framesReady, requiredAngles, frames, mode, loadMemberStatus, onRefresh, updateFrame, members]);

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
    <div className="h-full overflow-y-auto">
      {/* Alerts */}
      {globalError && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/5 backdrop-blur-xl px-4 py-3 text-sm text-red-200 flex items-center gap-3">
          <div className="h-1 w-1 rounded-full bg-red-400 animate-pulse" />
          <span className="flex-1">{globalError}</span>
          <button onClick={() => setGlobalError(null)} className="text-red-200/50 hover:text-red-100 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {successMessage && (
        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 backdrop-blur-xl px-4 py-3 text-sm text-emerald-200 flex items-center gap-3">
          <div className="h-1 w-1 rounded-full bg-emerald-400 animate-pulse" />
          <span className="flex-1">{successMessage}</span>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-200/50 hover:text-emerald-100 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[260px,1fr]">
        {/* Members List */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-white/60">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <span className="text-xs uppercase tracking-wide">Select Member</span>
          </div>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Search members..."
              className="w-full rounded-xl border border-white/10 bg-white/5 pl-10 pr-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-cyan-400/50 focus:bg-white/10 focus:outline-none transition-all"
            />
          </div>

          <div className="max-h-[500px] space-y-1.5 overflow-y-auto custom-scroll">
            {members.length === 0 && (
              <div className="rounded-xl border border-dashed border-white/5 bg-white/[0.02] px-3 py-12 text-center">
                <div className="text-3xl mb-2 opacity-40">👥</div>
                <div className="text-xs text-white/40">No members yet</div>
              </div>
            )}

            {members.length > 0 && filteredMembers.length === 0 && (
              <div className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-6 text-center">
                <div className="text-xs text-white/40">No results for "{memberSearch}"</div>
              </div>
            )}

            {filteredMembers.map(member => {
              const isSelected = selectedMemberId === member.person_id;
              const hasEmbeddings = memberStatus.get(member.person_id) ?? false;
              return (
                <button
                  key={member.person_id}
                  onClick={() => setSelectedMemberId(member.person_id)}
                  className={`group relative w-full rounded-xl border px-3 py-3 text-left transition-all ${
                    isSelected 
                      ? 'border-cyan-400/40 bg-gradient-to-br from-cyan-500/10 to-cyan-600/5' 
                      : 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-lg text-lg ${
                      hasEmbeddings ? 'bg-emerald-500/20' : 'bg-white/5'
                    }`}>
                      {hasEmbeddings ? '✓' : '👤'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">{member.name}</div>
                      {member.role && (
                        <div className="text-xs text-white/40 truncate">{member.role}</div>
                      )}
                    </div>
                    {isSelected && (
                      <div className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
                    )}
                  </div>
                  {hasEmbeddings && isSelected && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFaceData(member);
                      }}
                      className="mt-2 w-full rounded-lg bg-red-500/10 px-2 py-1.5 text-xs text-red-300 hover:bg-red-500/20 hover:text-red-200 transition-colors"
                    >
                      Remove Face Data
                    </button>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Registration Panel */}
        <div className="space-y-4">
          {/* Header */}
          {selectedMemberId ? (
            <div className="rounded-xl border border-cyan-400/20 bg-gradient-to-br from-cyan-500/5 to-transparent p-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-cyan-600/10 flex items-center justify-center text-xl">
                  👤
                </div>
                <div className="flex-1">
                  <div className="text-lg font-medium text-white">
                    {members.find(m => m.person_id === selectedMemberId)?.name}
                  </div>
                  <div className="text-xs text-white/40">{group?.name}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
              <div className="text-3xl mb-2 opacity-40">←</div>
              <div className="text-sm text-white/40">Select a member to start</div>
            </div>
          )}

          {selectedMemberId && (
            <>
              {/* Controls */}
              <div className="flex gap-2">
                {(['quick', 'full'] as RegistrationMode[]).map(option => (
                  <button
                    key={option}
                    onClick={() => setMode(option)}
                    className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                      mode === option 
                        ? 'bg-gradient-to-br from-cyan-500/20 to-cyan-600/10 text-cyan-100 border border-cyan-400/40 shadow-lg shadow-cyan-500/10' 
                        : 'bg-white/5 text-white/40 border border-white/10 hover:bg-white/10 hover:text-white/60'
                    }`}
                  >
                    {option === 'quick' ? '⚡ Quick' : '🎯 Multi-angle'}
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                {(['upload', 'live'] as CaptureSource[]).map(option => (
                  <button
                    key={option}
                    onClick={() => setSource(option)}
                    className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                      source === option 
                        ? 'bg-gradient-to-br from-purple-500/20 to-purple-600/10 text-purple-100 border border-purple-400/40 shadow-lg shadow-purple-500/10' 
                        : 'bg-white/5 text-white/40 border border-white/10 hover:bg-white/10 hover:text-white/60'
                    }`}
                  >
                    {option === 'upload' ? '📁 Upload' : '📷 Camera'}
                  </button>
                ))}
              </div>

              {/* Capture Area */}
              <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-black/60 to-black/40 overflow-hidden">
                {source === 'live' ? (
                  <div className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`h-2 w-2 rounded-full ${cameraReady ? 'bg-emerald-400 animate-pulse' : 'bg-yellow-400'}`} />
                        <span className="text-xs text-white/60">
                          {cameraReady ? 'Ready' : 'Initializing...'}
                        </span>
                      </div>
                    </div>
                    <div className="relative overflow-hidden rounded-xl border border-white/20 bg-black aspect-video">
                      <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
                      {!cameraReady && !cameraError && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="flex flex-col items-center gap-2">
                            <div className="h-8 w-8 rounded-full border-2 border-white/20 border-t-cyan-400 animate-spin" />
                            <span className="text-xs text-white/40">Loading camera...</span>
                          </div>
                        </div>
                      )}
                      {cameraError && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/90 p-4 text-center">
                          <div className="space-y-2">
                            <div className="text-2xl">📷</div>
                            <div className="text-xs text-red-300">{cameraError}</div>
                          </div>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => void captureFromCamera(activeAngle)}
                      disabled={!cameraReady || !!cameraError}
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500/20 to-cyan-600/20 border border-cyan-400/40 py-4 text-sm font-medium text-cyan-100 hover:from-cyan-500/30 hover:to-cyan-600/30 disabled:from-white/5 disabled:to-white/5 disabled:border-white/10 disabled:text-white/30 transition-all"
                    >
                      <span className="text-lg">📸</span>
                      Capture
                    </button>
                  </div>
                ) : (
                  <label className="flex h-96 cursor-pointer flex-col items-center justify-center p-8 text-center hover:bg-white/5 transition-all group">
                    <div className="flex flex-col items-center gap-4">
                      <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-purple-500/20 to-purple-600/10 flex items-center justify-center text-4xl group-hover:scale-110 transition-transform">
                        📁
                      </div>
                      <div>
                        <div className="text-sm text-white/60 mb-1">Drop image or click to browse</div>
                        <div className="text-xs text-white/30">PNG, JPG up to 10MB</div>
                      </div>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        void handleFileSelected(activeAngle, e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </label>
                )}
              </div>

              {/* Angle Selector & Preview */}
              <div className="space-y-3">
                {/* Angles */}
                <div className="flex gap-2">
                  {requiredAngles.map(angle => {
                    const frame = frames.find(item => item.angle === angle);
                    const isActive = activeAngle === angle;
                    const isComplete = frame?.status === 'ready' || frame?.status === 'registered';
                    const hasError = frame?.status === 'error';
                    
                    return (
                      <button
                        key={angle}
                        onClick={() => setActiveAngle(angle)}
                        className={`flex-1 rounded-xl px-3 py-2.5 text-xs font-medium transition-all border ${
                          isActive
                            ? 'bg-white/10 border-white/20 text-white'
                            : isComplete
                            ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-300'
                            : hasError
                            ? 'bg-red-500/10 border-red-400/30 text-red-300'
                            : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1.5">
                          {isComplete && '✓'}
                          {hasError && '✕'}
                          {frame?.status === 'processing' && '...'}
                          <span>{angle}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Preview */}
                <div className="rounded-xl border border-white/10 bg-black/20 overflow-hidden">
                  <div className="p-2 border-b border-white/10">
                    <div className="text-xs text-white/40">{activeAngle}</div>
                  </div>
                  <div className="p-3">
                    {frames.find(f => f.angle === activeAngle) ? (
                      frames.filter(f => f.angle === activeAngle).map(frame => {
                        const left = frame.bbox ? (frame.bbox[0] / frame.width) * 100 : 0;
                        const top = frame.bbox ? (frame.bbox[1] / frame.height) * 100 : 0;
                        const width = frame.bbox ? (frame.bbox[2] / frame.width) * 100 : 0;
                        const height = frame.bbox ? (frame.bbox[3] / frame.height) * 100 : 0;
                        
                        return (
                          <div key={frame.id} className="space-y-2">
                            <div className="relative rounded-lg overflow-hidden bg-black">
                              <img src={frame.dataUrl} alt={frame.label} className="w-full" />
                              {frame.status === 'processing' && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                                  <div className="flex flex-col items-center gap-2">
                                    <div className="h-6 w-6 rounded-full border-2 border-white/20 border-t-cyan-400 animate-spin" />
                                    <span className="text-xs text-white/60">Analyzing...</span>
                                  </div>
                                </div>
                              )}
                              {frame.status === 'error' && (
                                <div className="absolute inset-0 flex items-center justify-center bg-red-500/20 backdrop-blur-sm p-3 text-center">
                                  <div className="space-y-1">
                                    <div className="text-xl">⚠️</div>
                                    <div className="text-xs text-red-200">{frame.error || 'Failed'}</div>
                                  </div>
                                </div>
                              )}
                              {frame.status !== 'error' && frame.bbox && (
                                <div
                                  className="absolute border-2 border-cyan-400 shadow-lg shadow-cyan-400/50"
                                  style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
                                />
                              )}
                            </div>
                            {frame.confidence && (
                              <div className="flex items-center gap-2 text-xs">
                                <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400"
                                    style={{ width: `${frame.confidence * 100}%` }}
                                  />
                                </div>
                                <span className="text-emerald-300">{(frame.confidence * 100).toFixed(0)}%</span>
                              </div>
                            )}
                            <button
                              onClick={() => handleRemoveFrame(frame.angle)}
                              className="w-full rounded-lg bg-white/5 px-3 py-2 text-xs text-white/50 hover:bg-red-500/20 hover:text-red-300 transition-colors"
                            >
                              Retake
                            </button>
                          </div>
                        );
                      })
                    ) : (
                      <div className="flex h-40 items-center justify-center text-center">
                        <div className="space-y-2">
                          <div className="text-3xl opacity-20">📷</div>
                          <div className="text-xs text-white/30">No capture</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={resetWorkflow}
                  className="flex-1 rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white/50 hover:bg-white/10 hover:text-white/70 transition-all"
                >
                  Reset
                </button>
                <button
                  onClick={() => void handleRegister()}
                  disabled={!framesReady || !selectedMemberId || isRegistering}
                  className="flex-1 rounded-xl bg-gradient-to-r from-emerald-500/20 to-emerald-600/20 border border-emerald-400/40 px-4 py-3 text-sm font-medium text-emerald-100 hover:from-emerald-500/30 hover:to-emerald-600/30 disabled:from-white/5 disabled:to-white/5 disabled:border-white/10 disabled:text-white/30 transition-all shadow-lg shadow-emerald-500/10 disabled:shadow-none"
                >
                  {isRegistering ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="h-3 w-3 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                      <span>Processing...</span>
                    </div>
                  ) : (
                    'Register'
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

