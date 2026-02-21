import { persistentStore } from "../persistentStore.js";
import { backendService } from "../backendService.js";
import { getCurrentVersion } from "../updater.js";

export class BackgroundSyncManager {
  private timer: NodeJS.Timeout | null = null;
  private isSyncing = false;

  start() {
    this.stop();

    const enabled = persistentStore.get("sync.enabled") as boolean;
    const syncUrl = persistentStore.get("sync.syncUrl") as string;
    const intervalMinutes =
      (persistentStore.get("sync.intervalMinutes") as number) || 30;

    if (!enabled || !syncUrl) {
      console.log("[Sync] Background Auto-Sync is disabled or URL is missing.");
      return;
    }

    const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
    console.log(
      `[Sync] Starting Auto-Sync. Interval: ${intervalMinutes} minutes.`,
    );

    this.timer = setInterval(() => {
      void this.performSync();
    }, intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async performSync() {
    if (this.isSyncing) return;

    const enabled = persistentStore.get("sync.enabled") as boolean;
    const syncUrl = persistentStore.get("sync.syncUrl") as string;
    const syncKey = (persistentStore.get("sync.syncKey") as string) || "";

    if (!enabled || !syncUrl) {
      this.stop();
      return;
    }

    this.isSyncing = true;
    console.log("[Sync] Triggering background auto-sync...");

    try {
      const exportUrl = `${backendService.getUrl()}/attendance/export`;
      const response = await fetch(exportUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        throw new Error(`Local export failed: HTTP ${response.status}`);
      }

      const payload = await response.json();

      const cloudResponse = await fetch(syncUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": syncKey,
          "X-Suri-Version": getCurrentVersion(),
          "User-Agent": "Suri-Desktop-Sync",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
      });

      if (!cloudResponse.ok) {
        throw new Error(`Cloud POST failed: HTTP ${cloudResponse.status}`);
      }

      console.log("[Sync] Background sync successful.");
      persistentStore.set("sync.lastSyncedAt", new Date().toISOString());
    } catch (error) {
      console.warn("[Sync] Background sync failed:", error);
    } finally {
      this.isSyncing = false;
    }
  }
}

export const syncManager = new BackgroundSyncManager();
