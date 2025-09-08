import { ipcMain, app } from 'electron';
import { sqliteFaceDB } from '../services/SimpleSqliteFaceDatabase.js';
import * as fs from 'fs';
import * as path from 'path';

export function setupFaceLogIPC() {
  // Remove any existing handlers to prevent duplicate registration
  const handlers = [
    'face-db:initialize',
    'face-db:log-detection', 
    'face-db:get-recent-logs',
    'face-db:get-today-stats',
    'face-db:get-system-stats',
    'face-db:get-daily-stats',
    'face-db:get-all-person-stats',
    'face-db:export-data',
    'face-db:vacuum',
    'face-db:health-check',
    'face-db:get-all-people',
    'face-db:get-person-logs',
    'face-db:update-person-id',
    'face-db:delete-person',
    'face-db:get-person-stats',
    'face-db:clear-old-data',
    // Face Recognition Database handlers
    'face-recognition:save-database',
    'face-recognition:load-database',
    'face-recognition:remove-person',
    'face-recognition:get-all-persons'
  ];
  
  handlers.forEach(handler => {
    ipcMain.removeHandler(handler);
  });

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

  // Get all person stats (not implemented yet)
  ipcMain.handle('face-db:get-all-person-stats', async () => {
    try {
      return { success: true, data: [] };
    } catch (error) {
      console.error('Failed to get all person stats:', error);
      return { success: false, error: String(error) };
    }
  });

  // Export database
  ipcMain.handle('face-db:export-data', async (_, filePath: string) => {
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

  // Get all people
  ipcMain.handle('face-db:get-all-people', async () => {
    try {
      const people = await sqliteFaceDB.getAllPeople();
      return people;
    } catch (error) {
      console.error('Failed to get all people:', error);
      throw error;
    }
  });

  // Get person logs
  ipcMain.handle('face-db:get-person-logs', async (_, personId: string, limit: number = 50) => {
    try {
      const logs = await sqliteFaceDB.getPersonLogs(personId, limit);
      return logs;
    } catch (error) {
      console.error('Failed to get person logs:', error);
      throw error;
    }
  });

  // Update person ID (rename)
  ipcMain.handle('face-db:update-person-id', async (_, oldPersonId: string, newPersonId: string) => {
    try {
      const updateCount = await sqliteFaceDB.updatePersonId(oldPersonId, newPersonId);
      return updateCount;
    } catch (error) {
      console.error('Failed to update person ID:', error);
      throw error;
    }
  });

  // Delete person records
  ipcMain.handle('face-db:delete-person', async (_, personId: string) => {
    try {
      const deleteCount = await sqliteFaceDB.deletePersonRecords(personId);
      return deleteCount;
    } catch (error) {
      console.error('Failed to delete person records:', error);
      throw error;
    }
  });

  // Get person stats
  ipcMain.handle('face-db:get-person-stats', async (_, personId: string) => {
    try {
      const stats = await sqliteFaceDB.getPersonStats(personId);
      return stats;
    } catch (error) {
      console.error('Failed to get person stats:', error);
      throw error;
    }
  });

  // Clear old data
  ipcMain.handle('face-db:clear-old-data', async (_, daysToKeep: number) => {
    try {
      const deletedCount = await sqliteFaceDB.clearOldData(daysToKeep);
      return deletedCount;
    } catch (error) {
      console.error('Failed to clear old data:', error);
      throw error;
    }
  });

  // ==================== FACE RECOGNITION DATABASE HANDLERS ====================
  
  const getFaceDbPath = () => {
    // Use userData directory for proper Electron app behavior
    // This ensures the database works in both development and production
    const userDataPath = app.getPath('userData');
    const faceDataDir = path.join(userDataPath, 'face-data');
    return path.join(faceDataDir, 'face-embeddings.json');
  };

  // Save face recognition database to file
  ipcMain.handle('face-recognition:save-database', async (_, databaseData: Record<string, number[]>) => {
    try {
      const dbPath = getFaceDbPath();
      const dbDir = path.dirname(dbPath);
      
      // Ensure userData/face-data directory exists
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      
      // Save to file with pretty formatting
      fs.writeFileSync(dbPath, JSON.stringify(databaseData, null, 2), 'utf8');
      console.log(`💾 Face database saved to: ${dbPath}`);
      console.log(`📊 Persons stored: ${Object.keys(databaseData).length}`);
      return { success: true };
    } catch (error) {
      console.error('Failed to save face database:', error);
      return { success: false, error: String(error) };
    }
  });

  // Load face recognition database from file
  ipcMain.handle('face-recognition:load-database', async () => {
    try {
      const dbPath = getFaceDbPath();
      
      if (!fs.existsSync(dbPath)) {
        console.log(`📂 Face database file does not exist yet: ${dbPath}`);
        return { success: true, data: {} };
      }
      
      const fileContent = fs.readFileSync(dbPath, 'utf8');
      const databaseData = JSON.parse(fileContent);
      console.log(`📂 Face database loaded from: ${dbPath}`);
      console.log(`📊 Persons loaded: ${Object.keys(databaseData).length}`);
      return { success: true, data: databaseData };
    } catch (error) {
      console.error('Failed to load face database:', error);
      return { success: false, error: String(error), data: {} };
    }
  });

  // Remove person from face recognition database
  ipcMain.handle('face-recognition:remove-person', async (_, personId: string) => {
    try {
      const dbPath = getFaceDbPath();
      
      if (!fs.existsSync(dbPath)) {
        return { success: false, message: 'Face database file does not exist' };
      }
      
      const fileContent = fs.readFileSync(dbPath, 'utf8');
      const databaseData = JSON.parse(fileContent);
      
      const existed = personId in databaseData;
      if (existed) {
        delete databaseData[personId];
        fs.writeFileSync(dbPath, JSON.stringify(databaseData, null, 2), 'utf8');
        console.log(`🗑️ Removed "${personId}" from face database`);
      }
      
      return { success: true, existed };
    } catch (error) {
      console.error('Failed to remove person from face database:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get all persons from face recognition database
  ipcMain.handle('face-recognition:get-all-persons', async () => {
    try {
      const dbPath = getFaceDbPath();
      
      if (!fs.existsSync(dbPath)) {
        return { success: true, persons: [] };
      }
      
      const fileContent = fs.readFileSync(dbPath, 'utf8');
      const databaseData = JSON.parse(fileContent);
      const persons = Object.keys(databaseData);
      
      return { success: true, persons };
    } catch (error) {
      console.error('Failed to get all persons from face database:', error);
      return { success: false, error: String(error), persons: [] };
    }
  });

  console.log('[SUCCESS] Face Log IPC handlers registered');
}
