/**
 * SqliteFaceLogService - React frontend interface to SQLite database via Electron IPC
 * 
 * This service provides a clean interface for the React frontend to interact with
 * the SQLite database running in the Electron main process via IPC communication.
 */

// Type declaration for window.electronAPI
declare global {
  interface Window {
    electronAPI?: {
      logDetection: (detection: FaceLogEntry) => Promise<string>;
      getRecentLogs: (limit?: number) => Promise<FaceLogEntry[]>;
      getTodayStats: () => Promise<TodayStats>;
      exportData: (filePath: string) => Promise<boolean>;
      clearOldData: (daysToKeep: number) => Promise<number>;
    };
  }
}

export interface FaceLogEntry {
  id?: string;
  timestamp: string;
  personId: string | null;
  confidence: number;
  bbox: [number, number, number, number];
  similarity?: number;
  mode: 'auto' | 'manual';
}

export interface TodayStats {
  totalDetections: number;
  uniquePersons: number;
  firstDetection: string | null;
  lastDetection: string | null;
}

export class SqliteFaceLogService {
  private static instance: SqliteFaceLogService | null = null;

  /**
   * Get singleton instance
   */
  public static getInstance(): SqliteFaceLogService {
    if (!SqliteFaceLogService.instance) {
      SqliteFaceLogService.instance = new SqliteFaceLogService();
    }
    return SqliteFaceLogService.instance;
  }

  private constructor() {
    // Private constructor for singleton pattern
  }

  /**
   * Check if the Electron API is available
   */
  private checkElectronAPI(): boolean {
    return typeof window !== 'undefined' && 
           !!window.electronAPI && 
           typeof window.electronAPI.logDetection === 'function';
  }

  /**
   * Log a face detection to the database
   */
  public async logDetection(detection: Omit<FaceLogEntry, 'id'>): Promise<string> {
    if (!this.checkElectronAPI()) {
      throw new Error('Electron API not available');
    }

    try {
      const id = await window.electronAPI!.logDetection(detection);
      console.log('Detection logged to SQLite:', { id, detection });
      return id;
    } catch (error) {
      console.error('Failed to log detection to SQLite:', error);
      throw error;
    }
  }

  /**
   * Get recent face detection logs
   */
  public async getRecentLogs(limit: number = 50): Promise<FaceLogEntry[]> {
    if (!this.checkElectronAPI()) {
      throw new Error('Electron API not available');
    }

    try {
      const logs = await window.electronAPI!.getRecentLogs(limit);
      return logs;
    } catch (error) {
      console.error('Failed to get recent logs from SQLite:', error);
      throw error;
    }
  }

  /**
   * Get today's detection statistics
   */
  public async getTodayStats(): Promise<TodayStats> {
    if (!this.checkElectronAPI()) {
      throw new Error('Electron API not available');
    }

    try {
      const stats = await window.electronAPI!.getTodayStats();
      return stats;
    } catch (error) {
      console.error('Failed to get today stats from SQLite:', error);
      throw error;
    }
  }

  /**
   * Export all data to a file
   */
  public async exportData(filePath: string): Promise<boolean> {
    if (!this.checkElectronAPI()) {
      throw new Error('Electron API not available');
    }

    try {
      const success = await window.electronAPI!.exportData(filePath);
      if (success) {
        console.log('Data exported successfully to:', filePath);
      }
      return success;
    } catch (error) {
      console.error('Failed to export data from SQLite:', error);
      throw error;
    }
  }

  /**
   * Clear old data beyond specified days
   */
  public async clearOldData(daysToKeep: number = 30): Promise<number> {
    if (!this.checkElectronAPI()) {
      throw new Error('Electron API not available');
    }

    try {
      const deletedCount = await window.electronAPI!.clearOldData(daysToKeep);
      console.log(`Cleared ${deletedCount} old records from SQLite`);
      return deletedCount;
    } catch (error) {
      console.error('Failed to clear old data from SQLite:', error);
      throw error;
    }
  }

  /**
   * Log an auto-detection (triggered by face detection)
   */
  public async logAutoDetection(
    personId: string | null,
    confidence: number,
    bbox: [number, number, number, number],
    similarity?: number
  ): Promise<string> {
    return this.logDetection({
      timestamp: new Date().toISOString(),
      personId,
      confidence,
      bbox,
      similarity,
      mode: 'auto'
    });
  }

  /**
   * Log a manual detection (triggered by user button click)
   */
  public async logManualDetection(
    personId: string | null,
    confidence: number,
    bbox: [number, number, number, number],
    similarity?: number
  ): Promise<string> {
    return this.logDetection({
      timestamp: new Date().toISOString(),
      personId,
      confidence,
      bbox,
      similarity,
      mode: 'manual'
    });
  }

  /**
   * Get logs for a specific person
   */
  public async getPersonLogs(personId: string, limit: number = 20): Promise<FaceLogEntry[]> {
    const allLogs = await this.getRecentLogs(1000); // Get more logs to filter
    return allLogs
      .filter(log => log.personId === personId)
      .slice(0, limit);
  }

  /**
   * Get detection count for today
   */
  public async getTodayDetectionCount(): Promise<number> {
    const stats = await this.getTodayStats();
    return stats.totalDetections;
  }

  /**
   * Check if database is available and working
   */
  public async isAvailable(): Promise<boolean> {
    try {
      await this.getTodayStats();
      return true;
    } catch {
      return false;
    }
  }
}

// Export singleton instance for convenience
export const sqliteFaceLogService = SqliteFaceLogService.getInstance();
