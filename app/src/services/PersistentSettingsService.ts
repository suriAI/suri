import type { QuickSettings } from "../components/settings/types";
import {
  defaultSettings,
  type PersistentSettingsSchema,
} from "./persistentSettingsDefaults";

class PersistentSettingsService {
  private scope: string | null = null;

  /**
   * Set the organization/tenant scope for settings.
   * When set, all get/set operations will be isolated to this scope.
   */
  setScope(scopeId: string | null): void {
    this.scope = scopeId;
  }

  /**
   * Helper to return a scoped key if a scope is set.
   * Format: orgs.[scopeId].[key]
   */
  private scopedKey(key: string): string {
    if (!this.scope) return key;
    return `orgs.${this.scope}.${key}`;
  }

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
    const finalKey = this.scopedKey(key);
    return store.get(finalKey) as Promise<T | undefined>;
  }

  /**
   * Set a value in the store
   */
  async set(key: string, value: unknown): Promise<void> {
    const store = this.getStoreAPI();
    if (!store) return;
    const finalKey = this.scopedKey(key);
    await store.set(finalKey, value);
  }

  /**
   * Delete a value from the store
   */
  async delete(key: string): Promise<void> {
    const store = this.getStoreAPI();
    if (!store) return;
    const finalKey = this.scopedKey(key);
    await store.delete(finalKey);
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

    if (!settings) {
      await this.set("quickSettings", defaultSettings.quickSettings);
      return defaultSettings.quickSettings;
    }

    // Merge for forward-compat when new fields are added
    return { ...defaultSettings.quickSettings, ...settings };
  }

  async setQuickSettings(settings: QuickSettings): Promise<void> {
    await this.set("quickSettings", settings);
  }

  /**
   * Audio Settings
   */
  async getAudioSettings(): Promise<PersistentSettingsSchema["audio"]> {
    const settings = await this.get<PersistentSettingsSchema["audio"]>("audio");

    if (!settings) {
      await this.set("audio", defaultSettings.audio);
      return defaultSettings.audio;
    }

    return { ...defaultSettings.audio, ...settings };
  }

  async setAudioSettings(
    settings: Partial<PersistentSettingsSchema["audio"]>,
  ): Promise<void> {
    const current = await this.getAudioSettings();
    await this.set("audio", { ...current, ...settings });
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
      // trackingMode removed
      lateThresholdEnabled: boolean;
      lateThresholdMinutes: number;
      classStartTime: string;
      attendanceCooldownSeconds: number;
      reLogCooldownSeconds: number;
    }>,
  ): Promise<void> {
    const current = await this.getAttendanceSettings();
    await this.set("attendance", { ...current, ...settings });
  }

  /**
   * UI State
   */
  async getUIState(): Promise<PersistentSettingsSchema["ui"]> {
    const state = await this.get<PersistentSettingsSchema["ui"]>("ui");

    if (!state) {
      // Match AttendanceSettings pattern: Write defaults if missing to ensure key exists
      await this.set("ui", defaultSettings.ui);
      return defaultSettings.ui;
    }

    // Merge with defaults to ensure all fields are present (e.g. new fields added in updates)
    return { ...defaultSettings.ui, ...state };
  }

  async setUIState(
    state: Partial<PersistentSettingsSchema["ui"]>,
  ): Promise<void> {
    // Use granular updates to prevent race conditions (read-modify-write patterns were overwriting each other)
    // electron-store supports dot notation for nested updates
    const updates = Object.entries(state).map(([key, value]) => {
      return this.set(`ui.${key}`, value);
    });

    await Promise.all(updates);
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

  /**
   * Report Scratchpad (Transient tweaks)
   */
  async getReportScratchpad(groupId: string): Promise<unknown> {
    const scratchpad =
      (await this.get<Record<string, unknown>>("reportScratchpad")) || {};
    return scratchpad[groupId];
  }

  async setReportScratchpad(groupId: string, config: unknown): Promise<void> {
    const scratchpad =
      (await this.get<Record<string, unknown>>("reportScratchpad")) || {};
    scratchpad[groupId] = config;
    await this.set("reportScratchpad", scratchpad);
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

  /**
   * Updater Info
   */
  async getUpdaterInfo(): Promise<PersistentSettingsSchema["updater"]> {
    const info = await this.get<PersistentSettingsSchema["updater"]>("updater");
    return info || defaultSettings.updater;
  }

  async setUpdaterInfo(
    info: Partial<PersistentSettingsSchema["updater"]>,
  ): Promise<void> {
    const current = await this.getUpdaterInfo();
    await this.set("updater", { ...current, ...info });
  }

  /**
   * Attendance Cooldowns
   */
  async getCooldowns(): Promise<Record<string, unknown>> {
    const cooldowns = await this.get<Record<string, unknown>>(
      "attendanceCooldowns",
    );
    return cooldowns || {};
  }

  async setCooldowns(cooldowns: Record<string, unknown>): Promise<void> {
    await this.set("attendanceCooldowns", cooldowns);
  }
}

export const persistentSettings = new PersistentSettingsService();
