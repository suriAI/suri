/**
 * Backend Service Manager for PyInstaller-built Suri Backend
 * Handles process lifecycle, health checks, and communication
 */

import { spawn, ChildProcess } from 'child_process';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import isDev from './util.js';

const sleep = promisify(setTimeout);

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

export class BackendService {
  private process: ChildProcess | null = null;
  private config: BackendConfig;
  private status: BackendStatus;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private startupPromise: Promise<void> | null = null;

  constructor(config: Partial<BackendConfig> = {}) {
    this.config = {
      port: 8700,  // 🍔 Jollibee port!
      host: '127.0.0.1',
      timeout: 30000,
      maxRetries: 3,
      healthCheckInterval: 10000,
      ...config
    };

    this.status = {
      isRunning: false,
      port: this.config.port
    };
  }

  /**
   * Get the path to the backend executable
   */
  private getBackendExecutablePath(): string {
    if (isDev()) {
      // In development, use Python script
      const backendDir = path.join(__dirname, '..', '..', '..', 'backend');
      return path.join(backendDir, 'run.py');
    } else {
      // In production, use PyInstaller executable
      const platform = process.platform;
      const executableName = platform === 'win32' ? 'suri-backend.exe' : 'suri-backend';
      
      // Try multiple possible locations
      const possiblePaths = [
        path.join(process.resourcesPath, 'backend', executableName),
        path.join(process.resourcesPath, executableName),
        path.join(app.getAppPath(), 'backend', executableName),
        path.join(app.getAppPath(), 'resources', 'backend', executableName),
      ];

      for (const execPath of possiblePaths) {
        if (fs.existsSync(execPath)) {
          return execPath;
        }
      }

      throw new Error(`Backend executable not found. Searched paths: ${possiblePaths.join(', ')}`);
    }
  }

  /**
   * Check if backend is responding to health checks
   */
  private async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`http://${this.config.host}:${this.config.port}/`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      
      const isHealthy = response.ok;
      if (isHealthy) {
        this.status.lastHealthCheck = new Date();
      }
      
      return isHealthy;
    } catch (error) {
      console.warn('[Backend Health Check] Failed:', error);
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
      console.log('[Backend Service] Already running');
      return;
    }

    console.log('[Backend Service] Starting backend...');

    try {
      const executablePath = this.getBackendExecutablePath();
      console.log('[Backend Service] Executable path:', executablePath);

      // Prepare command and arguments
      let command: string;
      let args: string[];

      if (isDev()) {
        // Development mode - use Python
        command = 'python';
        args = [executablePath, '--port', this.config.port.toString(), '--host', this.config.host];
      } else {
        // Production mode - use PyInstaller executable
        command = executablePath;
        args = ['--port', this.config.port.toString(), '--host', this.config.host];
      }

      // Spawn the process
      this.process = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false,
        windowsHide: true, // Hide console window on Windows
      });

      // Set up process event handlers
      this.setupProcessHandlers();

      // Wait for the backend to be ready
      await this.waitForBackendReady();

      this.status.isRunning = true;
      this.status.pid = this.process.pid;
      this.status.startTime = new Date();
      this.status.error = undefined;

      // Start health monitoring
      this.startHealthMonitoring();

      console.log(`[Backend Service] Started successfully on ${this.config.host}:${this.config.port} (PID: ${this.process.pid})`);

    } catch (error) {
      this.status.error = error instanceof Error ? error.message : String(error);
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

    this.process.stdout?.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log('[Backend stdout]:', output);
      }
    });

    this.process.stderr?.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.error('[Backend stderr]:', output);
      }
    });

    this.process.on('error', (error) => {
      console.error('[Backend Process Error]:', error);
      this.status.error = error.message;
      this.status.isRunning = false;
    });

    this.process.on('exit', (code, signal) => {
      console.log(`[Backend Process] Exited with code ${code}, signal ${signal}`);
      this.status.isRunning = false;
      this.cleanup();
    });
  }

  /**
   * Wait for backend to be ready by checking health endpoint
   */
  private async waitForBackendReady(): Promise<void> {
    const startTime = Date.now();
    const timeout = this.config.timeout;

    while (Date.now() - startTime < timeout) {
      if (await this.healthCheck()) {
        return;
      }
      await sleep(1000);
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
          console.warn('[Backend Service] Health check failed');
          this.status.isRunning = false;
        }
      }
    }, this.config.healthCheckInterval);
  }

  /**
   * Stop the backend process
   */
  async stop(): Promise<void> {
    console.log('[Backend Service] Stopping backend...');

    this.cleanup();

    if (this.process) {
      // Try graceful shutdown first
      this.process.kill('SIGTERM');

      // Wait a bit for graceful shutdown
      await sleep(2000);

      // Force kill if still running
      if (this.process && !this.process.killed) {
        this.process.kill('SIGKILL');
      }

      this.process = null;
    }

    this.status.isRunning = false;
    this.status.pid = undefined;
    this.status.error = undefined;

    console.log('[Backend Service] Stopped');
  }

  /**
   * Restart the backend process
   */
  async restart(): Promise<void> {
    console.log('[Backend Service] Restarting backend...');
    await this.stop();
    await sleep(1000);
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
  async checkAvailability(): Promise<{ available: boolean; status?: number; error?: string }> {
    try {
      if (!this.status.isRunning) {
        return { available: false, error: 'Backend service not started' };
      }

      const response = await fetch(`${this.getUrl()}/`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });

      return { available: response.ok, status: response.status };
    } catch (error) {
      return { 
        available: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * Get available models from backend
   */
  async getModels(): Promise<any> {
    const response = await fetch(`${this.getUrl()}/models`, {
      method: 'GET',
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Detect faces using backend API
   */
  async detectFaces(imageBase64: string, options: any = {}): Promise<any> {
    const request = {
      image: imageBase64,
      model_type: options.model_type || 'yunet',
      confidence_threshold: options.confidence_threshold || 0.5,
      nms_threshold: options.nms_threshold || 0.3
    };

    const response = await fetch(`${this.getUrl()}/detect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Clean up on app exit
   */
  async dispose(): Promise<void> {
    await this.stop();
  }
}

// Singleton instance
export const backendService = new BackendService();