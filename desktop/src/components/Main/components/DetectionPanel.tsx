import type { DetectionResult, TrackedFace } from '../types';
import type { FaceRecognitionResponse } from '../../types/recognition';

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
      <div className="text-white/50 text-sm text-center flex items-center justify-center h-full">
        No faces detected
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
          <div key={index} className={`bg-white/[0.05] border rounded p-3 transition-all duration-200 ${trackedFace?.isLocked ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-white/[0.08]'}`}>
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <div className="font-medium">
                    {isRecognized && recognitionResult?.person_id ?
                      (recognitionResult.name || recognitionResult.person_id) :
                      `Unknown`
                    }
                  </div>
                  {trackedFace && (
                    <div className={`w-2 h-2 rounded-full ${trackedFace.isLocked ? 'bg-cyan-400' : 'bg-orange-400'}`} title={trackedFace.isLocked ? 'Locked Track' : 'Active Track'}></div>
                  )}
                </div>
                <div className="text-xs text-white/60">
                  Confidence: {(face.confidence * 100).toFixed(1)}%
                </div>
              </div>
              <div className="text-right">
                {isRecognized && recognitionResult?.similarity && (
                  <div className="text-xs text-green-300">
                    {(recognitionResult.similarity * 100).toFixed(1)}% match
                  </div>
                )}

                {face.antispoofing && (
                  <div className={`text-xs px-2 py-1 rounded mt-1 ${face.antispoofing.status === 'real' ? 'bg-green-900 text-green-300' : face.antispoofing.status === 'fake' ? 'bg-red-900 text-red-300' : face.antispoofing.status === 'error' ? 'bg-yellow-900 text-yellow-300' : 'bg-gray-900 text-gray-300'}`}>
                    <div className="flex items-center justify-between">
                      <span>
                        {face.antispoofing.status === 'real' ? '✓ Live' :
                         face.antispoofing.status === 'fake' ? '⚠ Spoof' :
                         face.antispoofing.status === 'error' ? '❌ Error' : '? Unknown'}
                      </span>
                      {((face.antispoofing.live_score !== undefined && face.antispoofing.live_score !== null) ||
                        (face.antispoofing.spoof_score !== undefined && face.antispoofing.spoof_score !== null)) && (
                        <div className="text-xs ml-2 text-right">
                          {face.antispoofing.live_score !== undefined && face.antispoofing.live_score !== null && (
                            <div className="flex items-center gap-1">
                              <span className="text-green-200">Live:</span>
                              <span className="font-mono">{((face.antispoofing.live_score || 0) * 100).toFixed(0)}%</span>
                            </div>
                          )}
                          {face.antispoofing.spoof_score !== undefined && face.antispoofing.spoof_score !== null && (
                            <div className="flex items-center gap-1">
                              <span className="text-red-200">Spoof:</span>
                              <span className="font-mono">{((face.antispoofing.spoof_score || 0) * 100).toFixed(0)}%</span>
                            </div>
                          )}
                          <div className="w-full bg-white/20 rounded-full h-1 mt-1">
                            <div
                              className={`h-1 rounded-full transition-all duration-300 ${face.antispoofing?.status === 'real' ? 'bg-green-400' : 'bg-red-400'}`}
                              style={{
                                width: `${(face.antispoofing?.status === 'real' ?
                                  (face.antispoofing?.live_score || 0) :
                                  (face.antispoofing?.spoof_score || 0)) * 100}%`
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {/* Manual Log Button */}
                {trackingMode === 'manual' && isRecognized && recognitionResult?.person_id && (
                  <button
                    onClick={() => handleManualLog(
                      recognitionResult.person_id!,
                      recognitionResult.name || recognitionResult.person_id!,
                      face.confidence
                    )}
                    className="mt-2 w-full px-3 py-1 bg-orange-600/20 hover:bg-orange-600/30 border border-orange-500/30 text-orange-300 rounded text-xs transition-colors font-medium"
                  >
                    📝 Log Attendance
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

