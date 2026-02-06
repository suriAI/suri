/**
 * Updater Service
 *
 * Provides update checking functionality for the renderer process.
 * Communicates with the main process via IPC.
 */

import type { UpdateInfo } from "@/types/global";
import { persistentSettings } from "./PersistentSettingsService";

class UpdaterService {
  private cachedVersion: string | null = null;
  private cachedUpdateInfo: UpdateInfo | null = null;
  private lastChecked: Date | null = null;
  private initPromise: Promise<void>;
  private updateInfoListeners = new Set<(info: UpdateInfo | null) => void>();

  constructor() {
    this.initPromise = this.loadFromStore();
  }

  private emitUpdateInfo(info: UpdateInfo | null) {
    for (const listener of this.updateInfoListeners) {
      try {
        listener(info);
      } catch (error) {
        console.error("[UpdaterService] update listener failed:", error);
      }
    }
  }

  private async loadFromStore() {
    try {
      const info = await persistentSettings.getUpdaterInfo();
      if (info) {
        this.cachedUpdateInfo = info.cachedInfo;
        if (info.lastChecked) {
          this.lastChecked = new Date(info.lastChecked);
        }
      }

      // Notify any subscribers that were waiting for initialization.
      this.emitUpdateInfo(this.cachedUpdateInfo);
    } catch (error) {
      console.error("[UpdaterService] Initialization failed:", error);
    }
  }

  /**
   * Get the current app version
   */
  async getVersion(): Promise<string> {
    if (this.cachedVersion) {
      return this.cachedVersion;
    }

    try {
      const version = await window.electronAPI.updater.getVersion();
      this.cachedVersion = version;
      return version;
    } catch (error) {
      console.error("[UpdaterService] Failed to get version:", error);
      return "0.0.0";
    }
  }

  /**
   * Check for updates from GitHub releases
   * @param force - If true, bypasses the cache
   */
  async checkForUpdates(force = false): Promise<UpdateInfo> {
    try {
      const updateInfo =
        await window.electronAPI.updater.checkForUpdates(force);
      this.cachedUpdateInfo = updateInfo;
      this.lastChecked = new Date();

      // Persist to disk
      await persistentSettings.setUpdaterInfo({
        cachedInfo: updateInfo,
        lastChecked: this.lastChecked.toISOString(),
      });

      // Broadcast result (including hasUpdate=false) so UI like footer can clear.
      this.emitUpdateInfo(updateInfo);

      return updateInfo;
    } catch (error) {
      console.error("[UpdaterService] Failed to check for updates:", error);
      const version = await this.getVersion();
      const fallback: UpdateInfo = {
        currentVersion: version,
        latestVersion: version,
        hasUpdate: false,
        releaseUrl: "",
        releaseNotes: "",
        publishedAt: "",
        downloadUrl: null,
        error: error instanceof Error ? error.message : String(error),
      };

      this.cachedUpdateInfo = fallback;
      this.lastChecked = new Date();
      this.emitUpdateInfo(fallback);

      return fallback;
    }
  }

  /**
   * Subscribe to update-info changes (fires for both update available and up-to-date results).
   */
  onUpdateInfoChanged(
    callback: (updateInfo: UpdateInfo | null) => void,
  ): () => void {
    this.updateInfoListeners.add(callback);

    // Ensure callback receives the best-known value after store init.
    this.waitForInitialization()
      .then(() => callback(this.cachedUpdateInfo))
      .catch(() => {});

    return () => {
      this.updateInfoListeners.delete(callback);
    };
  }

  /**
   * Get cached update info if available
   */
  getCachedUpdateInfo(): UpdateInfo | null {
    return this.cachedUpdateInfo;
  }

  /**
   * Get the last checked date
   */
  getLastChecked(): Date | null {
    return this.lastChecked;
  }

  /**
   * Wait for the service to be initialized from store
   */
  async waitForInitialization(): Promise<void> {
    return this.initPromise;
  }

  /**
   * Open the GitHub releases page
   */
  async openReleasePage(url?: string): Promise<void> {
    try {
      await window.electronAPI.updater.openReleasePage(url);
    } catch (error) {
      console.error("[UpdaterService] Failed to open release page:", error);
      // Fallback: try to open in new window
      window.open(
        url || "https://github.com/suriAI/suri/releases/latest",
        "_blank",
      );
    }
  }

  /**
   * Subscribe to update availability notifications from main process
   */
  onUpdateAvailable(callback: (updateInfo: UpdateInfo) => void): () => void {
    return window.electronAPI.updater.onUpdateAvailable(async (updateInfo) => {
      this.cachedUpdateInfo = updateInfo;
      this.lastChecked = new Date();

      // Persist to disk
      await persistentSettings.setUpdaterInfo({
        cachedInfo: updateInfo,
        lastChecked: this.lastChecked.toISOString(),
      });

      // Keep any generic subscribers in sync.
      this.emitUpdateInfo(updateInfo);

      callback(updateInfo);
    });
  }

  /**
   * Format the published date nicely
   */
  formatPublishedDate(isoDate: string): string {
    if (!isoDate) return "";
    try {
      const date = new Date(isoDate);
      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return isoDate;
    }
  }

  /**
   * Parse release notes into sections (basic markdown support)
   */
  parseReleaseNotes(notes: string): string[] {
    if (!notes) return [];
    // Split by newlines, filter empty lines, and take first 10 lines
    return notes
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 10);
  }
}

// Singleton instance
export const updaterService = new UpdaterService();
