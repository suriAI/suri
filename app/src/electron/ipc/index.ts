import { registerBackendHandlers } from "./backendHandlers.js";
import { registerStoreHandlers } from "./storeHandlers.js";
import { registerSyncHandlers } from "./syncHandlers.js";
import { registerSystemHandlers } from "./systemHandlers.js";
import { registerUpdaterHandlers } from "./updaterHandlers.js";
import { registerWindowHandlers } from "./windowHandlers.js";
import { registerAssetHandlers } from "./assetHandlers.js";

export function registerAllHandlers() {
  registerBackendHandlers();
  registerStoreHandlers();
  registerSyncHandlers();
  registerSystemHandlers();
  registerUpdaterHandlers();
  registerWindowHandlers();
  registerAssetHandlers();
}
