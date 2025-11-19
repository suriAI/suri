import { useMemo, memo } from "react";
import { createDisplayNameMap } from "../../../utils";
import type { DetectionResult, TrackedFace } from "../types";
import type { AttendanceMember } from "../../../types/recognition";
import type { ExtendedFaceRecognitionResponse } from "../index";

interface DetectionPanelProps {
  currentDetections: DetectionResult | null;
  currentRecognitionResults: Map<number, ExtendedFaceRecognitionResponse>;
  recognitionEnabled: boolean;
  trackedFaces: Map<string, TrackedFace>;
  groupMembers: AttendanceMember[];
}

// Memoized individual detection card - compact border-status design with enhanced spoof UI
const DetectionCard = memo(
  ({
    face,
    index,
    recognitionResult,
    isRecognized,
    displayName,
    trackedFace,
  }: {
    face: DetectionResult["faces"][0];
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
          borderColor: "border-white/20",
          bgColor: "",
          statusText: "UNKNOWN",
          statusColor: "text-white/60",
        };
      }

      const status = face.liveness.status;

      switch (status) {
        case "live":
          return {
            borderColor: "border-green-500/60",
            bgColor: "",
            statusText: "LIVE",
            statusColor: "text-green-400",
          };
        case "spoof":
          return {
            borderColor: "border-red-500/90",
            bgColor: "bg-red-950/30",
            statusText: "SPOOF",
            statusColor: "text-red-300 font-semibold",
          };
        case "too_small":
          return {
            borderColor: "border-red-500/90",
            bgColor: "bg-red-950/30",
            statusText: "TOO SMALL",
            statusColor: "text-red-300 font-semibold",
          };
        default:
          return {
            borderColor: "border-white/20",
            bgColor: "",
            statusText: "UNKNOWN",
            statusColor: "text-white/60",
          };
      }
    };

    const statusStyles = getStatusStyles();
    const isSpoof =
      face.liveness?.status === "spoof" ||
      face.liveness?.status === "too_small";
    const hasName = isRecognized && recognitionResult?.person_id && displayName;

    return (
      <div
        key={index}
        className={`
        bg-black rounded-lg p-3 border-l-4 min-h-[40px] transition-all
        ${statusStyles.borderColor}
        ${statusStyles.bgColor}
        ${trackedFace?.isLocked ? "border-cyan-500/50 bg-gradient-to-br from-cyan-500/10 to-transparent" : ""}
        ${isSpoof ? "ring-1 ring-red-500/20" : ""}
        ${hasName ? "shadow-md" : ""}
      `}
      >
        {/* Single-line compact layout */}
        <div className="flex items-center justify-between gap-2">
          {/* Left: Name */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {hasName ? (
              <span
                className={`font-semibold text-sm truncate ${
                  isSpoof ? "text-red-200" : "text-white"
                }`}
              >
                {displayName}
              </span>
            ) : (
              <span
                className={`text-xs italic ${
                  isSpoof ? "text-red-300/70" : "text-white/40"
                }`}
              >
                {isSpoof ? "Spoofed Face" : "Unknown"}
              </span>
            )}
          </div>

          {/* Right: Status Text Only (No score display) */}
          {face.liveness && (
            <div
              className={`flex items-center gap-1.5 shrink-0 ${statusStyles.statusColor}`}
            >
              <span
                className={`text-xs ${
                  isSpoof ? "font-bold tracking-wide" : "font-medium"
                }`}
              >
                {statusStyles.statusText}
              </span>
            </div>
          )}
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
}: DetectionPanelProps) {
  // Create display name map for members
  const displayNameMap = useMemo(() => {
    return createDisplayNameMap(groupMembers);
  }, [groupMembers]);

  // Memoize tracked faces array to prevent recreation
  const trackedFacesArray = useMemo(
    () => Array.from(trackedFaces.values()),
    [trackedFaces],
  );

  // Show all faces (including unknown faces)
  // Sort: LIVE faces always on top
  const filteredFaces = useMemo(() => {
    if (!currentDetections?.faces) return [];

    // Show all faces
    const faces = currentDetections.faces;

    // Sort: LIVE faces (status === "live") always on top
    return [...faces].sort((a, b) => {
      const aIsLive = a.liveness?.status === "live";
      const bIsLive = b.liveness?.status === "live";

      if (aIsLive && !bIsLive) return -1; // a comes first
      if (!aIsLive && bIsLive) return 1; // b comes first
      return 0; // maintain original order for same status
    });
  }, [currentDetections?.faces]);

  const hasDetections = filteredFaces.length > 0;

  return (
    <>
      {!hasDetections ? (
        <div className="flex-1 flex items-center justify-center min-h-0">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="relative">
              <svg
                className="w-8 h-8 text-white/30 animate-pulse"
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
            <div className="text-white/50 text-sm font-medium">
              Waiting for faces...
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
