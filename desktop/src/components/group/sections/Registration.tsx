import { useState } from "react";
import { FaceCapture } from "./registration/FaceCapture.js";
import { BulkFaceRegistration } from "../modals/BulkFaceRegistration.js";
import { AssistedCameraRegistration } from "../modals/AssistedCameraRegistration.js";
import type {
  AttendanceGroup,
  AttendanceMember,
} from "../../../types/recognition.js";

interface RegistrationProps {
  group: AttendanceGroup;
  members: AttendanceMember[];
  onRefresh: () => void;
}

type SourceType = "upload" | "camera" | null;
type RegistrationMode = "single" | "bulk" | "queue" | null;

export function Registration({ group, members, onRefresh }: RegistrationProps) {
  const [source, setSource] = useState<SourceType>(null);
  const [mode, setMode] = useState<RegistrationMode>(null);

  // Handle mode selection after source is chosen
  const handleModeSelect = (selectedMode: RegistrationMode) => {
    setMode(selectedMode);
  };

  // Reset to source selection
  const handleBack = () => {
    setMode(null);
    setSource(null);
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
        onBack={handleBack}
        initialSource={source}
      />
    );
  }

  // Step 1: Choose source (Upload or Camera)
  if (!source) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4">
          <div className="text-center mb-8">
            <h2 className="text-xl font-semibold text-white mb-2">
              Choose Registration Method
            </h2>
            <p className="text-sm text-white/50">
              Select how you want to capture faces
            </p>
          </div>

          <div className="grid gap-4">
            {/* Upload Button */}
            <button
              onClick={() => setSource("upload")}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-8 text-left hover:border-white/20 hover:bg-white/10 transition-all duration-300"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-white/0 to-white/0 group-hover:from-white/5 group-hover:to-transparent transition-all duration-300" />
              <div className="relative flex items-center gap-4">
                <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-colors">
                  <svg
                    className="w-6 h-6 text-white/60 group-hover:text-white/80"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="text-lg font-medium text-white mb-1">
                    Upload
                  </div>
                  <div className="text-sm text-white/50">
                    Upload images from your device
                  </div>
                </div>
                <svg
                  className="w-5 h-5 text-white/20 group-hover:text-white/60 transition-all"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </div>
            </button>

            {/* Camera Button */}
            <button
              onClick={() => setSource("camera")}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-8 text-left hover:border-white/20 hover:bg-white/10 transition-all duration-300"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-white/0 to-white/0 group-hover:from-white/5 group-hover:to-transparent transition-all duration-300" />
              <div className="relative flex items-center gap-4">
                <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-colors">
                  <svg
                    className="w-6 h-6 text-white/60 group-hover:text-white/80"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="text-lg font-medium text-white mb-1">
                    Camera
                  </div>
                  <div className="text-sm text-white/50">
                    Capture faces using live camera
                  </div>
                </div>
                <svg
                  className="w-5 h-5 text-white/20 group-hover:text-white/60 transition-all"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Step 2: Choose mode based on selected source
  return (
    <div className="h-full flex flex-col overflow-hidden space-y-6 p-6">
      {/* Back Button */}
      <button
        onClick={() => setSource(null)}
        className="flex items-center gap-2 text-white/60 hover:text-white/80 transition-colors text-sm self-start"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
        <span>Back</span>
      </button>

      {/* Mode Selection Header */}
      <div className="text-center mb-4">
        <h2 className="text-xl font-semibold text-white mb-2">
          Choose Registration Type
        </h2>
        <p className="text-sm text-white/50">
          {source === "upload"
            ? "Select how you want to process uploaded images"
            : "Select how you want to capture faces with camera"}
        </p>
      </div>

      {/* Mode Cards */}
      <div className="grid gap-3 flex-1 overflow-y-auto custom-scroll overflow-x-hidden min-h-0 pr-2">
        {/* Individual - Available for both upload and camera */}
        <button
          onClick={() => handleModeSelect("single")}
          className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-6 text-left hover:border-white/20 hover:bg-white/10 transition-all duration-300"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-white/0 to-white/0 group-hover:from-white/5 group-hover:to-transparent transition-all duration-300" />
          <div className="relative flex items-start gap-4">
            <div className="flex-1">
              <div className="text-lg font-medium text-white mb-1">
                Individual
              </div>
              <div className="text-sm text-white/50">
                Register one person at a time with high-quality face capture
              </div>
            </div>
            <svg
              className="w-5 h-5 text-white/20 group-hover:text-white/60 transition-all"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </div>
        </button>

        {/* Batch Upload - Only available for upload */}
        {source === "upload" && (
          <button
            onClick={() => handleModeSelect("bulk")}
            className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-6 text-left hover:border-white/20 hover:bg-white/10 transition-all duration-300"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/0 to-white/0 group-hover:from-white/5 group-hover:to-transparent transition-all duration-300" />
            <div className="relative flex items-start gap-4">
              <div className="flex-1">
                <div className="text-lg font-medium text-white mb-1">
                  Batch Upload
                </div>
                <div className="text-sm text-white/50">
                  Process multiple photos at once, assign faces
                </div>
              </div>
              <svg
                className="w-5 h-5 text-white/20 group-hover:text-white/60 transition-all"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </div>
          </button>
        )}

        {/* Camera Queue - Only available for camera */}
        {source === "camera" && (
          <button
            onClick={() => handleModeSelect("queue")}
            className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-6 text-left hover:border-white/20 hover:bg-white/10 transition-all duration-300"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/0 to-white/0 group-hover:from-white/5 group-hover:to-transparent transition-all duration-300" />
            <div className="relative flex items-start gap-4">
              <div className="flex-1">
                <div className="text-lg font-medium text-white mb-1">
                  Camera Queue
                </div>
                <div className="text-sm text-white/50">
                  Capture multiple people sequentially with live camera
                </div>
              </div>
              <svg
                className="w-5 h-5 text-white/20 group-hover:text-white/60 transition-all"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}
