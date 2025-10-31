import { useState, useCallback, useMemo } from 'react';
import type { AttendanceGroup, AttendanceMember } from '../../../types/recognition';

// Backend API configuration
const API_BASE_URL = 'http://127.0.0.1:8700';

interface DetectedFace {
  faceId: string;
  imageId: string;
  bbox: [number, number, number, number];
  confidence: number;
  landmarks_5?: number[][];
  qualityScore: number;
  isAcceptable: boolean;
  suggestions: string[];
  assignedPersonId: string | null;
  previewUrl: string;
}

interface BulkRegistrationResult {
  personId: string;
  memberName: string;
  success: boolean;
  error?: string;
  qualityWarning?: string;
}

interface BulkFaceRegistrationProps {
  group: AttendanceGroup;
  members: AttendanceMember[];
  onRefresh?: () => Promise<void> | void;
  onClose: () => void;
}

const makeId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const readFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
  reader.readAsDataURL(file);
});

const toBase64Payload = (dataUrl: string) => {
  const [, payload] = dataUrl.split(',');
  return payload || dataUrl;
};

export function BulkFaceRegistration({ group, members, onRefresh, onClose }: BulkFaceRegistrationProps) {
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [detectedFaces, setDetectedFaces] = useState<DetectedFace[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registrationResults, setRegistrationResults] = useState<BulkRegistrationResult[] | null>(null);

  // Get unregistered members for assignment dropdown
  const availableMembers = useMemo(() => {
    const assignedIds = new Set(detectedFaces.map(f => f.assignedPersonId).filter(Boolean));
    return members.filter(m => !assignedIds.has(m.person_id));
  }, [members, detectedFaces]);

  const handleDetectFaces = useCallback(async (filesToProcess?: File[]) => {
    const files = filesToProcess || uploadedFiles;
    
    if (files.length === 0) {
      setError('Please upload images first');
      return;
    }

    setIsDetecting(true);
    setError(null);

    try {
      // Read all files as base64
      const imagesData = await Promise.all(
        files.map(async (file, idx) => {
          const dataUrl = await readFileAsDataUrl(file);
          return {
            id: `image_${idx}`,
            image: toBase64Payload(dataUrl),
            fileName: file.name
          };
        })
      );

      // Call bulk detect endpoint
      const response = await fetch(`${API_BASE_URL}/attendance/groups/${group.id}/bulk-detect-faces`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        mode: 'cors', // Explicitly set CORS mode
        body: JSON.stringify({ images: imagesData })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Face detection failed');
      }

      const result = await response.json();
      
      // Process detected faces and create preview URLs
      const allDetectedFaces: DetectedFace[] = [];

      for (const imageResult of result.results) {
        if (!imageResult.success || !imageResult.faces || imageResult.faces.length === 0) {
          continue;
        }

        const imageIdx = parseInt(imageResult.image_id.replace('image_', ''));
        const file = files[imageIdx];
        const dataUrl = await readFileAsDataUrl(file);

        for (const face of imageResult.faces) {
          // Create cropped preview
          const previewUrl = await createFacePreview(dataUrl, face.bbox);

          allDetectedFaces.push({
            faceId: makeId(),
            imageId: imageResult.image_id,
            bbox: face.bbox,
            confidence: face.confidence,
            landmarks_5: face.landmarks_5,
            qualityScore: face.quality_score,
            isAcceptable: face.is_acceptable,
            suggestions: face.suggestions || [],
            assignedPersonId: null,
            previewUrl
          });
        }
      }

      setDetectedFaces(allDetectedFaces);

      if (allDetectedFaces.length === 0) {
        setError('No faces detected in uploaded images');
      }

    } catch (err) {
      console.error('Face detection error:', err);
      setError(err instanceof Error ? err.message : 'Failed to detect faces');
    } finally {
      setIsDetecting(false);
    }
  }, [uploadedFiles, group.id]);

  const handleFilesSelected = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    
    if (imageFiles.length === 0) {
      setError('No valid image files selected');
      return;
    }

    if (imageFiles.length > 50) {
      setError('Maximum 50 images allowed');
      return;
    }

    setUploadedFiles(imageFiles);
    setDetectedFaces([]);
    setRegistrationResults(null);
    setError(null);

    // Automatically start face detection
    await handleDetectFaces(imageFiles);
  }, [handleDetectFaces]);

  const createFacePreview = async (imageDataUrl: string, bbox: {x: number, y: number, width: number, height: number} | [number, number, number, number]): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        // Handle both object and array formats
        const [x, y, w, h] = Array.isArray(bbox) 
          ? bbox 
          : [bbox.x, bbox.y, bbox.width, bbox.height];
        
        // Add padding
        const padding = 20;
        const cropX = Math.max(0, x - padding);
        const cropY = Math.max(0, y - padding);
        const cropW = Math.min(img.width - cropX, w + padding * 2);
        const cropH = Math.min(img.height - cropY, h + padding * 2);

        canvas.width = cropW;
        canvas.height = cropH;
        
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
          resolve(canvas.toDataURL('image/jpeg', 0.9));
        } else {
          resolve(imageDataUrl);
        }
      };
      img.src = imageDataUrl;
    });
  };

  const handleAssignMember = useCallback((faceId: string, personId: string) => {
    setDetectedFaces(prev => prev.map(face => 
      face.faceId === faceId ? { ...face, assignedPersonId: personId } : face
    ));
  }, []);

  const handleUnassign = useCallback((faceId: string) => {
    setDetectedFaces(prev => prev.map(face => 
      face.faceId === faceId ? { ...face, assignedPersonId: null } : face
    ));
  }, []);

  const handleBulkRegister = useCallback(async () => {
    const assignedFaces = detectedFaces.filter(f => f.assignedPersonId);

    if (assignedFaces.length === 0) {
      setError('Please assign at least one face to a member');
      return;
    }

    setIsRegistering(true);
    setError(null);
    setRegistrationResults(null);

    try {
      // Prepare registrations data
      const registrations = await Promise.all(
        assignedFaces.map(async (face) => {
          const imageIdx = parseInt(face.imageId.replace('image_', ''));
          const file = uploadedFiles[imageIdx];
          const dataUrl = await readFileAsDataUrl(file);

          return {
            person_id: face.assignedPersonId,
            image: toBase64Payload(dataUrl),
            bbox: face.bbox,
            landmarks_5: face.landmarks_5,
            skip_quality_check: false
          };
        })
      );

      // Call bulk register endpoint
      const response = await fetch(`${API_BASE_URL}/attendance/groups/${group.id}/bulk-register-faces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrations })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Bulk registration failed');
      }

      const result = await response.json();

      // Process results
      const results: BulkRegistrationResult[] = result.results.map((r: {
        person_id: string;
        member_name?: string;
        success: boolean;
        error?: string;
        quality_warning?: string;
      }) => ({
        personId: r.person_id,
        memberName: r.member_name || '',
        success: r.success,
        error: r.error,
        qualityWarning: r.quality_warning
      }));

      setRegistrationResults(results);

      if (result.success_count > 0 && onRefresh) {
        await onRefresh();
      }

    } catch (err) {
      console.error('Bulk registration error:', err);
      setError(err instanceof Error ? err.message : 'Failed to register faces');
    } finally {
      setIsRegistering(false);
    }
  }, [detectedFaces, uploadedFiles, group.id, onRefresh]);

  const assignedCount = detectedFaces.filter(f => f.assignedPersonId).length;
  const successCount = registrationResults?.filter(r => r.success).length || 0;
  const failedCount = registrationResults?.filter(r => !r.success).length || 0;

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
      <div className="bg-gradient-to-br from-[#0a0a0a] to-black border border-white/10 rounded-3xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-lg font-medium text-white">Batch Registration</h2>
              <p className="text-xs text-white/40 mt-0.5">{group.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white/80 transition flex items-center justify-center"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mx-6 mt-4 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-200 flex items-center gap-3">
            <div className="h-1 w-1 rounded-full bg-red-400 animate-pulse" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-red-200/50 hover:text-red-100 transition">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {/* Step 1: Upload Files */}
          {!registrationResults && (
            <div className="mb-6">
              <label className="group relative flex h-48 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/10 bg-gradient-to-br from-white/5 to-transparent hover:border-white/20 hover:from-white/10 transition-all overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-white/0 to-white/0 group-hover:from-white/5 group-hover:to-transparent transition-all" />
                <div className="relative flex flex-col items-center gap-3">
                  <div className="text-center">
                    <div className="text-sm text-white/70 mb-1">Drop images or click to browse</div>
                    <div className="text-xs text-white/40">Up to 50 photos • Class or individual</div>
                  </div>
                  {uploadedFiles.length > 0 && (
                    <div className="flex items-center gap-2 mt-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20">
                      <div className="h-1.5 w-1.5 rounded-full bg-white/60" />
                      <span className="text-xs text-white/70">{uploadedFiles.length} images ready</span>
                    </div>
                  )}
                </div>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFilesSelected(e.target.files)}
                />
              </label>

              {/* Show detection progress when analyzing */}
              {isDetecting && uploadedFiles.length > 0 && (
                <div className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-white/10 to-white/5 border border-white/20 px-4 py-4 text-sm font-medium text-white">
                  <div className="h-4 w-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                  <span>Analyzing {uploadedFiles.length} images...</span>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Assign Members */}
          {detectedFaces.length > 0 && !registrationResults && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="text-2xl font-light text-white">{assignedCount}<span className="text-white/40">/{detectedFaces.length}</span></div>
                  <div className="text-xs text-white/40">assigned</div>
                </div>
                <div className="text-xs text-white/40">{availableMembers.length} members available</div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {detectedFaces.map((face) => {
                  const assignedMember = face.assignedPersonId 
                    ? members.find(m => m.person_id === face.assignedPersonId)
                    : null;

                  return (
                    <div
                      key={face.faceId}
                      className={`group rounded-xl border overflow-hidden transition-all ${
                        face.assignedPersonId 
                          ? 'border-emerald-400/40 bg-gradient-to-br from-emerald-500/10 to-emerald-600/5' 
                          : face.isAcceptable
                          ? 'border-white/10 bg-white/[0.02] hover:border-white/20'
                          : 'border-amber-400/30 bg-amber-500/5'
                      }`}
                    >
                      {/* Face Preview */}
                      <div className="relative aspect-square">
                        <img
                          src={face.previewUrl}
                          alt="Detected face"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-black/80">
                          <div className={`h-1 w-1 rounded-full ${face.confidence > 0.8 ? 'bg-emerald-400' : 'bg-yellow-400'}`} />
                          <span className="text-xs text-white">{Math.round(face.confidence * 100)}%</span>
                        </div>
                        {!face.isAcceptable && (
                          <div className="absolute bottom-2 left-2 right-2 px-2 py-1 rounded-lg bg-amber-500/90 text-center">
                            <div className="text-[10px] font-medium text-black">⚠️ Low quality</div>
                          </div>
                        )}
                      </div>

                      {/* Assignment */}
                      <div className="p-3 space-y-2">
                        {/* Quality Bar */}
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                            <div 
                              className={`h-full ${face.qualityScore >= 60 ? 'bg-gradient-to-r from-emerald-400 to-cyan-400' : 'bg-gradient-to-r from-yellow-400 to-orange-400'}`}
                              style={{ width: `${face.qualityScore}%` }}
                            />
                          </div>
                          <span className={`text-[10px] ${face.qualityScore >= 60 ? 'text-emerald-300' : 'text-yellow-300'}`}>
                            {Math.round(face.qualityScore)}
                          </span>
                        </div>

                        {/* Member Select */}
                        {!face.assignedPersonId ? (
                          <div className="relative">
                            <select
                              value=""
                              onChange={(e) => handleAssignMember(face.faceId, e.target.value)}
                              className="w-full px-2.5 py-2 pr-7 rounded-lg bg-white/5 border border-white/10 text-xs text-white focus:outline-none focus:border-purple-400/50 focus:bg-white/10 transition-all appearance-none cursor-pointer"
                              style={{ colorScheme: 'dark' }}
                            >
                              <option value="" className="bg-black text-white">Select member...</option>
                              {availableMembers.map(member => (
                                <option key={member.person_id} value={member.person_id} className="bg-black text-white">
                                  {member.name}
                                </option>
                              ))}
                            </select>
                            {/* Custom dropdown arrow */}
                            <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                              <svg
                                className="w-2.5 h-2.5 text-white/50 transition-colors duration-200"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-400/20">
                            <div className="flex-1 truncate text-xs text-emerald-200 font-medium">
                              {assignedMember?.name}
                            </div>
                            <button
                              onClick={() => handleUnassign(face.faceId)}
                              className="h-6 w-6 rounded-md bg-white/5 hover:bg-red-500/20 text-white/50 hover:text-red-300 transition flex items-center justify-center"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {assignedCount > 0 && (
                <button
                  onClick={() => void handleBulkRegister()}
                  disabled={isRegistering}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500/20 to-emerald-600/20 border border-emerald-400/40 px-4 py-4 text-sm font-medium text-emerald-100 hover:from-emerald-500/30 hover:to-emerald-600/30 disabled:from-white/5 disabled:to-white/5 disabled:border-white/10 disabled:text-white/30 transition-all shadow-lg shadow-emerald-500/10"
                >
                  {isRegistering ? (
                    <>
                      <div className="h-4 w-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                      <span>Registering {assignedCount} faces...</span>
                    </>
                  ) : (
                    <>
                      <span className="text-lg">✓</span>
                      <span>Register {assignedCount} {assignedCount === 1 ? 'Face' : 'Faces'}</span>
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Results */}
          {registrationResults && (
            <div className="space-y-6">
              {/* Summary */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-emerald-400/30 bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 p-6">
                  <div className="text-3xl font-light text-emerald-200 mb-1">{successCount}</div>
                  <div className="text-xs text-emerald-300/70 uppercase tracking-wide">Registered</div>
                </div>
                <div className="rounded-xl border border-red-400/30 bg-gradient-to-br from-red-500/10 to-red-600/5 p-6">
                  <div className="text-3xl font-light text-red-200 mb-1">{failedCount}</div>
                  <div className="text-xs text-red-300/70 uppercase tracking-wide">Failed</div>
                </div>
              </div>

              {/* Details */}
              {registrationResults.length > 0 && (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {registrationResults.map((result, idx) => (
                    <div
                      key={idx}
                      className={`rounded-xl border p-3 flex items-start gap-3 ${
                        result.success
                          ? 'border-emerald-400/20 bg-emerald-500/5'
                          : 'border-red-400/20 bg-red-500/5'
                      }`}
                    >
                      <div className={`h-6 w-6 rounded-lg flex items-center justify-center text-sm ${
                        result.success ? 'bg-emerald-500/20' : 'bg-red-500/20'
                      }`}>
                        {result.success ? '✓' : '✕'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium ${result.success ? 'text-emerald-200' : 'text-red-200'}`}>
                          {result.memberName || result.personId}
                        </div>
                        {result.error && (
                          <div className="text-xs text-red-300/80 mt-1">{result.error}</div>
                        )}
                        {result.qualityWarning && (
                          <div className="text-xs text-yellow-300/80 mt-1">⚠️ {result.qualityWarning}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={onClose}
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-all"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
