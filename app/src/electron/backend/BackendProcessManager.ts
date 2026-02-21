import { spawn, exec, execSync, ChildProcess } from "child_process";
import { app } from "electron";
import path from "path";
import fs from "fs";
import { promisify } from "util";
import { fileURLToPath } from "node:url";
import isDev from "../util.js";

const sleep = promisify(setTimeout);
const execAsync = promisify(exec);

export interface BackendConfig {
  port: number;
  host: string;
  timeout: number;
  maxRetries: number;
  healthCheckInterval: number;
}

export interface BackendStatus {
  isRunning: boolean;
  port: number;
  pid?: number;
  startTime?: Date;
  lastHealthCheck?: Date;
  error?: string;
}

export class BackendProcessManager {
  private process: ChildProcess | null = null;
  private config: BackendConfig;
  private status: BackendStatus;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private startupPromise: Promise<void> | null = null;

  constructor(config: BackendConfig, status: BackendStatus) {
    this.config = config;
    this.status = status;
  }

  async start(): Promise<void> {
    if (this.startupPromise) return this.startupPromise;
    this.startupPromise = this._start();
    return this.startupPromise;
  }

  private async _start(): Promise<void> {
    if (this.status.isRunning) return;

    this.killAllBackendProcesses();

    try {
      const executablePath = this.getBackendExecutablePath();
      let command: string;
      let args: string[];

      if (isDev()) {
        command = await this.findPythonExecutable();
        args = [
          executablePath,
          "--port",
          this.config.port.toString(),
          "--host",
          this.config.host,
        ];
      } else {
        command = executablePath;
        args = [
          "--port",
          this.config.port.toString(),
          "--host",
          this.config.host,
        ];
      }

      const env = {
        ...process.env,
        ENVIRONMENT: isDev() ? "development" : "production",
        SURI_DATA_DIR: app.getPath("userData"),
      };

      this.process = spawn(command, args, {
        stdio: "pipe",
        detached: false,
        windowsHide: true,
        env,
      });

      const logFile = path.join(app.getPath("userData"), "backend-startup.log");
      fs.writeFileSync(
        logFile,
        `[${new Date().toISOString()}] Backend starting...\n`,
      );
      const logStream = fs.createWriteStream(logFile, { flags: "a" });

      this.process.stdout?.on("data", (data) => {
        const str = data.toString();
        logStream.write(`[STDOUT] ${str}`);
        if (isDev()) console.log(`[Backend] ${str.trim()}`);
      });

      this.process.stderr?.on("data", (data) => {
        const msg = data.toString();
        logStream.write(`[STDERR] ${msg}`);
        if (/(\bERROR\b|\bCRITICAL\b|Traceback|Exception)/.test(msg)) {
          console.error(`[Backend Error] ${msg.trim()}`);
        } else {
          console.log(`[Backend] ${msg.trim()}`);
        }
      });

      this.setupProcessHandlers();
      await this.waitForBackendReady();

      this.status.isRunning = true;
      this.status.pid = this.process.pid;
      this.status.startTime = new Date();
      this.status.error = undefined;

      this.startHealthMonitoring();
    } catch (error) {
      console.error(`[BackendProcessManager] Failed to start: ${error}`);
      this.status.error =
        error instanceof Error ? error.message : String(error);
      this.cleanup();
      throw error;
    } finally {
      this.startupPromise = null;
    }
  }

  private setupProcessHandlers(): void {
    if (!this.process) return;

    this.process.on("error", (error) => {
      console.error(`[BackendProcessManager] Process error: ${error.message}`);
      this.status.error = error.message;
      this.status.isRunning = false;
    });

    this.process.on("exit", (code, signal) => {
      console.log(
        `[BackendProcessManager] Process exited with code ${code}${signal ? ` and signal ${signal}` : ""}`,
      );
      this.status.isRunning = false;
      if (this.process !== null) this.cleanup();
    });
  }

  private async waitForBackendReady(): Promise<void> {
    const startTime = Date.now();
    const safetyTimeout = this.config.timeout;

    while (Date.now() - startTime < safetyTimeout) {
      if (
        this.process?.exitCode !== null &&
        this.process?.exitCode !== undefined
      ) {
        throw new Error(
          `Backend process exited unexpectedly with code ${this.process.exitCode}`,
        );
      }

      if (await this.healthCheck()) return;
      await sleep(250);
    }

    throw new Error(
      `Backend failed to start within safety timeout (${safetyTimeout}ms)`,
    );
  }

  private async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(
        `http://${this.config.host}:${this.config.port}/`,
        {
          method: "GET",
          signal: AbortSignal.timeout(5000),
        },
      );

      if (response.ok) {
        this.status.lastHealthCheck = new Date();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private startHealthMonitoring(): void {
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);

    this.healthCheckTimer = setInterval(async () => {
      if (this.status.isRunning) {
        if (!(await this.healthCheck())) {
          this.status.isRunning = false;
        }
      }
    }, this.config.healthCheckInterval);
  }

