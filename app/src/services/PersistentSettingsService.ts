import type { QuickSettings } from "../components/settings/types.js";
import { defaultSettings } from "./persistentSettingsDefaults.js";

class PersistentSettingsService {
  /**
   * Get the store API from window.electronAPI (with type safety)
   */
  private getStoreAPI(): StoreAPI | null {
    if (typeof window === "undefined") return null;
    // Type assertion for window.electronAPI (defined in global.d.ts)
    const electronAPI = (
      window as Window & { electronAPI?: { store?: StoreAPI } }
    ).electronAPI;
    return electronAPI?.store || null;
  }

  /**
   * Get a value from the store
   */
  async get<T = unknown>(key: string): Promise<T | undefined> {
    const store = this.getStoreAPI();
    if (!store) return undefined;
    return store.get(key) as Promise<T | undefined>;
  }

  /**
   * Set a value in the store
   */
  async set(key: string, value: unknown): Promise<void> {
    const store = this.getStoreAPI();
    if (!store) return;
    await store.set(key, value);
  }

  /**
   * Delete a value from the store
   */
  async delete(key: string): Promise<void> {
    const store = this.getStoreAPI();
    if (!store) return;
    await store.delete(key);
  }

  /**
   * Get all store data
   */
  async getAll(): Promise<Record<string, unknown>> {
    const store = this.getStoreAPI();
    if (!store) return {};
    return await store.getAll();
  }

  // ============================================================================
  // Convenience methods for specific settings
  // ============================================================================

  /**
   * QuickSettings (Display)
   */
  async getQuickSettings(): Promise<QuickSettings> {
    const settings = await this.get<QuickSettings>("quickSettings");
    return settings || defaultSettings.quickSettings;
  }

  async setQuickSettings(settings: QuickSettings): Promise<void> {
    await this.set("quickSettings", settings);
  }

  /**
   * Attendance Settings
   */
  async getAttendanceSettings() {
    const settings =
      await this.get<typeof defaultSettings.attendance>("attendance");
    
    // If no settings exist (first start), initialize with current time
    if (!settings) {
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const initialSettings = {
        ...defaultSettings.attendance,
        classStartTime: currentTime,
      };
      await this.set("attendance", initialSettings);
      return initialSettings;
    }
    
    return settings;
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
    const state = await this.get<typeof defaultSettings.ui>("ui");
    return state || defaultSettings.ui;
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

export const persistentSettings = new PersistentSettingsService();
