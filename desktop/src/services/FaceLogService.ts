/**
 * FaceLogService - React frontend interface to SQLite database via Electron IPC
 * 
 * This service provides a clean interface for the React frontend to interact with
 * the SQLite database running in the Electron main process via IPC communication.
 */

import '../types/global.d.ts';

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

export interface PersonStats {
  totalDetections: number;
  avgConfidence: number;
  firstDetection: string | null;
  lastDetection: string | null;
  autoDetections: number;
  manualDetections: number;
}

export class FaceLogService {
  private static instance: FaceLogService | null = null;

  /**
   * Get singleton instance
   */
  public static getInstance(): FaceLogService {
    if (!FaceLogService.instance) {
      FaceLogService.instance = new FaceLogService();
    }
    return FaceLogService.instance;
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

  /**
   * Get all unique people from the database
   */
  public async getAllPeople(): Promise<string[]> {
    if (!this.checkElectronAPI()) {
      throw new Error('Electron API not available');
    }

    try {
      const people = await window.electronAPI!.getAllPeople();
      return people;
    } catch (error) {
      console.error('Failed to get all people from SQLite:', error);
      throw error;
    }
  }

  /**
   * Get logs for a specific person (override the existing method with the new IPC call)
   */
  public async getPersonLogs(personId: string, limit: number = 50): Promise<FaceLogEntry[]> {
    if (!this.checkElectronAPI()) {
      throw new Error('Electron API not available');
    }

    try {
      const logs = await window.electronAPI!.getPersonLogs(personId, limit);
      return logs;
    } catch (error) {
      console.error('Failed to get person logs from SQLite:', error);
      throw error;
    }
  }

  /**
   * Update/rename a person ID in all their records
   */
  public async updatePersonId(oldPersonId: string, newPersonId: string): Promise<number> {
    if (!this.checkElectronAPI()) {
      throw new Error('Electron API not available');
    }

    try {
      const updateCount = await window.electronAPI!.updatePersonId(oldPersonId, newPersonId);
      return updateCount;
    } catch (error) {
      console.error('Failed to update person ID:', error);
      throw error;
    }
  }

  /**
   * Delete all records for a specific person
   */
  public async deletePersonRecords(personId: string): Promise<number> {
    if (!this.checkElectronAPI()) {
      throw new Error('Electron API not available');
    }

    try {
      const deleteCount = await window.electronAPI!.deletePersonRecords(personId);
      return deleteCount;
    } catch (error) {
      console.error('Failed to delete person records:', error);
      throw error;
    }
  }

  /**
   * Get detailed statistics for a specific person
   */
  public async getPersonStats(personId: string): Promise<PersonStats> {
    if (!this.checkElectronAPI()) {
      throw new Error('Electron API not available');
    }

    try {
      const stats = await window.electronAPI!.getPersonStats(personId);
      return stats;
    } catch (error) {
      console.error('Failed to get person stats:', error);
      throw error;
    }
  }
}

// Export singleton instance for convenience
export const faceLogService = FaceLogService.getInstance();
