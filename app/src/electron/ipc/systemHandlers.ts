import { ipcMain } from "electron";

export function registerSystemHandlers() {
  ipcMain.handle("system:get-stats", () => {
    const cpu = process.getCPUUsage();
    const memory = process.getSystemMemoryInfo();

    return {
      cpu: cpu.percentCPUUsage,
      memory: {
        total: memory.total,
        free: memory.free,
        appUsage: process.memoryUsage().rss,
      },
    };
  });
}
