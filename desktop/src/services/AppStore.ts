import type { QuickSettings } from "../components/settings/types.js";

/**
 * Centralized App Store Service
 * Wraps electron-store with a clean API and handles localStorage migration
 */
class AppStoreService {
  /**
   * Migrate data from localStorage to electron-store (one-time migration)
   */
  async migrateFromLocalStorage(): Promise<void> {
    if (typeof window === "undefined") return;

    try {
      // Check if migration already done
      const migrated = await this.get("_migrated_from_localStorage");
      if (migrated) return;

      // Migrate spoof detection
      const spoofDetection = localStorage.getItem(
        "suri_enable_spoof_detection",
      );
      if (spoofDetection !== null) {
        await this.set(
          "attendance.enableSpoofDetection",
          spoofDetection === "true",
        );
      }

      // Migrate sidebar state
      const sidebarCollapsed = localStorage.getItem("suri_sidebar_collapsed");
      if (sidebarCollapsed !== null) {
        await this.set("ui.sidebarCollapsed", sidebarCollapsed === "true");
      }

      const sidebarWidth = localStorage.getItem("suri_sidebar_width");
      if (sidebarWidth !== null) {
        const width = parseInt(sidebarWidth, 10);
        if (!isNaN(width)) {
          await this.set("ui.sidebarWidth", width);
        }
      }

      // Migrate selected group
      const selectedGroupId = localStorage.getItem("suri_selected_group_id");
      if (selectedGroupId !== null) {
        await this.set("ui.selectedGroupId", selectedGroupId);
      }

      // Migrate group sidebar
      const groupSidebarCollapsed = localStorage.getItem(
        "suri_group_sidebar_collapsed",
      );
      if (groupSidebarCollapsed !== null) {
        await this.set(
          "ui.groupSidebarCollapsed",
          groupSidebarCollapsed === "true",
        );
      }

      // Migrate report views (dynamic keys)
      const reportViewsKeys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("suri_report_views_")) {
          reportViewsKeys.push(key);
        }
      }

      for (const key of reportViewsKeys) {
        try {
          const value = localStorage.getItem(key);
          if (value) {
            const groupId = key.replace("suri_report_views_", "");
            await this.set(`reportViews.${groupId}`, JSON.parse(value));
          }
        } catch (error) {
          console.warn(`[Store] Failed to migrate ${key}:`, error);
        }
      }

