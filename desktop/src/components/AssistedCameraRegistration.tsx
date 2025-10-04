import { useState, useCallback, useEffect, useRef } from 'react';
import { attendanceManager } from '../services/AttendanceManager';
import { backendService } from '../services/BackendService';
import type { AttendanceGroup, AttendanceMember } from '../types/recognition';

type RegistrationMode = 'quick' | 'full';
type CaptureStatus = 'pending' | 'capturing' | 'processing' | 'completed' | 'error';

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

interface AssistedCameraRegistrationProps {
  group: AttendanceGroup;
  members: AttendanceMember[];
  onRefresh?: () => Promise<void> | void;
  onClose: () => void;
}

const REQUIRED_ANGLES: Record<RegistrationMode, string[]> = {
  quick: ['Front'],
  full: ['Front', 'Profile Left', 'Profile Right']
};

const toBase64Payload = (dataUrl: string) => {
  const [, payload] = dataUrl.split(',');
  return payload || dataUrl;
};

export function AssistedCameraRegistration({ group, members, onRefresh, onClose }: AssistedCameraRegistrationProps) {
  const [mode, setMode] = useState<RegistrationMode>('quick');
  const [memberQueue, setMemberQueue] = useState<QueuedMember[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentAngleIndex, setCurrentAngleIndex] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [queueStarted, setQueueStarted] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [showQualityFeedback, setShowQualityFeedback] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const requiredAngles = REQUIRED_ANGLES[mode];
  const currentMember = memberQueue[currentIndex];
  const currentAngle = requiredAngles[currentAngleIndex];
  const totalMembers = memberQueue.length;
  const completedMembers = memberQueue.filter(m => m.status === 'completed').length;
  const progress = totalMembers > 0 ? Math.round((completedMembers / totalMembers) * 100) : 0;

  // Initialize camera
  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      const constraints: MediaStreamConstraints = {
        video: { 
          width: { ideal: 1280 }, 
          height: { ideal: 720 },
          facingMode: 'user'
        },
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
      setCameraError('Unable to access camera. Please check permissions.');
      setCameraReady(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  }, []);

  // Setup member queue
  const setupQueue = useCallback((selectedMembers: AttendanceMember[]) => {
    const queue: QueuedMember[] = selectedMembers.map(member => ({
      personId: member.person_id,
      name: member.name,
      role: member.role,
      status: 'pending' as CaptureStatus,
      capturedAngles: []
    }));
    setMemberQueue(queue);
    setCurrentIndex(0);
    setCurrentAngleIndex(0);
    setQueueStarted(false);
  }, []);

  // Capture from camera
  const capturePhoto = useCallback(async () => {
    if (!videoRef.current || !currentMember) {
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

    // Update status
    setMemberQueue(prev => prev.map((m, idx) => 
      idx === currentIndex ? { ...m, status: 'capturing' as CaptureStatus } : m
    ));

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setCameraError('Unable to capture from camera.');
      return;
    }

    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const base64Payload = toBase64Payload(dataUrl);

    setIsProcessing(true);
    setError(null);

    try {
      // Detect face
      const detection = await backendService.detectFaces(base64Payload, {
        model_type: 'yunet'
      });

      if (!detection.faces || detection.faces.length === 0) {
        throw new Error('No face detected. Please face the camera directly with good lighting.');
      }

      const bestFace = detection.faces.reduce((best, current) =>
        (current.confidence ?? 0) > (best.confidence ?? 0) ? current : best,
        detection.faces[0]
      );

      if (!bestFace.bbox) {
        throw new Error('Face detected but bounding box missing.');
      }

      // Update status
      setMemberQueue(prev => prev.map((m, idx) => 
        idx === currentIndex ? { 
          ...m, 
          status: 'processing' as CaptureStatus,
          previewUrl: dataUrl
        } : m
      ));

      // Register face
      const result = await attendanceManager.registerFaceForGroupPerson(
        group.id,
        currentMember.personId,
        base64Payload,
        bestFace.bbox
      );

      if (!result.success) {
        throw new Error(result.error || 'Registration failed');
      }

      // Update member with captured angle
      const newCapturedAngles = [...currentMember.capturedAngles, currentAngle];
      const allAnglesCompleted = requiredAngles.every(angle => newCapturedAngles.includes(angle));

      setMemberQueue(prev => prev.map((m, idx) => 
        idx === currentIndex ? {
          ...m,
          capturedAngles: newCapturedAngles,
          status: allAnglesCompleted ? 'completed' as CaptureStatus : 'pending' as CaptureStatus,
          qualityWarning: bestFace.confidence && bestFace.confidence < 0.8 
            ? 'Low confidence - consider retaking' 
            : undefined
        } : m
      ));

      // Auto-advance logic
      if (autoAdvance) {
        if (currentAngleIndex < requiredAngles.length - 1) {
          // Next angle for same member
          setTimeout(() => setCurrentAngleIndex(prev => prev + 1), 500);
        } else if (currentIndex < memberQueue.length - 1) {
          // Next member
          setTimeout(() => {
            setCurrentIndex(prev => prev + 1);
            setCurrentAngleIndex(0);
          }, 1000);
        } else {
          // All done
          setSuccessMessage(`✅ All ${totalMembers} members registered successfully!`);
          if (onRefresh) {
            await onRefresh();
          }
        }
      }

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Capture failed';
      setMemberQueue(prev => prev.map((m, idx) => 
        idx === currentIndex ? { 
          ...m, 
          status: 'error' as CaptureStatus,
          error: message
        } : m
      ));
      setError(message);
    } finally {
      setIsProcessing(false);
    }
  }, [currentMember, currentAngle, currentIndex, currentAngleIndex, requiredAngles, memberQueue, group.id, autoAdvance, totalMembers, onRefresh]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (!queueStarted || !currentMember) return;

      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!isProcessing && cameraReady) {
          void capturePhoto();
        }
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        // Next member
        if (currentIndex < memberQueue.length - 1) {
          setCurrentIndex(prev => prev + 1);
          setCurrentAngleIndex(0);
          setError(null);
        }
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        // Previous member
        if (currentIndex > 0) {
          setCurrentIndex(prev => prev - 1);
          setCurrentAngleIndex(0);
          setError(null);
        }
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        // Retry current
        setMemberQueue(prev => prev.map((m, idx) => 
          idx === currentIndex ? { ...m, status: 'pending' as CaptureStatus, error: undefined } : m
        ));
        setError(null);
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        // Skip current member
        if (currentIndex < memberQueue.length - 1) {
          setCurrentIndex(prev => prev + 1);
          setCurrentAngleIndex(0);
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [queueStarted, currentMember, isProcessing, cameraReady, currentIndex, memberQueue.length, capturePhoto]);

  // Camera lifecycle
  useEffect(() => {
    if (queueStarted) {
      void startCamera();
      return () => stopCamera();
    }
  }, [queueStarted, startCamera, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#0a0a0a] border border-white/10 rounded-3xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-xl font-semibold text-white">Assisted Camera Registration</h2>
            <p className="text-sm text-white/60 mt-1">
              {queueStarted 
                ? `${completedMembers}/${totalMembers} members • ${progress}% complete`
                : 'Select members → Start queue → Capture faces'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 transition"
          >
            Close
          </button>
        </div>

        {/* Error/Success Alerts */}
        {error && (
          <div className="mx-6 mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-200/70 hover:text-red-100">✕</button>
          </div>
        )}

        {successMessage && (
          <div className="mx-6 mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {successMessage}
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {!queueStarted ? (
            /* Setup Phase */
            <div className="space-y-6">
              {/* Mode Selection */}
              <div>
                <h3 className="text-sm font-semibold text-white mb-3">Registration Mode</h3>
                <div className="flex gap-3">
                  {(['quick', 'full'] as RegistrationMode[]).map(option => (
                    <button
                      key={option}
                      onClick={() => setMode(option)}
                      className={`flex-1 rounded-lg px-4 py-3 text-sm transition ${
                        mode === option 
                          ? 'bg-cyan-400/20 text-cyan-100 border border-cyan-400/40' 
                          : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10'
                      }`}
                    >
                      <div className="font-semibold">{option === 'quick' ? 'Quick' : 'Full Spectrum'}</div>
                      <div className="text-xs mt-1 opacity-80">
                        {option === 'quick' ? '1 photo per person' : '3 angles per person'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Settings */}
              <div>
                <h3 className="text-sm font-semibold text-white mb-3">Options</h3>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10 cursor-pointer hover:bg-white/10">
                    <input
                      type="checkbox"
                      checked={autoAdvance}
                      onChange={(e) => setAutoAdvance(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <div>
                      <div className="text-sm text-white">Auto-advance</div>
                      <div className="text-xs text-white/50">Automatically move to next member after capture</div>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10 cursor-pointer hover:bg-white/10">
                    <input
                      type="checkbox"
                      checked={showQualityFeedback}
                      onChange={(e) => setShowQualityFeedback(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <div>
                      <div className="text-sm text-white">Quality feedback</div>
                      <div className="text-xs text-white/50">Show real-time quality warnings</div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Member Selection */}
              <div>
                <h3 className="text-sm font-semibold text-white mb-3">Select Members to Register</h3>
                <div className="max-h-64 overflow-y-auto space-y-2 border border-white/10 rounded-lg p-3 bg-white/5">
                  {members.map(member => {
                    const isInQueue = memberQueue.some(m => m.personId === member.person_id);
                    return (
                      <label
                        key={member.person_id}
                        className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition ${
                          isInQueue 
                            ? 'bg-cyan-500/20 border border-cyan-400/40' 
                            : 'bg-white/5 border border-white/10 hover:bg-white/10'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isInQueue}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setupQueue([...memberQueue.map(m => members.find(mem => mem.person_id === m.personId)!).filter(Boolean), member]);
                            } else {
                              const newQueue = memberQueue.filter(m => m.personId !== member.person_id);
                              setMemberQueue(newQueue);
                            }
                          }}
                          className="w-4 h-4"
                        />
                        <div className="flex-1">
                          <div className="text-sm text-white">{member.name}</div>
                          {member.role && <div className="text-xs text-white/50">{member.role}</div>}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Start Button */}
              {memberQueue.length > 0 && (
                <button
                  onClick={() => setQueueStarted(true)}
                  className="w-full px-4 py-4 rounded-lg bg-emerald-500/20 border border-emerald-400/40 text-emerald-100 hover:bg-emerald-500/30 transition text-base font-medium"
                >
                  🎥 Start Queue ({memberQueue.length} members)
                </button>
              )}
            </div>
          ) : (
            /* Capture Phase */
            <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
              {/* Camera Feed */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">Live Camera Feed</h3>
                  <span className={`text-xs uppercase ${cameraReady ? 'text-emerald-300' : 'text-yellow-200'}`}>
                    {cameraReady ? '● Ready' : '○ Loading'}
                  </span>
                </div>

                <div className="relative overflow-hidden rounded-lg border border-white/10 bg-black aspect-video">
                  <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
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
                  {currentMember && cameraReady && (
                    <div className="absolute top-4 left-4 right-4">
                      <div className="bg-black/80 backdrop-blur-sm rounded-lg p-3 border border-white/20">
                        <div className="text-lg font-semibold text-white">{currentMember.name}</div>
                        <div className="text-sm text-white/60 mt-1">
                          Capture: {currentAngle} ({currentAngleIndex + 1}/{requiredAngles.length})
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Capture Button */}
                <button
                  onClick={() => void capturePhoto()}
                  disabled={!cameraReady || isProcessing || !currentMember}
                  className="w-full px-4 py-4 rounded-lg bg-cyan-500/20 border border-cyan-400/40 text-cyan-100 hover:bg-cyan-500/30 transition disabled:opacity-50 disabled:cursor-not-allowed text-base font-medium"
                >
                  {isProcessing ? 'Processing...' : `📸 Capture ${currentAngle} (Space)`}
                </button>

                {/* Keyboard Shortcuts */}
                <div className="rounded-lg bg-white/5 border border-white/10 p-3">
                  <div className="text-xs font-semibold text-white/60 uppercase mb-2">Keyboard Shortcuts</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <kbd className="px-2 py-1 rounded bg-white/10 text-white/80">Space</kbd>
                      <span className="text-white/60">Capture</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <kbd className="px-2 py-1 rounded bg-white/10 text-white/80">N</kbd>
                      <span className="text-white/60">Next member</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <kbd className="px-2 py-1 rounded bg-white/10 text-white/80">P</kbd>
                      <span className="text-white/60">Previous</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <kbd className="px-2 py-1 rounded bg-white/10 text-white/80">R</kbd>
                      <span className="text-white/60">Retry</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <kbd className="px-2 py-1 rounded bg-white/10 text-white/80">S</kbd>
                      <span className="text-white/60">Skip</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Queue Status */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-white">Queue ({completedMembers}/{totalMembers})</h3>
                <div className="max-h-[600px] overflow-y-auto space-y-2">
                  {memberQueue.map((member, idx) => {
                    const isCurrent = idx === currentIndex;
                    const statusColor = member.status === 'completed' 
                      ? 'border-emerald-400/60 bg-emerald-500/10' 
                      : member.status === 'error'
                      ? 'border-red-400/60 bg-red-500/10'
                      : isCurrent
                      ? 'border-cyan-400/60 bg-cyan-500/10'
                      : 'border-white/10 bg-white/5';

                    return (
                      <div
                        key={member.personId}
                        className={`rounded-lg border p-3 ${statusColor}`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <div className="text-sm font-medium text-white flex items-center gap-2">
                              {isCurrent && <span className="text-cyan-300">→</span>}
                              {member.name}
                            </div>
                            {member.role && <div className="text-xs text-white/50">{member.role}</div>}
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            member.status === 'completed' ? 'bg-emerald-500/20 text-emerald-200' :
                            member.status === 'error' ? 'bg-red-500/20 text-red-200' :
                            member.status === 'processing' ? 'bg-yellow-500/20 text-yellow-200' :
                            'bg-white/10 text-white/60'
                          }`}>
                            {member.status === 'completed' ? '✓ Done' :
                             member.status === 'error' ? '✕ Error' :
                             member.status === 'processing' ? '...' :
                             'Pending'}
                          </span>
                        </div>
                        {member.capturedAngles.length > 0 && (
                          <div className="text-xs text-white/50">
                            {member.capturedAngles.join(', ')}
                          </div>
                        )}
                        {member.error && (
                          <div className="text-xs text-red-300 mt-1">{member.error}</div>
                        )}
                        {member.qualityWarning && showQualityFeedback && (
                          <div className="text-xs text-yellow-300 mt-1">⚠️ {member.qualityWarning}</div>
                        )}
                        {member.previewUrl && (
                          <img src={member.previewUrl} alt="Preview" className="w-full h-20 object-cover rounded mt-2" />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Progress Bar */}
                <div className="rounded-lg bg-white/5 border border-white/10 p-3">
                  <div className="flex items-center justify-between text-xs text-white/60 mb-2">
                    <span>Overall Progress</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