  async stop(): Promise<void> {
    try {
      if (process.platform === "win32") {
        for (let i = 0; i < 3; i++) {
          try {
            await execAsync("taskkill /F /IM server.exe /T");
            await sleep(50);
          } catch (error: unknown) {
            const err = error as { message?: string; code?: number };
            if (err?.message?.includes("not found") || err?.code === 128) break;
          }
        }
      } else {
        for (let i = 0; i < 3; i++) {
          try {
            const checkResult = await execAsync("pgrep -f server");
            if (!checkResult.stdout.trim()) break;
            await execAsync("pkill -9 server");
            await sleep(50);
          } catch {
            break;
          }
        }
      }
    } catch (error: unknown) {
      const err = error as { message?: string };
      if (!err?.message?.includes("not found")) {
        console.error("[BackendProcessManager] Error stopping:", error);
      }
    }

    this.process = null;
    this.status.isRunning = false;
    this.status.pid = undefined;
    this.cleanup();
  }

  killSync(): void {
    this.killAllBackendProcesses();
    this.process = null;
    this.status.isRunning = false;
    this.status.pid = undefined;
    this.cleanup();
  }

  private killAllBackendProcesses(): void {
    const isWin = process.platform === "win32";
    const maxAttempts = isWin ? 5 : 3;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        if (isWin) {
          const checkResult = execSync(
            'tasklist /FI "IMAGENAME eq server.exe" /NH',
            { encoding: "utf8", timeout: 2000 },
          );
          if (
            checkResult.includes("INFO: No tasks") ||
            !checkResult.includes("server.exe")
          )
            return;
          try {
            execSync("taskkill /F /IM server.exe /T", {
              stdio: "ignore",
              timeout: 2000,
            });
          } catch {
            /* silent */
          }
          try {
            const pidsOutput = execSync(
              'tasklist /FI "IMAGENAME eq server.exe" /NH /FO CSV',
              { encoding: "utf8", timeout: 2000 },
            );
            pidsOutput.split("\n").forEach((line) => {
              if (line.includes("server.exe")) {
                const match = line.match(/"(\d+)"/);
                if (match?.[1]) {
                  try {
                    execSync(`taskkill /F /PID ${match[1]} /T`, {
                      stdio: "ignore",
                      timeout: 1000,
                    });
                  } catch {
                    /* silent */
                  }
                }
              }
            });
          } catch {
            /* silent */
          }
        } else {
          try {
            const checkResult = execSync("pgrep -f server", {
              encoding: "utf8",
              timeout: 2000,
            });
            if (!checkResult.trim()) return;
            execSync("pkill -9 server", { stdio: "ignore", timeout: 2000 });
          } catch {
            return;
          }
        }
        const start = Date.now();
        while (Date.now() - start < 300) {
          /* wait */
        }
      } catch (error: unknown) {
        const err = error as { message?: string };
        if (err?.message?.includes("not found")) return;
      }
    }
  }

  private cleanup(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  private getBackendExecutablePath(): string {
    if (isDev()) {
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      return path.join(currentDir, "..", "..", "..", "..", "server", "run.py");
    }

    const platform = process.platform;
    const executableName = platform === "win32" ? "server.exe" : "server";
    const possiblePaths = [
      path.join(process.resourcesPath, "server", executableName),
      path.join(process.resourcesPath, executableName),
      path.join(app.getAppPath(), "server", executableName),
      path.join(app.getAppPath(), "resources", "server", executableName),
    ];

    for (const execPath of possiblePaths) {
      if (fs.existsSync(execPath)) return execPath;
    }

    throw new Error(
      `Server executable not found. Searched paths: ${possiblePaths.join(", ")}`,
    );
  }

  private async findPythonExecutable(): Promise<string> {
    const possiblePaths = [
      path.join(process.cwd(), "..", "venv", "Scripts", "python.exe"),
      path.join(process.cwd(), "..", "venv", "bin", "python"),
      path.join(process.cwd(), "venv", "Scripts", "python.exe"),
      path.join(process.cwd(), "venv", "bin", "python"),
      "python",
      "python3",
      "python.exe",
      "C:\\Python39\\python.exe",
      "C:\\Python310\\python.exe",
      "C:\\Python311\\python.exe",
      "C:\\Python312\\python.exe",
      "/usr/bin/python3",
      "/usr/local/bin/python3",
      "/opt/homebrew/bin/python3",
    ];

    for (const p of possiblePaths) {
      try {
        if (fs.existsSync(p)) {
          const result = await execAsync(`"${p}" --version`);
          if (result.stdout.includes("Python")) return p;
        } else if (!p.includes("\\") && !p.includes("/")) {
          try {
            const result = await execAsync(`${p} --version`);
            if (result.stdout.includes("Python")) return p;
          } catch {
            /* silent */
          }
        }
      } catch {
        /* silent */
      }
    }

    throw new Error(
      "Python executable not found. Please ensure Python is installed and accessible.",
    );
  }

  getUrl(): string {
    return `http://${this.config.host}:${this.config.port}`;
  }

  getStatus(): BackendStatus {
    return { ...this.status };
  }
}
