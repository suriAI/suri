import { ipcMain } from "electron";
import { backendService, type DetectionOptions } from "../backendService.js";

export function registerBackendHandlers() {
  ipcMain.handle("backend:check-availability", async () => {
    try {
      return await backendService.checkAvailability();
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle("backend:check-readiness", async () => {
    try {
      return await backendService.checkReadiness();
    } catch (error) {
      return {
        ready: false,
        modelsLoaded: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle("backend:get-models", async () => {
    try {
      return await backendService.getModels();
    } catch (error) {
      throw new Error(
        `Failed to get models: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  ipcMain.handle(
    "backend:detect-faces",
    async (_event, imageBase64: string, options: DetectionOptions = {}) => {
      try {
        return await backendService.detectFaces(imageBase64, options);
      } catch (error) {
        throw new Error(
          `Face detection failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  ipcMain.handle(
    "backend:recognize-face",
    async (
      _event,
      imageData: string,
      bbox: number[],
      groupId: string,
      landmarks_5: number[][],
      enableLivenessDetection: boolean,
    ) => {
      try {
        const url = `${backendService.getUrl()}/face/recognize`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: imageData,
            bbox,
            group_id: groupId,
            landmarks_5,
            enable_liveness_detection: enableLivenessDetection,
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        console.error("Face recognition failed:", error);
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    "backend:register-face",
    async (
      _event,
      imageData: string,
      personId: string,
      bbox: number[],
      groupId: string,
      landmarks_5: number[][],
      enableLivenessDetection: boolean,
    ) => {
      try {
        const url = `${backendService.getUrl()}/face/register`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: imageData,
            person_id: personId,
            bbox,
            group_id: groupId,
            landmarks_5,
            enable_liveness_detection: enableLivenessDetection,
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        console.error("Face registration failed:", error);
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle("backend:get-face-stats", async () => {
    const response = await fetch(`${backendService.getUrl()}/face/stats`);
    if (!response.ok) throw new Error("Failed to get stats");
    return await response.json();
  });

  ipcMain.handle("backend:remove-person", async (_event, personId: string) => {
    const response = await fetch(
      `${backendService.getUrl()}/face/person/${encodeURIComponent(personId)}`,
      { method: "DELETE" },
    );
    return await response.json();
  });

  ipcMain.handle(
    "backend:update-person",
    async (_event, oldPersonId: string, newPersonId: string) => {
      const response = await fetch(`${backendService.getUrl()}/face/person`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          old_person_id: oldPersonId,
          new_person_id: newPersonId,
        }),
      });
      return await response.json();
    },
  );

  ipcMain.handle("backend:get-all-persons", async () => {
    const response = await fetch(`${backendService.getUrl()}/face/persons`);
    return await response.json();
  });

  ipcMain.handle("backend:set-threshold", async (_event, threshold: number) => {
    const response = await fetch(`${backendService.getUrl()}/face/threshold`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threshold }),
    });
    return await response.json();
  });

  ipcMain.handle("backend:clear-database", async () => {
    const response = await fetch(`${backendService.getUrl()}/face/database`, {
      method: "DELETE",
    });
    return await response.json();
  });

  ipcMain.handle("backend:is-ready", async () => {
    try {
      const result = await backendService.checkReadiness();
      return result.ready && result.modelsLoaded;
    } catch {
      return false;
    }
  });
}
