import { useState, useCallback, useMemo } from 'react';
import type { AttendanceGroup, AttendanceMember } from '../types/recognition';

// Backend API configuration
const API_BASE_URL = 'http://127.0.0.1:8700';

interface DetectedFace {
  faceId: string;
  imageId: string;
  bbox: [number, number, number, number];
  landmarks_5?: number[][];
  confidence: number;
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
  }, []);

  const handleDetectFaces = useCallback(async () => {
    if (uploadedFiles.length === 0) {
      setError('Please upload images first');
      return;
    }

    setIsDetecting(true);
    setError(null);

    try {
      // Read all files as base64
      const imagesData = await Promise.all(
        uploadedFiles.map(async (file, idx) => {
          const dataUrl = await readFileAsDataUrl(file);
          return {
            id: `image_${idx}`,
            image: toBase64Payload(dataUrl),
            fileName: file.name
          };
        })
      );

      // Call bulk detect endpoint
      console.log('[BulkDetect] Sending request to:', `${API_BASE_URL}/attendance/groups/${group.id}/bulk-detect-faces`);
      console.log('[BulkDetect] Images data count:', imagesData.length);
      
      const response = await fetch(`${API_BASE_URL}/attendance/groups/${group.id}/bulk-detect-faces`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        mode: 'cors', // Explicitly set CORS mode
        body: JSON.stringify({ images: imagesData })
      });

      console.log('[BulkDetect] Response status:', response.status);
      console.log('[BulkDetect] Response headers:', Object.fromEntries(response.headers.entries()));

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
        const file = uploadedFiles[imageIdx];
        const dataUrl = await readFileAsDataUrl(file);

        for (const face of imageResult.faces) {
          // Create cropped preview
          const previewUrl = await createFacePreview(dataUrl, face.bbox);

          allDetectedFaces.push({
            faceId: makeId(),
            imageId: imageResult.image_id,
            bbox: face.bbox,
            landmarks_5: face.landmarks_5,
            confidence: face.confidence,
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

  const createFacePreview = async (imageDataUrl: string, bbox: [number, number, number, number]): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const [x, y, w, h] = bbox;
        
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
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#0a0a0a] border border-white/10 rounded-3xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-xl font-semibold text-white">Bulk Face Registration</h2>
            <p className="text-sm text-white/60 mt-1">Upload photos → Detect faces → Assign members → Register</p>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 transition"
          >
            Close
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mx-6 mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-200/70 hover:text-red-100">✕</button>
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Step 1: Upload Files */}
          {!registrationResults && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-white mb-3">Step 1: Upload Images</h3>
              <label className="flex h-40 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/20 bg-white/5 hover:border-cyan-400/40 transition">
                <span className="text-4xl mb-2">📁</span>
                <span className="text-sm text-white/70">Click to upload or drag & drop</span>
                <span className="text-xs text-white/40 mt-1">Max 50 images (class photo or individual photos)</span>
                {uploadedFiles.length > 0 && (
                  <span className="text-xs text-cyan-300 mt-2">✓ {uploadedFiles.length} images selected</span>
                )}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFilesSelected(e.target.files)}
                />
              </label>

              {uploadedFiles.length > 0 && (
                <button
                  onClick={() => void handleDetectFaces()}
                  disabled={isDetecting}
                  className="mt-3 w-full px-4 py-3 rounded-lg bg-cyan-500/20 border border-cyan-400/40 text-cyan-100 hover:bg-cyan-500/30 transition disabled:opacity-50"
                >
                  {isDetecting ? 'Detecting faces...' : `Detect Faces in ${uploadedFiles.length} Images`}
                </button>
              )}
            </div>
          )}

          {/* Step 2: Assign Members */}
          {detectedFaces.length > 0 && !registrationResults && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white">
                  Step 2: Assign Members ({assignedCount}/{detectedFaces.length})
                </h3>
                <span className="text-xs text-white/60">{availableMembers.length} members available</span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {detectedFaces.map((face) => {
                  const assignedMember = face.assignedPersonId 
                    ? members.find(m => m.person_id === face.assignedPersonId)
                    : null;

                  return (
                    <div
                      key={face.faceId}
                      className={`rounded-lg border p-3 ${
                        face.assignedPersonId 
                          ? 'border-emerald-400/60 bg-emerald-500/10' 
                          : face.isAcceptable
                          ? 'border-white/20 bg-white/5'
                          : 'border-yellow-400/40 bg-yellow-500/10'
                      }`}
                    >
                      {/* Face Preview */}
                      <div className="relative mb-2">
                        <img
                          src={face.previewUrl}
                          alt="Detected face"
                          className="w-full h-32 object-cover rounded-lg"
                        />
                        <div className="absolute top-1 right-1 px-2 py-0.5 rounded bg-black/70 text-xs text-white">
                          {Math.round(face.confidence * 100)}%
                        </div>
                        {!face.isAcceptable && (
                          <div className="absolute bottom-1 left-1 right-1 px-2 py-0.5 rounded bg-yellow-500/80 text-xs text-black">
                            Low quality
                          </div>
                        )}
                      </div>

                      {/* Quality Score */}
                      <div className="mb-2">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-white/60">Quality</span>
                          <span className={face.qualityScore >= 60 ? 'text-emerald-300' : 'text-yellow-300'}>
                            {Math.round(face.qualityScore)}%
                          </span>
                        </div>
                        {face.suggestions.length > 0 && (
                          <div className="text-[10px] text-white/40 line-clamp-2">
                            {face.suggestions[0]}
                          </div>
                        )}
                      </div>

                      {/* Member Assignment */}
                      {!face.assignedPersonId ? (
                        <select
                          value=""
                          onChange={(e) => handleAssignMember(face.faceId, e.target.value)}
                          className="w-full px-2 py-1.5 rounded bg-white/10 border border-white/20 text-xs text-white focus:outline-none focus:border-cyan-400"
                        >
                          <option value="">Assign member...</option>
                          {availableMembers.map(member => (
                            <option key={member.person_id} value={member.person_id} className="bg-black">
                              {member.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-emerald-200 truncate flex-1">
                            ✓ {assignedMember?.name}
                          </span>
                          <button
                            onClick={() => handleUnassign(face.faceId)}
                            className="ml-2 px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-xs text-white/80"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {assignedCount > 0 && (
                <button
                  onClick={() => void handleBulkRegister()}
                  disabled={isRegistering}
                  className="mt-4 w-full px-4 py-3 rounded-lg bg-emerald-500/20 border border-emerald-400/40 text-emerald-100 hover:bg-emerald-500/30 transition disabled:opacity-50"
                >
                  {isRegistering ? 'Registering...' : `Register ${assignedCount} Faces`}
                </button>
              )}
            </div>
          )}

          {/* Step 3: Results */}
          {registrationResults && (
            <div>
              <h3 className="text-sm font-semibold text-white mb-3">Registration Results</h3>
              
              {/* Summary */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-4">
                  <div className="text-2xl font-bold text-emerald-200">{successCount}</div>
                  <div className="text-xs text-emerald-300 mt-1">Successful</div>
                </div>
                <div className="rounded-lg border border-red-400/40 bg-red-500/10 p-4">
                  <div className="text-2xl font-bold text-red-200">{failedCount}</div>
                  <div className="text-xs text-red-300 mt-1">Failed</div>
                </div>
              </div>

              {/* Detailed Results */}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {registrationResults.map((result, idx) => (
                  <div
                    key={idx}
                    className={`rounded-lg border p-3 ${
                      result.success
                        ? 'border-emerald-400/40 bg-emerald-500/10'
                        : 'border-red-400/40 bg-red-500/10'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className={`text-sm font-medium ${result.success ? 'text-emerald-200' : 'text-red-200'}`}>
                          {result.success ? '✓' : '✕'} {result.memberName || result.personId}
                        </div>
                        {result.error && (
                          <div className="text-xs text-red-300 mt-1">{result.error}</div>
                        )}
                        {result.qualityWarning && (
                          <div className="text-xs text-yellow-300 mt-1">⚠️ {result.qualityWarning}</div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={onClose}
                className="mt-4 w-full px-4 py-3 rounded-lg bg-white/10 hover:bg-white/20 text-white transition"
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
