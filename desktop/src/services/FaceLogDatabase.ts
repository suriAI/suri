export interface FaceLog {
  id: string;
  timestamp: string;
  personId: string;
  confidence: number;
  mode: "auto" | "manual";
  processed_time?: string;
}

export interface DailyLog {
  date: string;
  total_detections: number;
  unique_people: number;
  logs: FaceLog[];
}

export interface PersonLog {
  personId: string;
  total_detections: number;
  first_detected: string;
  last_detected: string;
  recent_logs: FaceLog[];
}

export interface Summary {
  total_people: number;
  total_detections: number;
  today_detections: number;
  last_updated: string | null;
  daily_stats: Record<string, number>;
}

class FaceLogDatabase {
  private basePath = "/face-logs";

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private sanitizePersonId(personId: string): string {
    return personId.toLowerCase().replace(/[^a-z0-9]/g, '_');
  }

  async readJsonFile<T>(path: string, defaultValue: T): Promise<T> {
    try {
      // Use localStorage as primary storage in Electron
      const key = path.replace(/[^a-zA-Z0-9]/g, '_');
      const stored = localStorage.getItem(key);
      
      if (stored) {
        return JSON.parse(stored);
      }
      
      // Fallback: try to read from public folder (will likely fail in Electron)
      const response = await fetch(path);
      if (!response.ok) {
        console.log(`📂 No existing file at ${path}, using default`);
        return defaultValue;
      }
      const data = await response.json();
      
      // Store in localStorage for next time
      localStorage.setItem(key, JSON.stringify(data));
      return data;
    } catch (error) {
      console.log(`📂 Using default for ${path}:`, String(error));
      return defaultValue;
    }
  }

  async writeJsonFile(path: string, data: unknown): Promise<void> {
    try {
      // Store in localStorage as primary storage
      const key = path.replace(/[^a-zA-Z0-9]/g, '_');
      localStorage.setItem(key, JSON.stringify(data));
      
      console.log(`💾 Saved to localStorage: ${path}`, data);
      
      // In the future, this would send to main process to write actual files
      // window.electronAPI?.writeFile?.(path, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`Failed to write ${path}:`, error);
    }
  }

  async getSummary(): Promise<Summary> {
    return this.readJsonFile(`${this.basePath}/summary.json`, {
      total_people: 0,
      total_detections: 0,
      today_detections: 0,
      last_updated: null,
      daily_stats: {}
    });
  }

  async getDailyLog(date: Date): Promise<DailyLog> {
    const dateStr = this.formatDate(date);
    return this.readJsonFile(`${this.basePath}/daily/${dateStr}.json`, {
      date: dateStr,
      total_detections: 0,
      unique_people: 0,
      logs: []
    });
  }

  async getPersonLog(personId: string): Promise<PersonLog> {
    const sanitizedId = this.sanitizePersonId(personId);
    return this.readJsonFile(`${this.basePath}/people/${sanitizedId}.json`, {
      personId,
      total_detections: 0,
      first_detected: new Date().toISOString(),
      last_detected: new Date().toISOString(),
      recent_logs: []
    });
  }

  async logDetection(personId: string, confidence: number, mode: "auto" | "manual"): Promise<void> {
    const now = new Date();
    const logEntry: FaceLog = {
      id: `${Date.now()}_${this.sanitizePersonId(personId)}`,
      timestamp: now.toISOString(),
      personId,
      confidence,
      mode,
      processed_time: now.toISOString()
    };

    try {
      // Update daily log
      const dailyLog = await this.getDailyLog(now);
      dailyLog.logs.push(logEntry);
      dailyLog.total_detections++;
      
      const uniquePeople = new Set(dailyLog.logs.map(log => log.personId));
      dailyLog.unique_people = uniquePeople.size;
      
      await this.writeJsonFile(`${this.basePath}/daily/${this.formatDate(now)}.json`, dailyLog);

      // Update person log
      const personLog = await this.getPersonLog(personId);
      if (personLog.total_detections === 0) {
        personLog.first_detected = logEntry.timestamp;
      }
      personLog.last_detected = logEntry.timestamp;
      personLog.total_detections++;
      personLog.recent_logs.unshift(logEntry);
      
      // Keep only last 50 logs per person
      personLog.recent_logs = personLog.recent_logs.slice(0, 50);
      
      await this.writeJsonFile(`${this.basePath}/people/${this.sanitizePersonId(personId)}.json`, personLog);

      // Update summary
      const summary = await this.getSummary();
      summary.total_detections++;
      summary.last_updated = now.toISOString();
      
      const todayStr = this.formatDate(now);
      summary.daily_stats[todayStr] = (summary.daily_stats[todayStr] || 0) + 1;
      summary.today_detections = summary.daily_stats[todayStr];
      
      // Count unique people from all person files (simplified)
      const allPeople = new Set([personId]);
      Object.keys(localStorage).forEach(key => {
        if (key.includes('people') && key.includes('json')) {
          try {
            const data = JSON.parse(localStorage.getItem(key) || '{}');
            if (data.personId) allPeople.add(data.personId);
          } catch {
            // ignore parsing errors
          }
        }
      });
      summary.total_people = allPeople.size;
      
      await this.writeJsonFile(`${this.basePath}/summary.json`, summary);

      console.log(`✅ Logged detection for ${personId}:`, logEntry);
    } catch (error) {
      console.error('Failed to log detection:', error);
      throw error;
    }
  }

  async getRecentLogs(limit: number = 10): Promise<FaceLog[]> {
    try {
      const today = new Date();
      const dailyLog = await this.getDailyLog(today);
      
      // Also check yesterday if today has few logs
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayLog = await this.getDailyLog(yesterday);
      
      const allLogs = [...dailyLog.logs, ...yesterdayLog.logs];
      const recentLogs = allLogs
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);
        
      console.log(`📋 Retrieved ${recentLogs.length} recent logs`, recentLogs);
      return recentLogs;
    } catch (error) {
      console.error('Failed to get recent logs:', error);
      return [];
    }
  }

  async getTodayStats(): Promise<{ today_records: number; total_people: number }> {
    try {
      const summary = await this.getSummary();
      return {
        today_records: summary.today_detections,
        total_people: summary.total_people
      };
    } catch (error) {
      console.error('Failed to get today stats:', error);
      return { today_records: 0, total_people: 0 };
    }
  }
}

export const faceLogDB = new FaceLogDatabase();
