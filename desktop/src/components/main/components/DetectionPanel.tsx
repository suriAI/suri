import { useMemo, memo } from 'react';
import { createDisplayNameMap } from '../../../utils/displayNameUtils.js';
import type { DetectionResult, TrackedFace } from '../types';
import type { AttendanceMember } from '../../../types/recognition';
import type { ExtendedFaceRecognitionResponse } from '../index';

interface DetectionPanelProps {
  currentDetections: DetectionResult | null;
  currentRecognitionResults: Map<number, ExtendedFaceRecognitionResponse>;
  recognitionEnabled: boolean;
  trackedFaces: Map<string, TrackedFace>;
  groupMembers: AttendanceMember[];
  enableSpoofDetection: boolean;
}

// Memoized individual detection card - compact border-status design with enhanced spoof UI
const DetectionCard = memo(({ 
  face, 
  index, 
  recognitionResult,
  isRecognized,
  displayName,
  trackedFace,
}: {
  face: DetectionResult['faces'][0];
  index: number;
  recognitionResult: ExtendedFaceRecognitionResponse | undefined;
  isRecognized: boolean;
  displayName: string;
  trackedFace: TrackedFace | undefined;
}) => {
  // Get status styles with enhanced spoof visibility
  const getStatusStyles = () => {
    if (!face.liveness) {
      return {
        borderColor: 'border-white/20',
        bgColor: '',
        statusText: 'UNKNOWN',
        statusColor: 'text-white/60',
        score: null
      };
    }

    const status = face.liveness.status;
    const liveScore = face.liveness.live_score;
    const spoofScore = face.liveness.spoof_score;

    switch (status) {
      case 'real':
        return {
          borderColor: 'border-green-500/60',
          bgColor: '',
          statusText: 'REAL',
          statusColor: 'text-green-400',
          score: liveScore !== null && liveScore !== undefined ? liveScore : null
        };
      case 'fake':
        // Enhanced spoof styling - very prominent
        return {
          borderColor: 'border-red-500/90',
          bgColor: 'bg-red-950/30',
          statusText: 'SPOOF',
          statusColor: 'text-red-300 font-semibold',
          score: spoofScore !== null && spoofScore !== undefined ? spoofScore : null
        };
      case 'uncertain':
        return {
          borderColor: 'border-amber-500/60',
          bgColor: '',
          statusText: 'UNCERTAIN',
          statusColor: 'text-amber-400',
          score: liveScore !== null && liveScore !== undefined ? liveScore : spoofScore
        };
      case 'error':
        return {
          borderColor: 'border-yellow-500/60',
          bgColor: '',
          statusText: 'ERROR',
          statusColor: 'text-yellow-400',
          score: null
        };
      case 'insufficient_quality':
        return {
          borderColor: 'border-blue-500/60',
          bgColor: '',
          statusText: 'TOO SMALL',
          statusColor: 'text-blue-400',
          score: null
        };
      default:
        return {
          borderColor: 'border-white/20',
          bgColor: '',
          statusText: 'UNKNOWN',
          statusColor: 'text-white/60',
          score: null
        };
    }
  };

  const statusStyles = getStatusStyles();
  const isSpoof = face.liveness?.status === 'fake';
  const hasName = isRecognized && recognitionResult?.person_id && displayName;
  const similarityScore = isRecognized && recognitionResult?.similarity 
    ? (recognitionResult.similarity * 100).toFixed(0) 
    : null;

  return (
    <div 
      key={index} 
      className={`
        glass-card rounded-lg p-2 border-l-4 min-h-[32px]
        ${statusStyles.borderColor}
        ${statusStyles.bgColor}
        ${trackedFace?.isLocked ? 'border-cyan-500/50 bg-gradient-to-br from-cyan-500/10 to-transparent' : ''}
        ${isSpoof ? 'ring-1 ring-red-500/20' : ''}
      `}
    >
      {/* Single-line compact layout */}
      <div className="flex items-center justify-between gap-2">
        {/* Left: Name and Recognition Score */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {hasName ? (
            <>
              <span className={`font-medium text-sm truncate ${
                isSpoof ? 'text-red-200' : 'text-white'
              }`}>
                {displayName}
              </span>
              {similarityScore && !isSpoof && (
                <span className="text-xs text-green-400/70 font-mono shrink-0">
                  {similarityScore}%
                </span>
              )}
            </>
          ) : (
            <span className={`text-xs italic ${
              isSpoof ? 'text-red-300/70' : 'text-white/40'
            }`}>
              {isSpoof ? 'Spoofed Face' : 'Unknown'}
            </span>
          )}
        </div>

        {/* Right: Status Text + Score (Enhanced for spoofs) */}
        {face.liveness && (
          <div className={`flex items-center gap-1.5 shrink-0 ${statusStyles.statusColor}`}>
            <span className={`text-xs ${
              isSpoof ? 'font-bold tracking-wide' : 'font-medium'
            }`}>
              {statusStyles.statusText}
            </span>
            {statusStyles.score !== null && (
              <span className={`text-xs font-mono ${
                isSpoof ? 'opacity-100 font-semibold' : 'opacity-80'
              }`}>
                {(statusStyles.score * 100).toFixed(0)}%
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

DetectionCard.displayName = 'DetectionCard';

export function DetectionPanel({
  currentDetections,
  currentRecognitionResults,
  recognitionEnabled,
  trackedFaces,
  groupMembers,
  enableSpoofDetection,
}: DetectionPanelProps) {
  // Create display name map for members
  const displayNameMap = useMemo(() => {
    return createDisplayNameMap(groupMembers);
  }, [groupMembers]);

  // Memoize tracked faces array to prevent recreation
  const trackedFacesArray = useMemo(() => 
    Array.from(trackedFaces.values()), 
    [trackedFaces]
  );

  // Filter faces: if spoof detection is OFF, only show recognized faces
  // If spoof detection is ON, show all faces (current behavior)
  const filteredFaces = useMemo(() => {
    if (!currentDetections?.faces) return [];
    
    if (!enableSpoofDetection) {
      // Only show recognized faces when spoof detection is off
      return currentDetections.faces.filter(face => {
        const trackId = face.track_id!;
        const recognitionResult = currentRecognitionResults.get(trackId);
        return recognitionEnabled && !!recognitionResult?.person_id;
      });
    }
    
    // Show all faces when spoof detection is on
    return currentDetections.faces;
  }, [currentDetections?.faces, currentRecognitionResults, recognitionEnabled, enableSpoofDetection]);

  const hasDetections = filteredFaces.length > 0;

  return (
    <>
      {!hasDetections ? (
        <div className="text-white/40 text-xs text-center flex items-center justify-center h-full">
          NO DETECTION
        </div>
      ) : (
        <div className="space-y-1.5">
          {filteredFaces.map((face, index) => {
            const trackId = face.track_id!;
            const recognitionResult = currentRecognitionResults.get(trackId);
            const isRecognized = recognitionEnabled && !!recognitionResult?.person_id;
            const displayName = recognitionResult?.person_id 
              ? displayNameMap.get(recognitionResult.person_id) || 'Unknown'
              : '';

            const trackedFace = trackedFacesArray.find(track =>
              track.personId === recognitionResult?.person_id ||
              (Math.abs(track.bbox.x - face.bbox.x) < 30 && Math.abs(track.bbox.y - face.bbox.y) < 30)
            );

            return (
              <DetectionCard
                key={trackId}
                face={face}
                index={index}
                recognitionResult={recognitionResult}
                isRecognized={isRecognized}
                displayName={displayName}
                trackedFace={trackedFace}
              />
            );
          })}
        </div>
      )}
    </>
  );
}