      // Migrate default view names
      const defaultViewKeys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("suri_report_default_view_")) {
          defaultViewKeys.push(key);
        }
      }

      for (const key of defaultViewKeys) {
        try {
          const value = localStorage.getItem(key);
          if (value) {
            const groupId = key.replace("suri_report_default_view_", "");
            await this.set(`reportDefaultViewNames.${groupId}`, value);
          }
        } catch (error) {
          console.warn(`[Store] Failed to migrate ${key}:`, error);
        }
      }

      // Mark migration as complete
      await this.set("_migrated_from_localStorage", true);

      console.log("[Store] Migration from localStorage completed");
    } catch (error) {
      console.error("[Store] Migration error:", error);
    }
  }

  /**
   * Get a value from the store
   */
  async get<T = unknown>(key: string): Promise<T | undefined> {
    if (typeof window === "undefined" || !window.electronAPI?.store) {
      return undefined;
    }
    return window.electronAPI.store.get(key) as Promise<T | undefined>;
  }

  /**
   * Set a value in the store
   */
  async set(key: string, value: unknown): Promise<void> {
    if (typeof window === "undefined" || !window.electronAPI?.store) {
      return;
    }
    await window.electronAPI.store.set(key, value);
  }

  /**
   * Delete a value from the store
   */
  async delete(key: string): Promise<void> {
    if (typeof window === "undefined" || !window.electronAPI?.store) {
      return;
    }
    await window.electronAPI.store.delete(key);
  }

  /**
   * Get all store data
   */
  async getAll(): Promise<Record<string, unknown>> {
    if (typeof window === "undefined" || !window.electronAPI?.store) {
      return {};
    }
    return (await window.electronAPI.store.getAll()) as Record<string, unknown>;
  }

  // ============================================================================
  // Convenience methods for specific settings
  // ============================================================================

  /**
   * QuickSettings (Display)
   */
  async getQuickSettings(): Promise<QuickSettings> {
    const settings = await this.get<QuickSettings>("quickSettings");
    return (
      settings || {
        showFPS: false,
        showPreprocessing: false,
        showBoundingBoxes: true,
        showLandmarks: true,
        showRecognitionNames: true,
        cameraMirrored: true,
      }
    );
  }

  async setQuickSettings(settings: QuickSettings): Promise<void> {
    await this.set("quickSettings", settings);
  }

  /**
   * Attendance Settings
   */
  async getAttendanceSettings() {
    const settings = await this.get<{
      enableSpoofDetection: boolean;
      trackingMode: "auto" | "manual";
      lateThresholdEnabled: boolean;
      lateThresholdMinutes: number;
      classStartTime: string;
      attendanceCooldownSeconds: number;
    }>("attendance");
    return (
      settings || {
        enableSpoofDetection: true,
        trackingMode: "auto",
        lateThresholdEnabled: false,
        lateThresholdMinutes: 5,
        classStartTime: "08:00",
        attendanceCooldownSeconds: 10,
      }
    );
  }

  async setAttendanceSettings(
    settings: Partial<{
      enableSpoofDetection: boolean;
      trackingMode: "auto" | "manual";
      lateThresholdEnabled: boolean;
      lateThresholdMinutes: number;
      classStartTime: string;
      attendanceCooldownSeconds: number;
    }>,
  ): Promise<void> {
    const current = await this.getAttendanceSettings();
    await this.set("attendance", { ...current, ...settings });
  }

  /**
   * UI State
   */
  async getUIState() {
    const state = await this.get<{
      sidebarCollapsed: boolean;
      sidebarWidth: number;
      selectedGroupId: string | null;
      groupSidebarCollapsed: boolean;
      selectedCamera: string;
    }>("ui");
    return (
      state || {
        sidebarCollapsed: false,
        sidebarWidth: 320,
        selectedGroupId: null,
        groupSidebarCollapsed: false,
        selectedCamera: "",
      }
    );
  }

  async setUIState(
    state: Partial<{
      sidebarCollapsed: boolean;
      sidebarWidth: number;
      selectedGroupId: string | null;
      groupSidebarCollapsed: boolean;
      selectedCamera: string;
    }>,
  ): Promise<void> {
    const current = await this.getUIState();
    await this.set("ui", { ...current, ...state });
  }

  /**
   * Report Views (per group)
   */
  async getReportViews(groupId: string): Promise<unknown[]> {
    const views = await this.get<Record<string, unknown[]>>("reportViews");
    return views?.[groupId] || [];
  }

  async setReportViews(groupId: string, views: unknown[]): Promise<void> {
    const allViews =
      (await this.get<Record<string, unknown[]>>("reportViews")) || {};
    await this.set("reportViews", { ...allViews, [groupId]: views });
  }

  async getReportDefaultViewName(groupId: string): Promise<string | null> {
    const names = await this.get<Record<string, string>>(
      "reportDefaultViewNames",
    );
    return names?.[groupId] || null;
  }

  async setReportDefaultViewName(
    groupId: string,
    name: string | null,
  ): Promise<void> {
    const allNames =
      (await this.get<Record<string, string>>("reportDefaultViewNames")) || {};
    if (name === null) {
      // Remove the groupId key by creating a new object without it
      const rest = { ...allNames };
      delete rest[groupId];
      await this.set("reportDefaultViewNames", rest);
    } else {
      await this.set("reportDefaultViewNames", {
        ...allNames,
        [groupId]: name,
      });
    }
  }
}

export const appStore = new AppStoreService();
