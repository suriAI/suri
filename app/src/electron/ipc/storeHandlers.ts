import { ipcMain } from "electron";
import { persistentStore } from "../persistentStore.js";

export function registerStoreHandlers() {
  ipcMain.handle("store:get", (_event, key: string) => {
    return persistentStore.get(key);
  });

  ipcMain.handle("store:set", (_event, key: string, value: unknown) => {
    persistentStore.set(key, value);
    return true;
  });

  ipcMain.handle("store:delete", (_event, key: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (persistentStore.delete as any)(key);
    return true;
  });

  ipcMain.handle("store:getAll", () => {
    return persistentStore.store;
  });

  ipcMain.handle("store:reset", () => {
    persistentStore.clear();
    return true;
  });
}
