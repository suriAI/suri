import { useState, useCallback, useMemo } from "react";
// Hook for bulk registration logic
import type { AttendanceGroup, AttendanceMember } from "@/types/recognition";
import type {
  DetectedFace,
  BulkRegistrationResult,
  BulkRegisterResponseItem,
} from "@/components/group/sections/registration/types";
import {
  makeId,
  readFileAsDataUrl,
  toBase64Payload,
} from "@/utils/imageHelpers";

const API_BASE_URL = "http://127.0.0.1:8700";

// Type for pending duplicate files that need confirmation
export interface PendingDuplicateFiles {
  duplicates: File[];
  newFiles: File[];
}

export function useBulkRegistration(
  group: AttendanceGroup,
  members: AttendanceMember[],
  onRefresh?: () => Promise<void> | void,
) {
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [detectedFaces, setDetectedFaces] = useState<DetectedFace[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registrationResults, setRegistrationResults] = useState<
    BulkRegistrationResult[] | null
  >(null);

  // Pending duplicates that need user confirmation
  const [pendingDuplicates, setPendingDuplicates] = useState<PendingDuplicateFiles | null>(null);

  const availableMembers = useMemo(() => {
    const assignedIds = new Set(
      detectedFaces.map((f) => f.assignedPersonId).filter(Boolean),
    );
    return members.filter((m) => !assignedIds.has(m.person_id));
  }, [members, detectedFaces]);

  const createFacePreview = useCallback(
    async (
      imageDataUrl: string,
      bbox:
        | { x: number; y: number; width: number; height: number }
        | [number, number, number, number],
    ): Promise<string> => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const [x, y, w, h] = Array.isArray(bbox)
            ? bbox
            : [bbox.x, bbox.y, bbox.width, bbox.height];

          const padding = 20;
          const desiredX = x - padding;
          const desiredY = y - padding;
          const desiredW = w + padding * 2;
          const desiredH = h + padding * 2;

          const cropX = Math.max(0, desiredX);
          const cropY = Math.max(0, desiredY);
          const cropX2 = Math.min(img.width, desiredX + desiredW);
          const cropY2 = Math.min(img.height, desiredY + desiredH);
          const cropW = cropX2 - cropX;
          const cropH = cropY2 - cropY;

          const offsetX = Math.max(0, -desiredX);
          const offsetY = Math.max(0, -desiredY);

          canvas.width = desiredW;
          canvas.height = desiredH;

          const ctx = canvas.getContext("2d");
          if (ctx && cropW > 0 && cropH > 0) {
            ctx.drawImage(
              img,
              cropX,
              cropY,
              cropW,
              cropH,
              offsetX,
              offsetY,
              cropW,
              cropH,
            );
            resolve(canvas.toDataURL("image/jpeg", 0.9));
          } else {
            resolve(imageDataUrl);
          }
        };
        img.src = imageDataUrl;
      });
    },
    [],
  );

  const handleDetectFaces = useCallback(
    async (filesToProcess?: File[], startIndex: number = 0) => {
      const files = filesToProcess || uploadedFiles;
      if (files.length === 0) {
        if (!filesToProcess) setError("Please upload images first");
        return;
      }

      setIsDetecting(true);
      setError(null);

      try {
        const imagesData = await Promise.all(
          files.map(async (file, idx) => {
            const dataUrl = await readFileAsDataUrl(file);
            return {
              id: `image_${startIndex + idx}`,
              image: toBase64Payload(dataUrl),
              fileName: file.name,
            };
          }),
        );

        const response = await fetch(
          `${API_BASE_URL}/attendance/groups/${group.id}/bulk-detect-faces`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ images: imagesData }),
          },
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || "Face detection failed");
        }

        const result = await response.json();
        const allDetectedFaces: DetectedFace[] = [];

        for (const imageResult of result.results) {
          if (
            !imageResult.success ||
            !imageResult.faces ||
            imageResult.faces.length === 0
          ) {
            continue;
          }

          const imageIdx = parseInt(imageResult.image_id.replace("image_", ""));
          const file = files[imageIdx - startIndex];
          const dataUrl = await readFileAsDataUrl(file);

          for (const face of imageResult.faces) {
            const previewUrl = await createFacePreview(dataUrl, face.bbox);

            allDetectedFaces.push({
              faceId: makeId(),
              imageId: imageResult.image_id,
              bbox: face.bbox,
              confidence: face.confidence,
              landmarks_5: face.landmarks_5,
              qualityScore: face.quality_score,
              isAcceptable: face.is_acceptable,
              suggestions: face.suggestions || [],
              assignedPersonId: null,
              previewUrl,
            });
          }
        }

        setDetectedFaces((prev) =>
          filesToProcess ? [...prev, ...allDetectedFaces] : allDetectedFaces,
        );

        if (allDetectedFaces.length === 0) {
          setError(
            filesToProcess
              ? "No new faces detected"
              : "No faces detected in uploaded images",
          );
        }
      } catch (err) {
        console.error("Face detection error:", err);
        setError(err instanceof Error ? err.message : "Failed to detect faces");
      } finally {
        setIsDetecting(false);
      }
    },
    [uploadedFiles, group.id, createFacePreview],
  );

  // Helper to check if a file is a duplicate (same name and size)
  const isFileDuplicate = useCallback(
    (file: File): boolean => {
      return uploadedFiles.some(
        (existing) =>
          existing.name === file.name && existing.size === file.size,
      );
    },
    [uploadedFiles],
  );

  // Process files (either new or after duplicate confirmation)
  const processFiles = useCallback(
    async (filesToProcess: File[]) => {
      if (filesToProcess.length === 0) return;

      const startIndex = uploadedFiles.length;
      setUploadedFiles((prev) => [...prev, ...filesToProcess]);
      // Append new files faces detection
      await handleDetectFaces(filesToProcess, startIndex);
    },
    [handleDetectFaces, uploadedFiles.length],
  );

  const handleFilesSelected = useCallback(
    async (files: FileList | null) => {
      if (!files) return;

      const imageFiles = Array.from(files).filter((file) =>
        file.type.startsWith("image/"),
      );

      if (imageFiles.length === 0) return;

      // Check for duplicates
      const duplicates: File[] = [];
      const newFiles: File[] = [];

      for (const file of imageFiles) {
        if (isFileDuplicate(file)) {
          duplicates.push(file);
        } else {
          newFiles.push(file);
        }
      }

      // If there are duplicates, show confirmation modal
      if (duplicates.length > 0) {
        setPendingDuplicates({ duplicates, newFiles });
        return;
      }

      // No duplicates, process all files directly
      await processFiles(newFiles);
    },
    [isFileDuplicate, processFiles],
  );

  // Confirm adding duplicate files
  const handleConfirmDuplicates = useCallback(async () => {
    if (!pendingDuplicates) return;

    const allFiles = [...pendingDuplicates.newFiles, ...pendingDuplicates.duplicates];
    setPendingDuplicates(null);
    await processFiles(allFiles);
  }, [pendingDuplicates, processFiles]);

  // Cancel duplicate upload - only add new files
  const handleCancelDuplicates = useCallback(async () => {
    if (!pendingDuplicates) return;

    const newFilesOnly = pendingDuplicates.newFiles;
    setPendingDuplicates(null);

    if (newFilesOnly.length > 0) {
      await processFiles(newFilesOnly);
    }
  }, [pendingDuplicates, processFiles]);

  // Dismiss duplicate modal without adding any files
  const handleDismissDuplicates = useCallback(() => {
    setPendingDuplicates(null);
  }, []);

  const handleClearFiles = useCallback(() => {
    setUploadedFiles([]);
    setDetectedFaces([]);
    setError(null);
    setRegistrationResults(null);
    setPendingDuplicates(null);
  }, []);

  const handleAssignMember = useCallback((faceId: string, personId: string) => {
    setDetectedFaces((prev) =>
      prev.map((face) =>
        face.faceId === faceId ? { ...face, assignedPersonId: personId } : face,
      ),
    );
  }, []);

  const handleUnassign = useCallback((faceId: string) => {
    setDetectedFaces((prev) =>
      prev.map((face) =>
        face.faceId === faceId ? { ...face, assignedPersonId: null } : face,
      ),
    );
  }, []);

  const handleBulkRegister = useCallback(async () => {
    const assignedFaces = detectedFaces.filter((f) => f.assignedPersonId);
    if (assignedFaces.length === 0) {
      setError("Please assign at least one face to a member");
      return;
    }

    setIsRegistering(true);
    setError(null);
    setRegistrationResults(null);

    try {
      const registrations = await Promise.all(
        assignedFaces.map(async (face) => {
          const imageIdx = parseInt(face.imageId.replace("image_", ""));
          const file = uploadedFiles[imageIdx];
          const dataUrl = await readFileAsDataUrl(file);

          return {
            person_id: face.assignedPersonId,
            image: toBase64Payload(dataUrl),
            bbox: face.bbox,
            landmarks_5: face.landmarks_5,
            skip_quality_check: false,
          };
        }),
      );

      const response = await fetch(
        `${API_BASE_URL}/attendance/groups/${group.id}/bulk-register-faces`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ registrations }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Bulk registration failed");
      }

      const result = await response.json();
      const results: BulkRegistrationResult[] = result.results.map(
        (r: BulkRegisterResponseItem) => ({
          personId: r.person_id,
          memberName: r.member_name || "",
          success: r.success,
          error: r.error,
          qualityWarning: r.quality_warning,
        }),
      );

      setRegistrationResults(results);
      if (result.success_count > 0 && onRefresh) {
        await onRefresh();
      }
    } catch (err) {
      console.error("Bulk registration error:", err);
      setError(err instanceof Error ? err.message : "Failed to register faces");
    } finally {
      setIsRegistering(false);
    }
  }, [detectedFaces, uploadedFiles, group.id, onRefresh]);

  return {
    uploadedFiles,
    detectedFaces,
    isDetecting,
    isRegistering,
    error,
    setError,
    registrationResults,
    availableMembers,
    pendingDuplicates,
    handleFilesSelected,
    handleConfirmDuplicates,
    handleCancelDuplicates,
    handleDismissDuplicates,
    handleAssignMember,
    handleUnassign,
    handleBulkRegister,
    handleClearFiles,
  };
}
