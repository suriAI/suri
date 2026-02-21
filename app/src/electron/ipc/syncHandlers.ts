import { ipcMain, dialog } from "electron";
import fs from "node:fs/promises";
import { backendService } from "../backendService.js";
import { syncManager } from "../managers/BackgroundSyncManager.js";

export function registerSyncHandlers() {
  // Manual restart/start of the sync manager
  ipcMain.handle("sync:restart-manager", () => {
    syncManager.start();
    return true;
  });

  // Immediate sync trigger
  ipcMain.handle("sync:trigger-now", async () => {
    await syncManager.performSync();
    return true;
  });

  // Export all attendance data
  ipcMain.handle("sync:export-data", async () => {
    try {
      const url = `${backendService.getUrl()}/attendance/export`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok)
        throw new Error(`Export failed: HTTP ${response.status}`);
      const data = await response.json();

      const { canceled, filePath } = await dialog.showSaveDialog({
        title: "Export Suri Data",
        defaultPath: `suri-backup-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "Suri Backup", extensions: ["json"] }],
        buttonLabel: "Export",
      });

      if (canceled || !filePath) return { success: false, canceled: true };

      await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
      return { success: true, filePath };
    } catch (error) {
      console.error("[Sync] Export failed:", error);
      return { success: false, error: String(error) };
    }
  });

  // Import attendance data
  ipcMain.handle(
    "sync:import-data",
    async (_event, overwrite: boolean = false) => {
      try {
        const { canceled, filePaths } = await dialog.showOpenDialog({
          title: "Import Suri Data",
          filters: [{ name: "Suri Backup", extensions: ["json"] }],
          properties: ["openFile"],
          buttonLabel: "Import",
        });

        if (canceled || filePaths.length === 0)
          return { success: false, canceled: true };

        const raw = await fs.readFile(filePaths[0], "utf-8");
        const parsed = JSON.parse(raw);

        const url = `${backendService.getUrl()}/attendance/import`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: parsed, overwrite_existing: overwrite }),
          signal: AbortSignal.timeout(60000),
        });

        if (!response.ok) {
          const err = await response.text();
          throw new Error(`Import failed: ${err}`);
        }

        const result = await response.json();
        return { success: true, message: result.message };
      } catch (error) {
        console.error("[Sync] Import failed:", error);
        return { success: false, error: String(error) };
      }
    },
  );
}
