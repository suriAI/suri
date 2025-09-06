import { ipcMain } from 'electron';
import { sqliteFaceDB } from '../services/SimpleSqliteFaceDatabase.js';

export function setupFaceLogIPC() {
  // Initialize the database
  ipcMain.handle('face-db:initialize', async () => {
    try {
      await sqliteFaceDB.initialize();
      return { success: true };
    } catch (error) {
      console.error('Failed to initialize face database:', error);
      return { success: false, error: String(error) };
    }
  });

  // Log a face detection
  ipcMain.handle('face-db:log-detection', async (_, detection: { personId: string | null; confidence: number; mode: 'auto' | 'manual'; timestamp: string; bbox: [number, number, number, number]; similarity?: number }) => {
    try {
      const id = await sqliteFaceDB.logDetection(
        detection.personId || 'unknown', 
        detection.confidence, 
        detection.mode
      );
      return id;
    } catch (error) {
      console.error('Failed to log detection:', error);
      throw error;
    }
  });

  // Get recent logs
  ipcMain.handle('face-db:get-recent-logs', async (_, limit: number = 10) => {
    try {
      const logs = await sqliteFaceDB.getRecentLogs(limit);
      return logs;
    } catch (error) {
      console.error('Failed to get recent logs:', error);
      throw error;
    }
  });

  // Get today's stats
  ipcMain.handle('face-db:get-today-stats', async () => {
    try {
      const stats = await sqliteFaceDB.getTodayStats();
      return stats;
    } catch (error) {
      console.error('Failed to get today stats:', error);
      throw error;
    }
  });

  // Get system stats (using today stats as fallback)
  ipcMain.handle('face-db:get-system-stats', async () => {
    try {
      const stats = await sqliteFaceDB.getTodayStats();
      return { 
        success: true, 
        data: {
          totalDetections: stats.totalDetections,
          uniquePersons: stats.uniquePersons,
          firstDetection: stats.firstDetection,
          lastDetection: stats.lastDetection
        }
      };
    } catch (error) {
      console.error('Failed to get system stats:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get daily stats (simplified to today only)
  ipcMain.handle('face-db:get-daily-stats', async () => {
    try {
      const stats = await sqliteFaceDB.getTodayStats();
      return { 
        success: true, 
        data: [{
          date: new Date().toISOString().split('T')[0],
          totalDetections: stats.totalDetections,
          uniquePersons: stats.uniquePersons
        }]
      };
    } catch (error) {
      console.error('Failed to get daily stats:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get person stats (not implemented yet)
  ipcMain.handle('face-db:get-person-stats', async () => {
    try {
      return { success: true, data: [] };
    } catch (error) {
      console.error('Failed to get person stats:', error);
      return { success: false, error: String(error) };
    }
  });

  // Export database
  ipcMain.handle('face-db:export', async (_, filePath: string) => {
    try {
      await sqliteFaceDB.exportData(filePath);
      return { success: true };
    } catch (error) {
      console.error('Failed to export database:', error);
      return { success: false, error: String(error) };
    }
  });

  // Vacuum database (not available in sql.js)
  ipcMain.handle('face-db:vacuum', async () => {
    try {
      // sql.js doesn't have vacuum, but we can export/reimport to optimize
      return { success: true, message: 'Vacuum not needed for sql.js' };
    } catch (error) {
      console.error('Failed to vacuum database:', error);
      return { success: false, error: String(error) };
    }
  });

  // Health check
  ipcMain.handle('face-db:health-check', async () => {
    try {
      const isHealthy = await sqliteFaceDB.healthCheck();
      return { success: true, data: { healthy: isHealthy } };
    } catch (error) {
      console.error('Failed to check database health:', error);
      return { success: false, error: String(error) };
    }
  });

  console.log('✅ Face Log IPC handlers registered');
}
