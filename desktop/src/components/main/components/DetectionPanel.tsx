import type { DetectionResult, TrackedFace } from '../types';
import type { FaceRecognitionResponse } from '../../../types/recognition';

interface DetectionPanelProps {
  currentDetections: DetectionResult | null;
  currentRecognitionResults: Map<number, FaceRecognitionResponse>;
  recognitionEnabled: boolean;
  trackedFaces: Map<string, TrackedFace>;
  trackingMode: 'auto' | 'manual';
  handleManualLog: (personId: string, name: string, confidence: number) => void;
}

export function DetectionPanel({
  currentDetections,
  currentRecognitionResults,
  recognitionEnabled,
  trackedFaces,
  trackingMode,
  handleManualLog,
}: DetectionPanelProps) {
  if (!currentDetections?.faces?.length) {
    return (
      <div className="text-white/40 text-xs text-center flex items-center justify-center h-full">
        NO DETECTION
      </div>
    );
  }

  return (
    <>
      {currentDetections.faces.map((face, index) => {
        const trackId = face.track_id!;
        const recognitionResult = currentRecognitionResults.get(trackId);
        const isRecognized = recognitionEnabled && recognitionResult?.person_id;

        const trackedFace = Array.from(trackedFaces.values()).find(track =>
          track.personId === recognitionResult?.person_id ||
          (Math.abs(track.bbox.x - face.bbox.x) < 30 && Math.abs(track.bbox.y - face.bbox.y) < 30)
        );

        return (
          <div key={index} className={`glass-card rounded-lg p-3 ${trackedFace?.isLocked ? 'border-cyan-500/50 bg-gradient-to-br from-cyan-500/10 to-transparent' : ''}`}>
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <div className="font-medium text-sm">
                    {isRecognized && recognitionResult?.person_id ?
                      (recognitionResult.name || recognitionResult.person_id) :
                      `Unknown`
                    }
                  </div>
                  {isRecognized && recognitionResult?.similarity && (
                    <div className="text-xs text-green-400/80 font-mono">
                      {(recognitionResult.similarity * 100).toFixed(0)}%
                    </div>
                  )}
                  {trackedFace && (
                    <div className={`w-1.5 h-1.5 rounded-full ${trackedFace.isLocked ? 'bg-cyan-400' : 'bg-orange-400'}`} title={trackedFace.isLocked ? 'Locked' : 'Active'}></div>
                  )}
                </div>
              </div>
              <div className="text-right space-y-1">

                {face.antispoofing && (
                  <div className={`text-xs px-2 py-1 rounded border mt-1 ${
                    face.antispoofing.status === 'real' ? 'bg-green-500/10 border-green-500/30 text-green-400' : 
                    face.antispoofing.status === 'fake' ? 'bg-red-500/10 border-red-500/30 text-red-400' : 
                    face.antispoofing.status === 'uncertain' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 
                    face.antispoofing.status === 'error' ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' : 
                    'bg-white/5 border-white/10 text-white/60'
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {face.antispoofing.status === 'real' ? 'LIVE' :
                         face.antispoofing.status === 'fake' ? 'SPOOF' :
                         face.antispoofing.status === 'uncertain' ? 'UNCERTAIN' :
                         face.antispoofing.status === 'error' ? 'ERROR' : 'UNKNOWN'}
                      </span>
                      {((face.antispoofing.live_score !== undefined && face.antispoofing.live_score !== null) ||
                        (face.antispoofing.spoof_score !== undefined && face.antispoofing.spoof_score !== null)) && (
                        <span className="font-mono text-xs">
                          {face.antispoofing.status === 'real' && face.antispoofing.live_score !== null
                            ? `${((face.antispoofing.live_score || 0) * 100).toFixed(0)}%`
                            : face.antispoofing.spoof_score !== null
                            ? `${((face.antispoofing.spoof_score || 0) * 100).toFixed(0)}%`
                            : ''}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {trackingMode === 'manual' && isRecognized && recognitionResult?.person_id && (
                  <button
                    onClick={() => handleManualLog(
                      recognitionResult.person_id!,
                      recognitionResult.name || recognitionResult.person_id!,
                      face.confidence
                    )}
                    className="btn-warning text-xs mt-2 w-full px-2 py-1 font-medium"
                  >
                    LOG
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

