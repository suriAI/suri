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
      {globalError && (
        <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200 flex items-center justify-between">
          <span>{globalError}</span>
          <button onClick={() => setGlobalError(null)} className="text-red-200/70 hover:text-red-100">✕</button>
        </div>
      )}

      {successMessage && (
        <div className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 flex items-center justify-between">
          <span>{successMessage}</span>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-200/70 hover:text-emerald-100">✕</button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px,1fr]">
        {/* Members List */}
          <h2 className="text-sm font-semibold text-white mb-3">Members</h2>
          <input
            type="search"
            value={memberSearch}
            onChange={(e) => setMemberSearch(e.target.value)}
            placeholder="Search..."
            className="mb-3 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/40 focus:border-cyan-400 focus:outline-none"
          />

          <div className="max-h-[500px] space-y-2 overflow-y-auto custom-scroll">
            {members.length === 0 && (
              <div className="rounded-lg border border-dashed border-white/10 bg-white/5 px-3 py-8 text-center">
                <div className="text-2xl mb-2">👥</div>
                <div className="text-xs text-white/60">No members in this group</div>
                <div className="text-xs text-white/40 mt-1">Add members in the Menu</div>
              </div>
            )}

            {members.length > 0 && filteredMembers.length === 0 && (
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-center text-xs text-white/60">
                No members match "{memberSearch}"
              </div>
            )}

            {filteredMembers.map(member => {
              const isSelected = selectedMemberId === member.person_id;
              const hasEmbeddings = memberStatus.get(member.person_id) ?? false;
              return (
                <div
                  key={member.person_id}
                  className={`rounded-lg border px-3 py-2 transition ${
                    isSelected ? 'border-cyan-400/60 bg-cyan-500/10' : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <button onClick={() => setSelectedMemberId(member.person_id)} className="w-full text-left">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-white">{member.name}</div>
                        {member.role && (
                          <div className="text-xs text-white/50 mt-0.5">{member.role}</div>
                        )}
                        <div className="text-xs text-white/40 mt-0.5">ID: {member.person_id}</div>
                      </div>
                    </div>
                    <span className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] uppercase ${
                      hasEmbeddings ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/10 text-white/40'
                    }`}>
                      {hasEmbeddings ? '✓ Registered' : 'Not registered'}
                    </span>
                  </button>
                  {hasEmbeddings && (
                    <button
                      onClick={() => handleRemoveFaceData(member)}
                      className="mt-2 w-full rounded-lg bg-red-500/10 px-2 py-1.5 text-xs text-red-200 hover:bg-red-500/20"
                    >
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
          </div>


        {/* Registration Panel */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="mb-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Face Registration</h2>
                <p className="text-xs text-white/50 mt-1">Group: {group ? group.name : 'None selected'}</p>
              </div>
              {selectedMemberId && (
                <div className="text-right">
                  <div className="text-xs text-white/50">Selected</div>
                  <div className="text-sm font-medium text-cyan-200">
                    {members.find(m => m.person_id === selectedMemberId)?.name}
                  </div>
                </div>
              )}
            </div>
            {!selectedMemberId && members.length > 0 && (
              <div className="mt-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 px-3 py-2">
                <div className="text-xs text-yellow-200">👈 Select a member from the list to begin registration</div>
              </div>
            )}
          </div>

          {/* Mode & Source */}
          <div className="grid gap-3 md:grid-cols-2 mb-4">
            <div>
              <span className="text-xs text-white/50 uppercase">Mode</span>
              <div className="mt-1 flex gap-2">
                {(['quick', 'full'] as RegistrationMode[]).map(option => (
                  <button
                    key={option}
                    onClick={() => setMode(option)}
                    disabled={!selectedMemberId}
                    className={`flex-1 rounded-lg px-3 py-1.5 text-xs uppercase transition disabled:opacity-40 disabled:cursor-not-allowed ${
                      mode === option ? 'bg-cyan-400/20 text-cyan-100 border border-cyan-400/40' : 'bg-white/5 text-white/50 border border-white/10'
                    }`}
                  >
                    {option === 'quick' ? 'Quick' : 'Full'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="text-xs text-white/50 uppercase">Source</span>
              <div className="mt-1 flex gap-2">
                {(['upload', 'live'] as CaptureSource[]).map(option => (
                  <button
                    key={option}
                    onClick={() => setSource(option)}
                    disabled={!selectedMemberId}
                    className={`flex-1 rounded-lg px-3 py-1.5 text-xs uppercase transition disabled:opacity-40 disabled:cursor-not-allowed ${
                      source === option ? 'bg-purple-400/20 text-purple-100 border border-purple-400/40' : 'bg-white/5 text-white/50 border border-white/10'
                    }`}
                  >
                    {option === 'upload' ? 'Upload' : 'Camera'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Split Layout: Live Feed Left, Controls Right */}
          <div className="grid gap-3 md:grid-cols-2 mb-4">
            {/* LEFT: Live Feed */}
            <div className="rounded-lg border border-white/10 bg-black/40 p-3">
              {source === 'live' ? (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-white">Live Feed</span>
                    <span className={`text-xs uppercase ${cameraReady ? 'text-emerald-300' : 'text-yellow-200'}`}>
                      {cameraReady ? '● Ready' : '○ Loading'}
                    </span>
                  </div>
                  <div className="relative overflow-hidden rounded-lg border border-white/10 bg-black">
                    <video ref={videoRef} className="w-full rounded-lg" playsInline muted />
                    {!cameraReady && !cameraError && (
                      <div className="absolute inset-0 flex items-center justify-center text-white/60 text-sm">
                        Initializing camera...
                      </div>
                    )}
                    {cameraError && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-center text-sm text-red-200 p-4">
                        {cameraError}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => void captureFromCamera(activeAngle)}
                    disabled={!cameraReady || !!cameraError}
                    className="mt-3 w-full flex items-center justify-center rounded-lg border border-cyan-400/40 bg-cyan-500/10 py-3 text-sm uppercase text-cyan-100 hover:bg-cyan-500/20 disabled:border-white/10 disabled:bg-white/5 disabled:text-white/40"
                  >
                    📸 Capture {activeAngle}
                  </button>
                </>
              ) : (
                <>
                  <span className="text-xs text-white/50 block mb-2">Upload Image</span>
                  <label className="flex h-64 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-white/20 bg-black/60 text-center text-xs text-white/50 hover:border-cyan-400/40">
                    <span className="text-4xl mb-2">📁</span>
                    <span>Click to upload {activeAngle}</span>
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
                </>
              )}
            </div>

            {/* RIGHT: Controls & Preview */}
            <div className="space-y-3">
              {/* Angle Selector */}
              <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                <span className="text-xs text-white/50 uppercase block mb-2">Capture Angles</span>
                <div className="flex flex-wrap gap-2">
                  {requiredAngles.map(angle => {
                    const frame = frames.find(item => item.angle === angle);
                    const statusColor = frame?.status === 'ready' || frame?.status === 'registered' 
                      ? 'border-emerald-400/60 bg-emerald-500/10 text-emerald-200' 
                      : frame?.status === 'error' 
                      ? 'border-red-400/60 bg-red-500/10 text-red-200'
                      : 'border-white/10 bg-white/5 text-white/50';
                    
                    return (
                      <button
                        key={angle}
                        onClick={() => setActiveAngle(angle)}
                        className={`rounded-lg px-3 py-1.5 text-xs uppercase transition border ${
                          activeAngle === angle ? 'border-white/60 bg-white/20 text-white' : statusColor
                        }`}
                      >
                        {angle}
                        {frame && <span className="ml-1">{frame.status === 'ready' || frame.status === 'registered' ? '✓' : frame.status === 'error' ? '✕' : '...'}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Preview */}
              <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                <span className="text-xs text-white/50 block mb-2">Preview - {activeAngle}</span>
                {frames.find(f => f.angle === activeAngle) ? (
                  frames.filter(f => f.angle === activeAngle).map(frame => {
                    const left = frame.bbox ? (frame.bbox[0] / frame.width) * 100 : 0;
                    const top = frame.bbox ? (frame.bbox[1] / frame.height) * 100 : 0;
                    const width = frame.bbox ? (frame.bbox[2] / frame.width) * 100 : 0;
                    const height = frame.bbox ? (frame.bbox[3] / frame.height) * 100 : 0;
                    
                    return (
                      <div key={frame.id} className="space-y-2">
                        <div className="relative rounded-lg overflow-hidden border border-white/10 bg-black">
                          <img src={frame.dataUrl} alt={frame.label} className="w-full" />
                          {frame.status === 'processing' && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-xs text-white/70">
                              Processing...
                            </div>
                          )}
                          {frame.status === 'error' && (
                            <div className="absolute inset-0 flex items-center justify-center bg-red-500/30 text-xs text-red-100 p-2 text-center">
                              {frame.error || 'Error'}
                            </div>
                          )}
                          {frame.status !== 'error' && frame.bbox && (
                            <div
                              className="absolute border-2 border-cyan-300"
                              style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
                            />
                          )}
                        </div>
                        {frame.confidence && (
                          <div className="text-xs text-emerald-300">✓ Confidence: {(frame.confidence * 100).toFixed(0)}%</div>
                        )}
                        <button
                          onClick={() => handleRemoveFrame(frame.angle)}
                          className="w-full rounded-lg bg-white/5 px-2 py-1 text-xs text-white/60 hover:bg-red-500/20 hover:text-red-200"
                        >
                          Retake
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-white/10 bg-black/60 text-xs text-white/40">
                    No capture yet
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <button
              onClick={resetWorkflow}
              className="rounded-lg bg-white/5 px-4 py-2 text-xs uppercase text-white/60 hover:bg-white/10"
            >
              Reset
            </button>
            <button
              onClick={() => void handleRegister()}
              disabled={!framesReady || !selectedMemberId || isRegistering}
              className="rounded-lg bg-cyan-500/20 border border-cyan-400/60 px-5 py-2 text-xs uppercase text-cyan-100 hover:bg-cyan-500/30 disabled:border-white/10 disabled:bg-white/5 disabled:text-white/40"
            >
              {isRegistering ? 'Registering...' : 'Register'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
