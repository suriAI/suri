import { useState, useEffect } from "react";

import { AssistedCameraRegistration, BulkFaceRegistration } from "../modals";
import { FaceCapture } from "../sections";
import type {
  AttendanceGroup,
  AttendanceMember,
} from "../../../types/recognition.js";

interface RegistrationProps {
  group: AttendanceGroup;
  members: AttendanceMember[];
  onRefresh: () => void;
  onSourceChange?: (source: "upload" | "camera" | null) => void;
  registrationSource?: "upload" | "camera" | null;
  onModeChange?: (mode: "single" | "bulk" | "queue" | null) => void;
  registrationMode?: "single" | "bulk" | "queue" | null;
  deselectMemberTrigger?: number;
  onHasSelectedMemberChange?: (hasSelectedMember: boolean) => void;
}

type SourceType = "upload" | "camera" | null;
type RegistrationMode = "single" | "bulk" | "queue" | null;

export function Registration({
  group,
  members,
  onRefresh,
  onSourceChange,
  registrationSource,
  onModeChange,
  registrationMode,
  deselectMemberTrigger,
  onHasSelectedMemberChange,
}: RegistrationProps) {
  const [source, setSource] = useState<SourceType>(null);
  const [mode, setMode] = useState<RegistrationMode>(null);

  // Sync with parent's source state
  useEffect(() => {
    if (registrationSource !== undefined) {
      setSource(registrationSource);
      // Reset mode when source is cleared
      if (registrationSource === null) {
        setMode(null);
      }
    }
  }, [registrationSource]);

  // Sync with parent's mode state
  useEffect(() => {
    if (registrationMode !== undefined) {
      setMode(registrationMode);
    }
  }, [registrationMode]);

  // Notify parent when source changes
  const handleSourceChange = (newSource: SourceType) => {
    setSource(newSource);
    if (onSourceChange) {
      onSourceChange(newSource);
    }
  };

  // Handle mode selection after source is chosen
  const handleModeSelect = (selectedMode: RegistrationMode) => {
    setMode(selectedMode);
    if (onModeChange) {
      onModeChange(selectedMode);
    }
  };

  // Reset to source selection
  const handleBack = () => {
    setMode(null);
    handleSourceChange(null);
  };

  // If mode is selected, render the appropriate component
  if (mode === "bulk" && source === "upload") {
    return (
      <BulkFaceRegistration
        group={group}
        members={members}
        onRefresh={onRefresh}
        onClose={handleBack}
      />
    );
  }

  if (mode === "queue" && source === "camera") {
    return (
      <AssistedCameraRegistration
        group={group}
        members={members}
        onRefresh={onRefresh}
        onClose={handleBack}
      />
    );
  }

  if (mode === "single" && source) {
    return (
      <FaceCapture
        group={group}
        members={members}
        onRefresh={onRefresh}
        initialSource={source === "camera" ? "live" : source}
        deselectMemberTrigger={deselectMemberTrigger}
        onSelectedMemberChange={onHasSelectedMemberChange}
      />
    );
  }

  // Step 1: Choose source (Upload or Camera)
  if (!source) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-lg">
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => handleSourceChange("upload")}
              className="flex flex-col items-center gap-4 p-8 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all"
            >
              <svg
                className="w-12 h-12 text-white/80"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <span className="text-base font-medium text-white">Upload</span>
            </button>

            <button
              onClick={() => handleSourceChange("camera")}
              className="flex flex-col items-center gap-4 p-8 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all"
            >
              <svg
                className="w-12 h-12 text-white/80"
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
              <span className="text-base font-medium text-white">Camera</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Step 2: Choose mode based on selected source
  return (
    <div className="h-full flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-lg">
        <div className="grid gap-3">
          <button
            onClick={() => handleModeSelect("single")}
            className="p-6 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all text-center"
          >
            <span className="text-base font-medium text-white">Individual</span>
          </button>

          {source === "upload" && (
            <button
              onClick={() => handleModeSelect("bulk")}
              className="p-6 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all text-center"
            >
              <span className="text-base font-medium text-white">
                Batch Upload
              </span>
            </button>
          )}

          {source === "camera" && (
            <button
              onClick={() => handleModeSelect("queue")}
              className="p-6 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all text-center"
            >
              <span className="text-base font-medium text-white">
                Camera Queue
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
