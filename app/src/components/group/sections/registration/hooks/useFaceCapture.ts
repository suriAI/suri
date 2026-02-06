import { useState, useCallback } from "react";
import { attendanceManager, backendService } from "@/services";
import type { AttendanceGroup, AttendanceMember } from "@/types/recognition";
import type { DialogAPI } from "@/components/shared";
import type { CapturedFrame } from "@/components/group/sections/registration/types";
import {
  makeId,
  toBase64Payload,
} from "@/components/group/sections/registration/hooks/useImageProcessing";

export function useFaceCapture(
  group: AttendanceGroup | null,
  members: AttendanceMember[],
  onRefresh?: () => Promise<void> | void,
  dialog?: Pick<DialogAPI, "confirm">,
) {
  const [frames, setFrames] = useState<CapturedFrame[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  const resetFrames = useCallback(() => {
    setFrames([]);
  }, []);

  const updateFrame = useCallback(
    (frameId: string, updater: (frame: CapturedFrame) => CapturedFrame) => {
      setFrames((prev) =>
        prev.map((frame) => (frame.id === frameId ? updater(frame) : frame)),
      );
    },
    [],
  );

  const captureProcessedFrame = useCallback(
    async (angle: string, dataUrl: string, width: number, height: number) => {
      const id = makeId();
      const label = angle;

      setGlobalError(null);
      setSuccessMessage(null);

      setFrames((prev) => {
        const others = prev.filter((frame) => frame.angle !== angle);
        return [
          ...others,
          {
            id,
            angle,
            label,
            dataUrl,
            width,
            height,
            status: "processing",
          },
        ];
      });

      try {
        const detection = await backendService.detectFaces(
          toBase64Payload(dataUrl),
          { model_type: "face_detector" },
        );

        if (!detection.faces || detection.faces.length === 0) {
          throw new Error(
            "No face detected. Make sure your face is visible and in the frame.",
          );
        }

        // Get highest confidence face
        const bestFace = detection.faces.reduce(
          (best, current) =>
            (current.confidence ?? 0) > (best.confidence ?? 0) ? current : best,
          detection.faces[0],
        );

        if (!bestFace.bbox) {
          throw new Error("Face detected but bounding box missing.");
        }

        updateFrame(id, (frame) => ({
          ...frame,
          status: "ready",
          confidence: bestFace.confidence,
          bbox: bestFace.bbox,
          landmarks_5: bestFace.landmarks_5,
          error: undefined,
        }));
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Face analysis failed. Please try again.";
        updateFrame(id, (frame) => ({
          ...frame,
          status: "error",
          error: message,
          confidence: undefined,
          bbox: undefined,
        }));
      }
    },
    [updateFrame],
  );

  const handleRegister = useCallback(
    async (
      selectedMemberId: string,
      loadMemberStatus: () => Promise<void>,
      memberStatus: Map<string, boolean>,
    ) => {
      if (!group) {
        setGlobalError("No group selected.");
        return;
      }

      const REQUIRED_ANGLE = "Front";
      const frame = frames.find((f) => f.angle === REQUIRED_ANGLE);

      if (!frame || frame.status !== "ready" || !frame.bbox) {
        setGlobalError("Please capture a valid face image first.");
        return;
      }

      setIsRegistering(true);
      setGlobalError(null);
      setSuccessMessage(null);

      try {
        const payload = toBase64Payload(frame.dataUrl);
        const result = await attendanceManager.registerFaceForGroupPerson(
          group.id,
          selectedMemberId,
          payload,
          frame.bbox,
          frame.landmarks_5,
        );

        if (!result.success) {
          throw new Error(result.error || "Registration failed.");
        }

        updateFrame(frame.id, (current) => ({
          ...current,
          status: "registered",
        }));

        const isAlreadyRegistered = memberStatus.get(selectedMemberId) ?? false;
        const member = members.find((m) => m.person_id === selectedMemberId);
        const memberName = member?.name || "Member";

        setSuccessMessage(
          isAlreadyRegistered
            ? `${memberName} Re-registered successfully!`
            : `${memberName} Registered successfully!`,
        );

        await loadMemberStatus();
        if (onRefresh) await onRefresh();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Registration failed. Please try again.";
        setGlobalError(message);
      } finally {
        setIsRegistering(false);
      }
    },
    [group, frames, members, updateFrame, onRefresh],
  );

  const handleRemoveFaceData = useCallback(
    async (
      member: AttendanceMember & { displayName?: string },
      loadMemberStatus: () => Promise<void>,
    ) => {
      if (!group) return;

      const displayName = member.displayName || member.name;

      if (dialog) {
        const ok = await dialog.confirm({
          title: "Purge embeddings",
          message: `Remove all face embeddings for ${displayName}?`,
          confirmText: "Remove",
          cancelText: "Cancel",
          confirmVariant: "danger",
        });
        if (!ok) return;
      } else {
        const confirmation = window.confirm(
          `Remove all face embeddings for ${displayName}?`,
        );
        if (!confirmation) return;
      }

      try {
        const result = await attendanceManager.removeFaceDataForGroupPerson(
          group.id,
          member.person_id,
        );
        if (!result.success) {
          throw new Error(result.error || "Failed to remove embeddings");
        }
        await loadMemberStatus();
        if (onRefresh) await onRefresh();
        setSuccessMessage(`Embeddings purged for ${displayName}.`);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to remove face data.";
        setGlobalError(message);
      }
    },
    [group, onRefresh, dialog],
  );

  return {
    frames,
    globalError,
    successMessage,
    isRegistering,
    setGlobalError,
    setSuccessMessage,
    resetFrames,
    captureProcessedFrame,
    handleRegister,
    handleRemoveFaceData,
  };
}
