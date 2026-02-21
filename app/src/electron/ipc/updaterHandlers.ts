import { ipcMain } from "electron";
import {
  checkForUpdates,
  getCurrentVersion,
  openReleasePage,
} from "../updater.js";

export function registerUpdaterHandlers() {
  ipcMain.handle(
    "updater:check-for-updates",
    async (_event, force?: boolean) => {
      try {
        return await checkForUpdates(force);
      } catch (error) {
        console.error("[Updater] Update check failed:", error);
        return {
          currentVersion: getCurrentVersion(),
          latestVersion: getCurrentVersion(),
          hasUpdate: false,
          error: String(error),
        };
      }
    },
  );

  ipcMain.handle("updater:get-version", () => {
    return getCurrentVersion();
  });

  ipcMain.handle("updater:open-release-page", (_event, url?: string) => {
    openReleasePage(url);
    return true;
  });
}
