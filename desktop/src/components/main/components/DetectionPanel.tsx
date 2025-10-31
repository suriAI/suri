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
}

// Memoized individual detection card to prevent unnecessary re-renders
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
  return (
    <div key={index} className={`glass-card rounded-lg p-3 ${trackedFace?.isLocked ? 'border-cyan-500/50 bg-gradient-to-br from-cyan-500/10 to-transparent' : ''}`}>
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center space-x-2">
            <div className="font-medium text-sm">
              {isRecognized && recognitionResult?.person_id && displayName}
            </div>
            {isRecognized && recognitionResult?.similarity && (
              <div className="text-xs text-green-400/80 font-mono">
                {(recognitionResult.similarity * 100).toFixed(0)}%
              </div>
            )}
          </div>
        </div>
        <div className="text-right space-y-1">
          {face.liveness && (
            <div className={`text-xs px-2 py-1 rounded border mt-1 ${
              face.liveness.status === 'real' ? 'bg-green-500/10 border-green-500/30 text-green-400' : 
              face.liveness.status === 'fake' ? 'bg-red-500/10 border-red-500/30 text-red-400' : 
              face.liveness.status === 'uncertain' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 
              face.liveness.status === 'error' ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' : 
              face.liveness.status === 'insufficient_quality' ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' :
              'bg-white/5 border-white/10 text-white/60'
            }`}>
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {face.liveness.status === 'real' ? 'LIVE' :
                   face.liveness.status === 'fake' ? 'SPOOF' :
                   face.liveness.status === 'uncertain' ? 'UNCERTAIN' :
                   face.liveness.status === 'error' ? 'ERROR' :
                   face.liveness.status === 'insufficient_quality' ? 'TOO SMALL' : 'UNKNOWN'}
                </span>
                {((face.liveness.live_score !== undefined && face.liveness.live_score !== null) ||
                  (face.liveness.spoof_score !== undefined && face.liveness.spoof_score !== null)) && (
                  <span className="font-mono text-xs">
                    {face.liveness.status === 'real' && face.liveness.live_score !== null
                      ? `${((face.liveness.live_score || 0) * 100).toFixed(0)}%`
                      : face.liveness.spoof_score !== null
                      ? `${((face.liveness.spoof_score || 0) * 100).toFixed(0)}%`
                      : ''}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
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

  const hasDetections = currentDetections?.faces?.length ?? 0;

  return (
    <>
      {!hasDetections ? (
        <div className="text-white/40 text-xs text-center flex items-center justify-center h-full">
          NO DETECTION
        </div>
      ) : (
        currentDetections?.faces?.map((face, index) => {
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
          })
        )}
    </>
  );
}
