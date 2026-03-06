import { useMemo, memo } from "react";
import { MemberTooltip } from "@/components/shared";
import { createDisplayNameMap } from "@/utils";
import type { DetectionResult, TrackedFace } from "@/components/main/types";
import type { AttendanceMember } from "@/types/recognition";
import type { ExtendedFaceRecognitionResponse } from "@/components/main/utils";

interface DetectionPanelProps {
  currentDetections: DetectionResult | null;
  currentRecognitionResults: Map<number, ExtendedFaceRecognitionResponse>;
  recognitionEnabled: boolean;
  trackedFaces: Map<string, TrackedFace>;
  groupMembers: AttendanceMember[];
  isStreaming: boolean;
  isVideoLoading: boolean;
}

const DetectionCard = memo(
  ({
    index,
    recognitionResult,
    isRecognized,
    displayName,
    trackedFace,
  }: {
    index: number;
    recognitionResult: ExtendedFaceRecognitionResponse | undefined;
    isRecognized: boolean;
    displayName: string;
    trackedFace: TrackedFace | undefined;
  }) => {
    const getStatusStyles = () => {
      if (isRecognized) {
        return {
          borderColor: "border-cyan-500/60",
          bgColor: "bg-cyan-950/10",
          textColor: "text-cyan-400",
        };
      }

      return {
        borderColor: "border-white/10",
        bgColor: "",
        textColor: "text-white/60",
      };
    };

    const statusStyles = getStatusStyles();
    const hasName = isRecognized && recognitionResult?.person_id && displayName;

    return (
      <div
        key={index}
        className={`
        bg-black rounded-lg p-3 border-l-4 min-h-[40px] transition-all
        ${statusStyles.borderColor}
        ${statusStyles.bgColor}
        ${trackedFace?.isLocked ? "border-cyan-500/50 bg-linear-to-br from-cyan-500/10 to-transparent" : ""}
        ${hasName ? "shadow-md" : ""}
      `}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {hasName ? (
              <MemberTooltip
                displayName={displayName}
                position="right"
                role="Recognized"
              >
                <span
                  className={`font-semibold text-sm truncate cursor-help ${statusStyles.textColor}`}
                >
                  {displayName}
                </span>
              </MemberTooltip>
            ) : (
              <span className="text-xs italic text-white/40">Unknown</span>
            )}
          </div>
        </div>
      </div>
    );
  },
);

DetectionCard.displayName = "DetectionCard";

export function DetectionPanel({
  currentDetections,
  currentRecognitionResults,
  recognitionEnabled,
  trackedFaces,
  groupMembers,
  isStreaming,
  isVideoLoading,
}: DetectionPanelProps) {
  const displayNameMap = useMemo(() => {
    return createDisplayNameMap(groupMembers);
  }, [groupMembers]);

  const trackedFacesArray = useMemo(
    () => Array.from(trackedFaces.values()),
    [trackedFaces],
  );

  const filteredFaces = useMemo(() => {
    if (!currentDetections?.faces) return [];

    const faces = currentDetections.faces;

    return [...faces].sort((a, b) => {
      const aIsLive = a.liveness?.status === "real";
      const bIsLive = b.liveness?.status === "real";

      if (aIsLive && !bIsLive) return -1; // a comes first
      if (!aIsLive && bIsLive) return 1; // b comes first
      return 0; // maintain original order for same status
    });
  }, [currentDetections]);

  const hasDetections = filteredFaces.length > 0;

  return (
    <>
      {!hasDetections ? (
        <div className="flex-1 flex items-center justify-center min-h-0">
          <div className="relative flex flex-col items-center gap-4">
            <div className="relative w-20 h-20">
              {isVideoLoading ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-14 h-14 border-2 border-white/20 border-t-white/60 rounded-full animate-spin"></div>
                </div>
              ) : (
                <>
                  <div
                    className={`absolute inset-0 rounded-xl border ${isStreaming ? "border-cyan-500/30 ai-pulse-ring" : "border-white/20"}`}
                  />

                  <div className="absolute inset-1 rounded-lg overflow-hidden">
                    {isStreaming && (
                      <div className="absolute left-0 right-0 h-0.5 bg-linear-to-r from-transparent via-cyan-400 to-transparent ai-scan-line" />
                    )}

                    <svg
                      className={`w-full h-full p-4 ${isStreaming ? "text-cyan-400/50" : "text-white/30 animate-pulse"}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                  </div>

                  <div
                    className={`absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 rounded-tl-lg ${isStreaming ? "border-cyan-400/40" : "border-white/20"}`}
                  />
                  <div
                    className={`absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 rounded-tr-lg ${isStreaming ? "border-cyan-400/40" : "border-white/20"}`}
                  />
                  <div
                    className={`absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 rounded-bl-lg ${isStreaming ? "border-cyan-400/40" : "border-white/20"}`}
                  />
                  <div
                    className={`absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 rounded-br-lg ${isStreaming ? "border-cyan-400/40" : "border-white/20"}`}
                  />
                </>
              )}
            </div>

            <div
              className={`text-sm font-medium ${isStreaming ? "text-cyan-400/60" : "text-white/40"}`}
            >
              {isVideoLoading ? null : isStreaming ? (
                <span className="flex items-center gap-1">
                  <span>Tracking</span>
                  <span className="flex gap-0.5">
                    <span className="ai-dot-1">.</span>
                    <span className="ai-dot-2">.</span>
                    <span className="ai-dot-3">.</span>
                  </span>
                </span>
              ) : (
                <span>Ready to Track</span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5 w-full py-2">
          {filteredFaces.map((face, index) => {
            const trackId = face.track_id!;
            const recognitionResult = currentRecognitionResults.get(trackId);
            const isRecognized =
              recognitionEnabled && !!recognitionResult?.person_id;
            const displayName = recognitionResult?.person_id
              ? displayNameMap.get(recognitionResult.person_id) || "Unknown"
              : "";

            const trackedFace = trackedFacesArray.find(
              (track) =>
                track.personId === recognitionResult?.person_id ||
                (Math.abs(track.bbox.x - face.bbox.x) < 30 &&
                  Math.abs(track.bbox.y - face.bbox.y) < 30),
            );

            return (
              <DetectionCard
                key={trackId}
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
