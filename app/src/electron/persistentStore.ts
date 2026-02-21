import Store from "electron-store";
import {
  type PersistentSettingsSchema,
  defaultSettings,
} from "../services/persistentSettingsDefaults.js";

interface TypedStore<T> {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  clear(): void;
  store: T;
}

export const persistentStore: TypedStore<PersistentSettingsSchema> =
  new Store<PersistentSettingsSchema>({
    name: "config",
    defaults: defaultSettings,
  }) as unknown as TypedStore<PersistentSettingsSchema>;
