import initSqlJs, { type Database } from 'sql.js';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';

export interface FaceLog {
  id: string;
  timestamp: string;
  personId: string;
  confidence: number;
  mode: "auto" | "manual";
  processed_time: string;
}

export interface TodayStats {
  totalDetections: number;
  uniquePersons: number;
  firstDetection: string | null;
  lastDetection: string | null;
}

class SimpleSqliteFaceDatabase {
  private db: Database | null = null;
  private dbPath: string;

  constructor() {
    // Store database in user data directory
    const userDataPath = app?.getPath?.('userData') || './data';
    this.dbPath = path.join(userDataPath, 'face-logs.db');
  }

  async initialize(): Promise<void> {
    try {
      console.log(`📊 Initializing SQL.js database at: ${this.dbPath}`);
      
      // Initialize SQL.js
      const SQL = await initSqlJs();

      // Try to load existing database file
      let data: Uint8Array | undefined;
      try {
        if (fs.existsSync(this.dbPath)) {
          data = fs.readFileSync(this.dbPath);
          console.log(`📂 Loaded existing database from ${this.dbPath}`);
        }
      } catch {
        console.log('📂 No existing database file found, creating new one');
      }

      // Create database (with or without existing data)
      this.db = new SQL.Database(data);

      // Create tables if they don't exist
      this.createTables();

      console.log('✅ SQL.js Face Database initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize SQL.js database:', error);
      throw error;
    }
  }

  private createTables(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Face logs table - main logging data
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS face_logs (
        id TEXT PRIMARY KEY,
        timestamp DATETIME NOT NULL,
        person_id TEXT NOT NULL,
        confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
        mode TEXT NOT NULL CHECK(mode IN ('auto', 'manual')),
        processed_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create indexes for better performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_face_logs_timestamp ON face_logs(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_face_logs_person_id ON face_logs(person_id);
      CREATE INDEX IF NOT EXISTS idx_face_logs_mode ON face_logs(mode);
      CREATE INDEX IF NOT EXISTS idx_face_logs_date ON face_logs(DATE(timestamp));
    `);
  }

  private saveToFile(): void {
    if (!this.db) return;
    try {
      const data = this.db.export();
      fs.writeFileSync(this.dbPath, data);
    } catch (error) {
      console.error('Failed to save database to file:', error);
    }
  }

  async logDetection(personId: string, confidence: number, mode: "auto" | "manual"): Promise<string> {
    if (!this.db) throw new Error('Database not initialized');

    const now = new Date();
    const logId = `${Date.now()}_${personId.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const timestamp = now.toISOString();

    try {
      // Insert face log
      this.db.run(`
        INSERT INTO face_logs (id, timestamp, person_id, confidence, mode, processed_time)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [logId, timestamp, personId, confidence, mode, timestamp]);

      // Save database to file
      this.saveToFile();

      console.log(`✅ SQL.js: Logged detection for ${personId} (${mode}, ${(confidence * 100).toFixed(1)}%)`);
      return logId;
    } catch (error) {
      console.error('❌ SQL.js: Failed to log detection:', error);
      throw error;
    }
  }

  async getRecentLogs(limit: number = 10): Promise<FaceLog[]> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const result = this.db.exec(`
        SELECT id, timestamp, person_id, confidence, mode, processed_time
        FROM face_logs 
        ORDER BY timestamp DESC 
        LIMIT ?
      `, [limit]);

      if (result.length === 0) return [];

      const logs: FaceLog[] = [];
      const values = result[0].values;
      
      for (const row of values) {
        logs.push({
          id: row[0] as string,
          timestamp: row[1] as string,
          personId: row[2] as string,
          confidence: row[3] as number,
          mode: row[4] as "auto" | "manual",
          processed_time: row[5] as string
        });
      }

      return logs;
    } catch (error) {
      console.error('❌ SQL.js: Failed to get recent logs:', error);
      throw error;
    }
  }

  async getTodayStats(): Promise<TodayStats> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Get total detections and unique people for today
      const statsResult = this.db.exec(`
        SELECT 
          COUNT(*) as total_detections,
          COUNT(DISTINCT person_id) as unique_people,
          MIN(timestamp) as first_detection,
          MAX(timestamp) as last_detection
        FROM face_logs 
        WHERE DATE(timestamp) = ?
      `, [today]);

      if (statsResult.length === 0 || statsResult[0].values.length === 0) {
        return {
          totalDetections: 0,
          uniquePersons: 0,
          firstDetection: null,
          lastDetection: null
        };
      }

      const row = statsResult[0].values[0];
      return {
        totalDetections: row[0] as number,
        uniquePersons: row[1] as number,
        firstDetection: row[2] as string | null,
        lastDetection: row[3] as string | null
      };
    } catch (error) {
      console.error('❌ SQL.js: Failed to get today stats:', error);
      throw error;
    }
  }

  async exportData(filePath: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const data = this.db.export();
      fs.writeFileSync(filePath, data);
      console.log(`📁 Database exported to: ${filePath}`);
    } catch (error) {
      console.error('❌ Failed to export database:', error);
      throw error;
    }
  }

  async clearOldData(daysToKeep: number): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      const cutoffDateStr = cutoffDate.toISOString();

      // Get count of records to be deleted
      const countResult = this.db.exec(`
        SELECT COUNT(*) FROM face_logs WHERE timestamp < ?
      `, [cutoffDateStr]);

      const deleteCount = countResult[0]?.values[0]?.[0] as number || 0;

      if (deleteCount > 0) {
        // Delete old records
        this.db.run(`DELETE FROM face_logs WHERE timestamp < ?`, [cutoffDateStr]);
        
        // Save database to file
        this.saveToFile();
        
        console.log(`🗑️ Deleted ${deleteCount} old records (older than ${daysToKeep} days)`);
      }

      return deleteCount;
    } catch (error) {
      console.error('❌ Failed to clear old data:', error);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.db) return false;
      
      // Simple query to check if database is working
      this.db.exec('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      try {
        this.saveToFile();
        this.db.close();
        this.db = null;
        console.log('📊 SQL.js database closed successfully');
      } catch (error) {
        console.error('❌ Failed to close database:', error);
      }
    }
  }
}

// Export singleton instance
export const sqliteFaceDB = new SimpleSqliteFaceDatabase();
