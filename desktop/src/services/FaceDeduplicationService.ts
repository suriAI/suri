export interface DetectionSession {
  personId: string;
  detections: Array<{
    timestamp: number;
    confidence: number;
    similarity: number;
    bbox: [number, number, number, number];
    faceSize: number;
    qualityScore: number;
  }>;
  firstDetected: number;
  lastDetected: number;
  bestDetection?: {
    timestamp: number;
    confidence: number;
    similarity: number;
    bbox: [number, number, number, number];
    qualityScore: number;
  };
  logged: boolean;
  sessionId: string;
}

export interface FaceDeduplicationConfig {
  sessionTimeoutMs: number;
  minSessionDurationMs: number;
  maxSessionDurationMs: number;
  minConfidence: number;
  minSimilarity: number;
  qualityWeightConfidence: number;
  qualityWeightSimilarity: number;
  qualityWeightSize: number;
  minDetectionsForLog: number;
  stabilityThreshold: number;
  enableAdaptiveThresholds: boolean;
  enableQualityBasedSelection: boolean;
  enableTemporalSmoothing: boolean;
}

export class FaceDeduplicationService {
  private activeSessions = new Map<string, DetectionSession>();
  private config: FaceDeduplicationConfig;
  private sessionCleanupTimer?: NodeJS.Timeout;

  constructor(config?: Partial<FaceDeduplicationConfig>) {
    this.config = {
      sessionTimeoutMs: 30000,
      minSessionDurationMs: 2000,
      maxSessionDurationMs: 60000,
      minConfidence: 0.7,
      minSimilarity: 0.75,
      qualityWeightConfidence: 0.4,
      qualityWeightSimilarity: 0.4,
      qualityWeightSize: 0.2,
      minDetectionsForLog: 3,
      stabilityThreshold: 0.15,
      enableAdaptiveThresholds: true,
      enableQualityBasedSelection: true,
      enableTemporalSmoothing: true,
      ...config
    };

    this.startSessionCleanup();
  }

  /**
   * Temporal Session Clustering with Quality-Based Selection
   */
  public async processDetection(
    personId: string,
    confidence: number,
    similarity: number,
    bbox: [number, number, number, number],
    timestamp: number = Date.now()
  ): Promise<{
    shouldLog: boolean;
    bestDetection?: DetectionSession['bestDetection'];
    sessionId: string;
    reason: string;
  }> {
    const sessionId = this.getOrCreateSession(personId, timestamp);
    const session = this.activeSessions.get(sessionId)!;
    
    const faceSize = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
    const qualityScore = this.calculateQualityScore(confidence, similarity, faceSize);
    
    session.detections.push({
      timestamp,
      confidence,
      similarity,
      bbox,
      faceSize,
      qualityScore
    });
    session.lastDetected = timestamp;
    
    if (!session.bestDetection || qualityScore > session.bestDetection.qualityScore) {
      session.bestDetection = {
        timestamp,
        confidence,
        similarity,
        bbox,
        qualityScore
      };
    }
    
    const shouldLog = this.shouldLogSession(session, timestamp);
    
    if (shouldLog && !session.logged) {
      session.logged = true;
      return {
        shouldLog: true,
        bestDetection: session.bestDetection,
        sessionId,
        reason: 'Quality threshold met with temporal stability'
      };
    }
    
    return {
      shouldLog: false,
      sessionId,
      reason: this.getNoLogReason(session, timestamp)
    };
  }

  private calculateQualityScore(confidence: number, similarity: number, faceSize: number): number {
    const normalizedSize = Math.min(faceSize / 50000, 1);
    
    return (
      confidence * this.config.qualityWeightConfidence +
      similarity * this.config.qualityWeightSimilarity +
      normalizedSize * this.config.qualityWeightSize
    );
  }

  private isSessionStable(session: DetectionSession): boolean {
    if (session.detections.length < this.config.minDetectionsForLog) {
      return false;
    }
    
    const confidences = session.detections.map(d => d.confidence);
    const confMean = confidences.reduce((a, b) => a + b) / confidences.length;
    const confVariation = Math.max(...confidences) - Math.min(...confidences);
    
    const similarities = session.detections.map(d => d.similarity);
    const simMean = similarities.reduce((a, b) => a + b) / similarities.length;
    const simVariation = Math.max(...similarities) - Math.min(...similarities);
    
    return (
      confVariation / confMean < this.config.stabilityThreshold &&
      simVariation / simMean < this.config.stabilityThreshold
    );
  }

  private getOrCreateSession(personId: string, timestamp: number): string {
    for (const [sessionId, session] of this.activeSessions) {
      if (session.personId === personId && 
          timestamp - session.lastDetected < this.config.sessionTimeoutMs) {
        return sessionId;
      }
    }
    
    const sessionId = `${personId}_${timestamp}`;
    this.activeSessions.set(sessionId, {
      personId,
      detections: [],
      firstDetected: timestamp,
      lastDetected: timestamp,
      logged: false,
      sessionId
    });
    
    return sessionId;
  }

  private shouldLogSession(session: DetectionSession, currentTime: number): boolean {
    const sessionDuration = currentTime - session.firstDetected;
    const timeSinceLastDetection = currentTime - session.lastDetected;
    
    if (session.logged) return false;
    if (!session.bestDetection || session.bestDetection.qualityScore < 0.7) return false;
    if (sessionDuration > this.config.maxSessionDurationMs) return true;
    if (sessionDuration < this.config.minSessionDurationMs) return false;
    
    if (this.isSessionStable(session) && session.bestDetection.qualityScore > 0.8) {
      return true;
    }
    
    if (timeSinceLastDetection > 5000 && session.bestDetection.qualityScore > 0.75) {
      return true;
    }
    
    return false;
  }

  private getNoLogReason(session: DetectionSession, currentTime: number): string {
    if (session.logged) return 'Already logged';
    if (!session.bestDetection) return 'No valid detection';
    if (session.bestDetection.qualityScore < 0.7) return 'Quality too low';
    if (currentTime - session.firstDetected < this.config.minSessionDurationMs) return 'Session too short';
    if (session.detections.length < this.config.minDetectionsForLog) return 'Insufficient detections';
    if (!this.isSessionStable(session)) return 'Detections not stable';
    return 'Collecting more data';
  }

  private startSessionCleanup(): void {
    this.sessionCleanupTimer = setInterval(() => {
      const now = Date.now();
      const sessionsToDelete: string[] = [];
      
      for (const [sessionId, session] of this.activeSessions) {
        if (now - session.lastDetected > this.config.sessionTimeoutMs * 2) {
          sessionsToDelete.push(sessionId);
        }
      }
      
      sessionsToDelete.forEach(sessionId => {
        this.activeSessions.delete(sessionId);
      });
    }, 30000);
  }

  public getActiveSessionsCount(): number {
    return this.activeSessions.size;
  }

  public getSessionInfo(sessionId: string): DetectionSession | undefined {
    return this.activeSessions.get(sessionId);
  }

  public getAllSessions(): DetectionSession[] {
    return Array.from(this.activeSessions.values());
  }

  public clearAllSessions(): void {
    this.activeSessions.clear();
  }

  public destroy(): void {
    if (this.sessionCleanupTimer) {
      clearInterval(this.sessionCleanupTimer);
    }
    this.clearAllSessions();
  }
}
