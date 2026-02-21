import { ipcMain } from "electron";
import path from "path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import isDev from "../util.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function registerAssetHandlers() {
  ipcMain.handle("assets:list-recognition-sounds", async () => {
    const soundsDir = isDev()
      ? path.join(__dirname, "../../../public/assets/sounds")
      : path.join(__dirname, "../../../dist-react/assets/sounds");

    try {
      const entries = await fs.readdir(soundsDir, { withFileTypes: true });
      const allowedExt = new Set([".mp3", ".wav", ".ogg", ".m4a"]);

      const files = entries
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .filter((name) => allowedExt.has(path.extname(name).toLowerCase()))
        .sort((a, b) => a.localeCompare(b));

      return files.map((fileName) => {
        const url = `./assets/sounds/${encodeURIComponent(fileName)}`;
        return { fileName, url };
      });
    } catch {
      return [];
    }
  });
}
