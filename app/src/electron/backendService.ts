/**
 * Backend Service Manager for PyInstaller-built Suri Backend
 * Handles process lifecycle, health checks, and communication
 */

import { spawn, exec, execSync, ChildProcess } from "child_process";
import { app } from "electron";
import path from "path";
import fs from "fs";
import { promisify } from "util";
import { fileURLToPath } from "node:url";
import isDev from "./util.js";

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

export interface ModelInfo {
  model_name?: string;
  model_path: string;
  input_size: number[] | [number, number];
  conf_threshold?: number;
  nms_threshold?: number;
  top_k?: number;
  backend_id?: number;
  target_id?: number;
  embedding_dimension?: number;
  similarity_threshold?: number;
  providers?: string[];
  description?: string;
  version?: string;
  supported_formats?: string[];
}

export interface ModelEntry {
  available: boolean;
  info?: ModelInfo;
}

export interface ModelsResponse {
  models: {
    face_detector?: ModelEntry;
    liveness_detector?: ModelEntry;
    face_recognizer?: ModelEntry;
  };
}

export interface DetectionOptions {
  model_type?: string;
  confidence_threshold?: number;
  nms_threshold?: number;
}

export interface FaceRecognitionResponse {
  success: boolean;
  person_id?: string;
  similarity?: number;
  error?: string;
}

export interface DetectionResponse {
  faces: Array<{
    bbox: [number, number, number, number];
    confidence: number;
    landmarks_5?: number[][];
  }>;
  model_used: string;
}

export class BackendService {
  private process: ChildProcess | null = null;
  private config: BackendConfig;
  private status: BackendStatus;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private startupPromise: Promise<void> | null = null;

  constructor(config: Partial<BackendConfig> = {}) {
    this.config = {
      port: 8700,
      host: "127.0.0.1",
      timeout: 30000,
      maxRetries: 3,
      healthCheckInterval: 10000,
      ...config,
    };

    this.status = {
      isRunning: false,
      port: this.config.port,
    };
  }

  /**
   * Get the path to the backend executable
   */
  private getBackendExecutablePath(): string {
    if (isDev()) {
      // In development, use Python script
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const serverDir = path.join(currentDir, "..", "..", "..", "server");
      return path.join(serverDir, "run.py");
    } else {
      // In production, use PyInstaller executable
      const platform = process.platform;
      const executableName = platform === "win32" ? "server.exe" : "server";

      // Try multiple possible locations
      const possiblePaths = [
        path.join(process.resourcesPath, "server", executableName),
        path.join(process.resourcesPath, executableName),
        path.join(app.getAppPath(), "server", executableName),
        path.join(app.getAppPath(), "resources", "server", executableName),
      ];

      for (const execPath of possiblePaths) {
        if (fs.existsSync(execPath)) {
          return execPath;
        }
      }

      throw new Error(
        `Server executable not found. Searched paths: ${possiblePaths.join(", ")}`,
      );
    }
  }

  /**
   * Find Python executable path (works with or without virtual environment)
   */
  private async findPythonExecutable(): Promise<string> {
    const possiblePaths = [
      // Try virtual environment first (if it exists)
      path.join(process.cwd(), "..", "venv", "Scripts", "python.exe"),
      path.join(process.cwd(), "..", "venv", "bin", "python"),
      path.join(process.cwd(), "venv", "Scripts", "python.exe"),
      path.join(process.cwd(), "venv", "bin", "python"),
      // Try system Python
      "python",
      "python3",
      "python.exe",
      // Try common Python installations
      "C:\\Python39\\python.exe",
      "C:\\Python310\\python.exe",
      "C:\\Python311\\python.exe",
      "C:\\Python312\\python.exe",
      "/usr/bin/python3",
      "/usr/local/bin/python3",
      "/opt/homebrew/bin/python3",
    ];

    for (const pythonPath of possiblePaths) {
      try {
        // Check if the path exists and is executable
        if (fs.existsSync(pythonPath)) {
          // Test if it's actually Python by checking version
          const result = await execAsync(`"${pythonPath}" --version`);
          if (result.stdout.includes("Python")) {
            return pythonPath;
          }
        } else if (!pythonPath.includes("\\") && !pythonPath.includes("/")) {
          // For system commands like 'python' or 'python3', test directly
          try {
            const result = await execAsync(`${pythonPath} --version`);
            if (result.stdout.includes("Python")) {
              return pythonPath;
            }
          } catch {
            // Continue to next option
          }
        }
      } catch {
        // Continue to next option
      }
    }

    throw new Error(
      "Python executable not found. Please ensure Python is installed and accessible.",
    );
  }

  /**
   * Check if backend is responding to health checks
   */
  private async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(
        `http://${this.config.host}:${this.config.port}/`,
        {
          method: "GET",
          signal: AbortSignal.timeout(5000),
        },
      );

      const isHealthy = response.ok;
      if (isHealthy) {
        this.status.lastHealthCheck = new Date();
      }

      return isHealthy;
    } catch {
      return false;
    }
  }

  /**
   * Start the backend process
   */
  async start(): Promise<void> {
    if (this.startupPromise) {
      return this.startupPromise;
    }

    this.startupPromise = this._start();
    return this.startupPromise;
  }

  private async _start(): Promise<void> {
    if (this.status.isRunning) {
      return;
    }

    // CRITICAL: Kill any existing backend processes before starting new one
    // This prevents orphaned processes from previous runs
    this.killAllBackendProcesses();

    try {
      const executablePath = this.getBackendExecutablePath();

      // Prepare command and arguments
      let command: string;
      let args: string[];

      if (isDev()) {
        // Development mode - find Python executable (with or without venv)
        command = await this.findPythonExecutable();
        args = [
          executablePath,
          "--port",
          this.config.port.toString(),
          "--host",
          this.config.host,
        ];
      } else {
        // Production mode - use PyInstaller executable
        command = executablePath;
        args = [
          "--port",
          this.config.port.toString(),
          "--host",
          this.config.host,
        ];
      }

      // Prepare environment
      const env = {
        ...process.env,
        ENVIRONMENT: isDev() ? "development" : "production",
        SURI_DATA_DIR: app.getPath("userData"),
      };

      // Spawn the process
      this.process = spawn(command, args, {
        stdio: "pipe", // Capture stdout/stderr to avoid showing console
        detached: false,
        windowsHide: true, // Hide console window on Windows
        env,
      });

      // Optionally log backend output for debugging
      if (this.process.stdout) {
        this.process.stdout.on("data", (data) => {
          // Only log in development mode
          if (isDev()) {
            console.log(`[Backend] ${data.toString().trim()}`);
          }
        });
      }
      if (this.process.stderr) {
        this.process.stderr.on("data", (data) => {
          const msg = data.toString().trim();
          const looksLikeError =
            /(\bERROR\b|\bCRITICAL\b|Traceback|Exception)/.test(msg);
          if (looksLikeError) {
            console.error(`[Backend Error] ${msg}`);
          } else {
            console.log(`[Backend] ${msg}`);
          }
        });
      }

      // Set up process event handlers (for error and exit events only)
      this.setupProcessHandlers();

      // Wait for the backend to be ready
      await this.waitForBackendReady();

      this.status.isRunning = true;
      this.status.pid = this.process.pid;
      this.status.startTime = new Date();
      this.status.error = undefined;

      // Start health monitoring
      this.startHealthMonitoring();
    } catch (error) {
      console.error(`[BackendService] Failed to start backend: ${error}`);
      this.status.error =
        error instanceof Error ? error.message : String(error);
      this.cleanup();
      throw error;
    } finally {
      this.startupPromise = null;
    }
  }

  /**
   * Set up process event handlers
   */
  private setupProcessHandlers(): void {
    if (!this.process) return;

    // With stdio: "inherit", logs go directly to terminal automatically
    // We only need to handle process lifecycle events
    this.process.on("error", (error) => {
      console.error(`[BackendService] Process error: ${error.message}`);
      this.status.error = error.message;
      this.status.isRunning = false;
    });

    this.process.on("exit", (code, signal) => {
      console.log(
        `[BackendService] Process exited with code ${code}${signal ? ` and signal ${signal}` : ""}`,
      );
      this.status.isRunning = false;
      // Only cleanup if process wasn't already cleaned up by killSync()
      // When killed externally, killSync() handles cleanup, so this is redundant
      if (this.process !== null) {
        this.cleanup();
      }
    });
  }

  /**
   * Wait for backend to be ready by checking health endpoint
   */
  private async waitForBackendReady(): Promise<void> {
    const startTime = Date.now();
    const timeout = this.config.timeout;

    // Check immediately first (no delay)
    if (await this.healthCheck()) {
      return;
    }

    while (Date.now() - startTime < timeout) {
      await sleep(100);
      if (await this.healthCheck()) {
        return;
      }
    }

    throw new Error(`Backend failed to start within ${timeout}ms`);
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(async () => {
      if (this.status.isRunning) {
        const isHealthy = await this.healthCheck();
        if (!isHealthy) {
          this.status.isRunning = false;
        }
      }
    }, this.config.healthCheckInterval);
  }

  /**
   * Stop the backend process (async version)
   * Kills ALL server processes (bootloader + Python child)
   */
  async stop(): Promise<void> {
    try {
      if (process.platform === "win32") {
        // Windows: Kill ALL server.exe processes (multiple attempts)
        for (let i = 0; i < 3; i++) {
          try {
            await execAsync("taskkill /F /IM server.exe /T");
            await sleep(50);
          } catch (error: unknown) {
            // Process not found = all killed
            if (
              error instanceof Error &&
              (error.message?.includes("not found") ||
                (error as { code?: number }).code === 128)
            ) {
              break;
            }
          }
        }
      } else {
        // Unix/Mac: Kill all server processes with verification
        for (let i = 0; i < 3; i++) {
          try {
            // Check if processes exist
            const checkResult = await execAsync("pgrep -f server");

            // If empty, all killed
            if (!checkResult.stdout.trim()) {
              break;
            }

            // Kill all
            await execAsync("pkill -9 server");
            await sleep(50);
          } catch {
            // pgrep error = no processes = success
            break;
          }
        }
      }
    } catch (error: unknown) {
      // Process not found is OK
      if (!(error instanceof Error) || !error.message?.includes("not found")) {
        console.error("[BackendService] Error stopping:", error);
      }
    }

    // Clean up
    this.process = null;
    this.status.isRunning = false;
    this.status.pid = undefined;
    this.cleanup();
  }

  /**
   * Kill all backend processes by name (cleanup orphaned processes)
   * AGGRESSIVE: Keeps retrying until NO processes remain
   */
  private killAllBackendProcesses(): void {
    if (process.platform !== "win32") {
      // Unix/Mac: Kill all server processes with verification
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        attempts++;

        try {
          // Check if any processes exist
          const checkResult = execSync("pgrep -f server", {
            encoding: "utf8",
            timeout: 2000,
          });

          // If no PIDs returned, we're done
          if (!checkResult.trim()) {
            return;
          }

          // Processes exist - kill them
          execSync("pkill -9 server", { stdio: "ignore", timeout: 2000 });

          // Wait for processes to die
          const start = Date.now();
          while (Date.now() - start < 300) {
            // Busy wait for process termination
          }
        } catch {
          // pgrep returns non-zero if no matches = all killed = success
          return;
        }
      }

      return;
    }

    // Windows: AGGRESSIVE cleanup with verification
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      attempts++;

      try {
        // Check if any processes exist
        const checkResult = execSync(
          'tasklist /FI "IMAGENAME eq server.exe" /NH',
          {
            encoding: "utf8",
            timeout: 2000,
          },
        );

        // If no processes found, we're done
        if (
          checkResult.includes("INFO: No tasks") ||
          !checkResult.includes("server.exe")
        ) {
          return;
        }

        // Processes exist - kill them ALL
        // Strategy 1: Kill by image name
        try {
          execSync("taskkill /F /IM server.exe /T", {
            stdio: "ignore",
            timeout: 2000,
          });
        } catch {
          // Continue
        }

        // Strategy 2: Kill each PID individually
        try {
          const pidsOutput = execSync(
            'tasklist /FI "IMAGENAME eq server.exe" /NH /FO CSV',
            {
              encoding: "utf8",
              timeout: 2000,
            },
          );

          const lines = pidsOutput.split("\n");
          for (const line of lines) {
            if (line.includes("server.exe")) {
              const match = line.match(/"(\d+)"/);
              if (match && match[1]) {
                const pid = match[1];
                try {
                  execSync(`taskkill /F /PID ${pid} /T`, {
                    stdio: "ignore",
                    timeout: 1000,
                  });
                } catch {
                  // OK
                }
              }
            }
          }
        } catch {
          // OK
        }

        // Wait 300ms for processes to die
        const start = Date.now();
        while (Date.now() - start < 300) {
          // Busy wait for process termination
        }
      } catch (error: unknown) {
        // Error checking or killing - might mean processes are gone
        if (error instanceof Error && error.message?.includes("not found")) {
          return;
        }
      }
    }
  }

  /**
   * Synchronous kill - for app exit cleanup
   * AGGRESSIVE: Keeps killing until NO processes remain
   */
  killSync(): void {
    if (process.platform !== "win32") {
      // Unix/Mac: Kill all with verification
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        attempts++;

        try {
          // Check if any processes exist
          const checkResult = execSync("pgrep -f server", {
            encoding: "utf8",
            timeout: 2000,
          });

          // No processes found = success
          if (!checkResult.trim()) {
            break;
          }

          // Processes still exist - kill them
          execSync("pkill -9 server", { stdio: "ignore", timeout: 2000 });

          // Wait for processes to die
          const start = Date.now();
          while (Date.now() - start < 300) {
            // Busy wait for process termination
          }
        } catch {
          // pgrep error = no processes found = success
          break;
        }
      }

      // Cleanup state (process.on("exit") may not fire when killed externally)
      this.process = null;
      this.status.isRunning = false;
      this.status.pid = undefined;
      this.cleanup();
      return;
    }

    // Windows: AGGRESSIVE kill with verification
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      attempts++;

      try {
        // Check if any backend processes still exist
        const checkResult = execSync(
          'tasklist /FI "IMAGENAME eq server.exe" /NH',
          {
            encoding: "utf8",
            timeout: 2000,
          },
        );

        // No processes found = success
        if (
          checkResult.includes("INFO: No tasks") ||
          !checkResult.includes("server.exe")
        ) {
          break;
        }

        // Processes still exist - kill them
        // Strategy 1: Kill by image name with tree
        try {
          execSync("taskkill /F /IM server.exe /T", {
            stdio: "ignore",
            timeout: 2000,
          });
        } catch {
          // Continue to strategy 2
        }

        // Strategy 2: Find all PIDs and kill each individually
        try {
          const pidsOutput = execSync(
            'tasklist /FI "IMAGENAME eq server.exe" /NH /FO CSV',
            {
              encoding: "utf8",
              timeout: 2000,
            },
          );

          // Parse PIDs from CSV output
          const lines = pidsOutput.split("\n");
          for (const line of lines) {
            if (line.includes("server.exe")) {
              const match = line.match(/"(\d+)"/);
              if (match && match[1]) {
                const pid = match[1];
                try {
                  execSync(`taskkill /F /PID ${pid} /T`, {
                    stdio: "ignore",
                    timeout: 1000,
                  });
                } catch {
                  // OK if already dead
                }
              }
            }
          }
        } catch {
          // OK if can't parse
        }

        // Wait for processes to die
        const start = Date.now();
        while (Date.now() - start < 300) {
          // Busy wait for process termination
        }
      } catch (error: unknown) {
        // Errors might mean processes are gone
        if (error instanceof Error && error.message?.includes("not found")) {
          break;
        }
      }
    }

    // Cleanup state (process.on("exit") may not fire reliably when killed externally)
    this.process = null;
    this.status.isRunning = false;
    this.status.pid = undefined;
    this.cleanup();
  }

  /**
   * Restart the backend process
   */
  async restart(): Promise<void> {
    await this.stop();
    await sleep(100);
    await this.start();
  }

  /**
   * Get current backend status
   */
  getStatus(): BackendStatus {
    return { ...this.status };
  }

  /**
   * Check if backend is available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.status.isRunning) {
      return false;
    }
    return await this.healthCheck();
  }

  /**
   * Get backend URL
   */
  getUrl(): string {
    return `http://${this.config.host}:${this.config.port}`;
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Check backend availability for IPC
   */
  async checkAvailability(): Promise<{
    available: boolean;
    status?: number;
    error?: string;
  }> {
    try {
      if (!this.status.isRunning) {
        return { available: false, error: "Backend service not started" };
      }

      const response = await fetch(`${this.getUrl()}/`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      return { available: response.ok, status: response.status };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if backend is fully ready for face recognition (models loaded)
   */
  async checkReadiness(): Promise<{
    ready: boolean;
    modelsLoaded: boolean;
    error?: string;
  }> {
    try {
      if (!this.status.isRunning) {
        return {
          ready: false,
          modelsLoaded: false,
          error: "Backend service not started",
        };
      }

      // First check basic availability
      const healthResponse = await fetch(`${this.getUrl()}/`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      if (!healthResponse.ok) {
        return {
          ready: false,
          modelsLoaded: false,
          error: "Backend health check failed",
        };
      }

      // Then check if models are loaded and ready
      const modelsResponse = await fetch(`${this.getUrl()}/models`, {
        method: "GET",
        signal: AbortSignal.timeout(10000),
      });

      if (!modelsResponse.ok) {
        return {
          ready: false,
          modelsLoaded: false,
          error: "Models endpoint not available",
        };
      }

      const modelsData: ModelsResponse = await modelsResponse.json();

      // Check if critical models for face recognition are available
      const faceDetectorAvailable =
        modelsData.models.face_detector?.available || false;
      const faceRecognizerAvailable =
        modelsData.models.face_recognizer?.available || false;

      const modelsLoaded = faceDetectorAvailable && faceRecognizerAvailable;

      return {
        ready: modelsLoaded,
        modelsLoaded,
        error: modelsLoaded
          ? undefined
          : "Face recognition models not fully loaded",
      };
    } catch (error) {
      return {
        ready: false,
        modelsLoaded: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get available models from backend
   */
  async getModels(): Promise<ModelsResponse> {
    const response = await fetch(`${this.getUrl()}/models`, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Detect faces using backend API
   */
  async detectFaces(
    imageBase64: string,
    options: DetectionOptions = {},
  ): Promise<DetectionResponse> {
    const request = {
      image: imageBase64,
      model_type: options.model_type || "face_detector",
      confidence_threshold: options.confidence_threshold || 0.5,
      nms_threshold: options.nms_threshold || 0.3,
    };

    const response = await fetch(`${this.getUrl()}/detect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Recognize a face using backend API
   */
  async recognizeFace(
    imageBase64: string,
    bbox: number[],
    _groupId?: string,
    landmarks_5?: number[][],
    enableLivenessDetection: boolean = true,
  ): Promise<FaceRecognitionResponse> {
    const request = {
      image: imageBase64,
      bbox: bbox,
      landmarks_5: landmarks_5,
      enable_liveness_detection: enableLivenessDetection,
    };

    const response = await fetch(`${this.getUrl()}/face/recognize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }
}

// Singleton instance
export const backendService = new BackendService();
