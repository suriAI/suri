/**
 * Dual-Mode Recognition Manager
 * Orchestrates Auto and Manual face recognition modes with intelligent decision making
 */

import { advancedComputerVision, type FrameAnalysis } from './AdvancedComputerVision.js';
import { BackendService } from './BackendService.js';

export type RecognitionMode = 'auto' | 'manual' | 'hybrid';

export interface RecognitionSettings {
  mode: RecognitionMode;
  auto_capture_threshold: number;      // 0-1, quality threshold for auto capture
  auto_capture_interval: number;       // Minimum ms between auto captures
  manual_capture_quality: number;     // 0-1, minimum quality for manual capture
  enable_tracking: boolean;
  enable_quality_feedback: boolean;
  enable_audio_feedback: boolean;
  max_faces_per_capture: number;
  confidence_threshold: number;
  similarity_threshold: number;
}

export interface CaptureResult {
  success: boolean;
  timestamp: number;
  mode: 'auto' | 'manual';
  faces_detected: number;
  faces_recognized: number;
  quality_score: number;
  processing_time: number;
  frame_analysis?: FrameAnalysis;
  recognition_results: Array<{
    person_id?: string;
    similarity?: number;
    confidence: number;
    quality_metrics: import('./AdvancedComputerVision.js').FaceQualityMetrics;
    error?: string;
  }>;
  error?: string;
}

export interface SystemStatus {
  mode: RecognitionMode;
  is_active: boolean;
  last_capture: number | null;
  total_captures: number;
  auto_captures: number;
  manual_captures: number;
  average_quality: number;
  recognition_rate: number;
  current_fps: number;
  tracking_active: boolean;
  faces_being_tracked: number;
}

export interface FeedbackEvent {
  type: 'visual' | 'audio' | 'haptic';
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
}

export class DualModeRecognitionManager {
  private backendService: BackendService;
  private settings: RecognitionSettings;
  private isActive = false;
  private lastAutoCapture = 0;
  private captureHistory: CaptureResult[] = [];
  private readonly MAX_HISTORY = 100;
  
  // Performance tracking
  private frameCount = 0;
  private lastFpsUpdate = 0;
  private currentFps = 0;
  
  // Event handlers
  private onCaptureCallback?: (result: CaptureResult) => void;
  private onFeedbackCallback?: (event: FeedbackEvent) => void;
  private onStatusUpdateCallback?: (status: SystemStatus) => void;

  // Audio context for feedback
  private audioContext?: AudioContext;
  private feedbackSounds: Map<string, AudioBuffer> = new Map();

  constructor(backendService: BackendService) {
    this.backendService = backendService;
    this.settings = this.getDefaultSettings();
    this.initializeAudioFeedback();
  }

  /**
   * Get default recognition settings
   */
  private getDefaultSettings(): RecognitionSettings {
    return {
      mode: 'auto',
      auto_capture_threshold: 0.75,
      auto_capture_interval: 2000, // 2 seconds
      manual_capture_quality: 0.6,
      enable_tracking: true,
      enable_quality_feedback: true,
      enable_audio_feedback: true,
      max_faces_per_capture: 5,
      confidence_threshold: 0.7,
      similarity_threshold: 0.8
    };
  }

  /**
   * Initialize audio feedback system
   */
  private async initializeAudioFeedback(): Promise<void> {
    try {
      this.audioContext = new AudioContext();
      
      // Generate feedback sounds
      await this.generateFeedbackSounds();
    } catch (error) {
      console.warn('Audio feedback initialization failed:', error);
    }
  }

  /**
   * Generate audio feedback sounds
   */
  private async generateFeedbackSounds(): Promise<void> {
    if (!this.audioContext) return;

    const sampleRate = this.audioContext.sampleRate;
    
    // Success sound (pleasant chime)
    const successBuffer = this.audioContext.createBuffer(1, sampleRate * 0.3, sampleRate);
    const successData = successBuffer.getChannelData(0);
    for (let i = 0; i < successData.length; i++) {
      const t = i / sampleRate;
      successData[i] = Math.sin(2 * Math.PI * 800 * t) * Math.exp(-t * 3) * 0.3;
    }
    this.feedbackSounds.set('success', successBuffer);

    // Warning sound (gentle beep)
    const warningBuffer = this.audioContext.createBuffer(1, sampleRate * 0.2, sampleRate);
    const warningData = warningBuffer.getChannelData(0);
    for (let i = 0; i < warningData.length; i++) {
      const t = i / sampleRate;
      warningData[i] = Math.sin(2 * Math.PI * 600 * t) * Math.exp(-t * 5) * 0.2;
    }
    this.feedbackSounds.set('warning', warningBuffer);

    // Error sound (low tone)
    const errorBuffer = this.audioContext.createBuffer(1, sampleRate * 0.4, sampleRate);
    const errorData = errorBuffer.getChannelData(0);
    for (let i = 0; i < errorData.length; i++) {
      const t = i / sampleRate;
      errorData[i] = Math.sin(2 * Math.PI * 300 * t) * Math.exp(-t * 2) * 0.25;
    }
    this.feedbackSounds.set('error', errorBuffer);
  }

  /**
   * Start recognition system
   */
  public start(): void {
    this.isActive = true;
    advancedComputerVision.reset();
    this.lastFpsUpdate = Date.now();
    this.frameCount = 0;
    
    this.emitFeedback({
      type: 'visual',
      message: `${this.settings.mode.toUpperCase()} mode activated`,
      level: 'success'
    });

    this.updateStatus();
  }

  /**
   * Stop recognition system
   */
  public stop(): void {
    this.isActive = false;
    advancedComputerVision.reset();
    
    this.emitFeedback({
      type: 'visual',
      message: 'Recognition system stopped',
      level: 'info'
    });

    this.updateStatus();
  }

  /**
   * Process frame for recognition
   */
  public async processFrame(
    imageData: ImageData,
    detectionResult: { faces: Array<{ bbox: number[]; landmarks: number[][]; confidence: number }> },
    timestamp: number = Date.now()
  ): Promise<void> {
    if (!this.isActive) return;

    // Update FPS tracking
    this.frameCount++;
    const now = Date.now();
    if (now - this.lastFpsUpdate >= 1000) {
      this.currentFps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsUpdate = now;
      this.updateStatus();
    }

    // Analyze frame with advanced computer vision
    const frameAnalysis = advancedComputerVision.analyzeFrame(imageData, detectionResult, timestamp);

    // Handle auto mode
    if (this.settings.mode === 'auto' || this.settings.mode === 'hybrid') {
      await this.handleAutoMode(imageData, frameAnalysis, timestamp);
    }

    // Provide real-time feedback
    if (this.settings.enable_quality_feedback) {
      this.provideQualityFeedback(frameAnalysis);
    }
  }

  /**
   * Handle auto mode capture logic
   */
  private async handleAutoMode(
    imageData: ImageData,
    frameAnalysis: FrameAnalysis,
    timestamp: number
  ): Promise<void> {
    // Check if enough time has passed since last auto capture
    if (timestamp - this.lastAutoCapture < this.settings.auto_capture_interval) {
      return;
    }

    // Get capture recommendation
    const recommendation = advancedComputerVision.getCaptureRecommendation();

    if (recommendation.should_capture && 
        recommendation.quality_score >= this.settings.auto_capture_threshold) {
      
      await this.performCapture(imageData, frameAnalysis, 'auto', timestamp);
      this.lastAutoCapture = timestamp;
    }
  }

  /**
   * Manual capture trigger
   */
  public async triggerManualCapture(imageData: ImageData, detectionResult: { faces: Array<{ bbox: number[]; landmarks: number[][]; confidence: number }> }): Promise<CaptureResult> {
    const timestamp = Date.now();
    const frameAnalysis = advancedComputerVision.analyzeFrame(imageData, detectionResult, timestamp);

    // Check minimum quality for manual capture
    if (frameAnalysis.faces.length === 0) {
      const result: CaptureResult = {
        success: false,
        timestamp,
        mode: 'manual',
        faces_detected: 0,
        faces_recognized: 0,
        quality_score: 0,
        processing_time: 0,
        recognition_results: [],
        error: 'No faces detected'
      };

      this.emitFeedback({
        type: 'visual',
        message: 'No faces detected for capture',
        level: 'warning'
      });

      if (this.settings.enable_audio_feedback) {
        this.playFeedbackSound('warning');
      }

      return result;
    }

    // Find best quality face
    const bestFace = frameAnalysis.faces.reduce((best: FrameAnalysis['faces'][0], current: FrameAnalysis['faces'][0]) => 
      current.quality_metrics.overall_quality > best.quality_metrics.overall_quality ? current : best
    );

    if (bestFace.quality_metrics.overall_quality < this.settings.manual_capture_quality) {
      const result: CaptureResult = {
        success: false,
        timestamp,
        mode: 'manual',
        faces_detected: frameAnalysis.faces.length,
        faces_recognized: 0,
        quality_score: bestFace.quality_metrics.overall_quality,
        processing_time: 0,
        recognition_results: [],
        error: 'Face quality too low for reliable recognition'
      };

      this.emitFeedback({
        type: 'visual',
        message: `Face quality too low (${(bestFace.quality_metrics.overall_quality * 100).toFixed(1)}%)`,
        level: 'warning'
      });

      if (this.settings.enable_audio_feedback) {
        this.playFeedbackSound('warning');
      }

      return result;
    }

    return await this.performCapture(imageData, frameAnalysis, 'manual', timestamp);
  }

  /**
   * Perform actual capture and recognition
   */
  private async performCapture(
    imageData: ImageData,
    frameAnalysis: FrameAnalysis,
    mode: 'auto' | 'manual',
    timestamp: number
  ): Promise<CaptureResult> {
    const startTime = performance.now();

    try {
      // Convert ImageData to base64
      const base64Image = await this.imageDataToBase64(imageData);
      
      // Process faces for recognition
      const recognitionResults = await Promise.all(
        frameAnalysis.faces.slice(0, this.settings.max_faces_per_capture).map(async (face: FrameAnalysis['faces'][0]) => {
          try {
            const landmarks = face.landmarks;
            const response = await this.backendService.recognizeFace(base64Image, landmarks);
            
            return {
              person_id: response.person_id,
              similarity: response.similarity,
              confidence: face.confidence,
              quality_metrics: face.quality_metrics
            };
          } catch (error) {
            console.error('Face recognition failed:', error);
            return {
              confidence: face.confidence,
              quality_metrics: face.quality_metrics,
              error: error instanceof Error ? error.message : 'Recognition failed'
            };
          }
        })
      );

      const processingTime = performance.now() - startTime;
      const facesRecognized = recognitionResults.filter((r: { person_id?: string }) => r.person_id).length;
      const averageQuality = frameAnalysis.faces.reduce((sum: number, face: FrameAnalysis['faces'][0]) => 
        sum + face.quality_metrics.overall_quality, 0) / frameAnalysis.faces.length;

      const result: CaptureResult = {
        success: true,
        timestamp,
        mode,
        faces_detected: frameAnalysis.faces.length,
        faces_recognized: facesRecognized,
        quality_score: averageQuality,
        processing_time: processingTime,
        frame_analysis: frameAnalysis,
        recognition_results: recognitionResults
      };

      // Add to history
      this.captureHistory.push(result);
      if (this.captureHistory.length > this.MAX_HISTORY) {
        this.captureHistory.shift();
      }

      // Emit feedback
      const message = facesRecognized > 0 
        ? `${facesRecognized} face(s) recognized (${mode} mode)`
        : `${frameAnalysis.faces.length} face(s) detected but not recognized (${mode} mode)`;

      this.emitFeedback({
        type: 'visual',
        message,
        level: facesRecognized > 0 ? 'success' : 'info'
      });

      if (this.settings.enable_audio_feedback) {
        this.playFeedbackSound(facesRecognized > 0 ? 'success' : 'warning');
      }

      // Notify callback
      if (this.onCaptureCallback) {
        this.onCaptureCallback(result);
      }

      this.updateStatus();
      return result;

    } catch (error) {
      const processingTime = performance.now() - startTime;
      const result: CaptureResult = {
        success: false,
        timestamp,
        mode,
        faces_detected: frameAnalysis.faces.length,
        faces_recognized: 0,
        quality_score: 0,
        processing_time: processingTime,
        recognition_results: [],
        error: error instanceof Error ? error.message : 'Capture failed'
      };

      this.emitFeedback({
        type: 'visual',
        message: `Capture failed: ${result.error}`,
        level: 'error'
      });

      if (this.settings.enable_audio_feedback) {
        this.playFeedbackSound('error');
      }

      return result;
    }
  }

  /**
   * Provide real-time quality feedback
   */
  private provideQualityFeedback(frameAnalysis: FrameAnalysis): void {
    if (frameAnalysis.faces.length === 0) return;

    const bestFace = frameAnalysis.faces.reduce((best: FrameAnalysis['faces'][0], current: FrameAnalysis['faces'][0]) => 
      current.quality_metrics.overall_quality > best.quality_metrics.overall_quality ? current : best
    );

    const quality = bestFace.quality_metrics;
    const issues: string[] = [];

    // Check for quality issues
    if (quality.sharpness < 0.6) issues.push('image blur');
    if (quality.brightness < 0.3 || quality.brightness > 0.8) issues.push('poor lighting');
    if (quality.pose_quality < 0.6) issues.push('face angle');
    if (quality.symmetry < 0.7) issues.push('face position');

    if (issues.length > 0 && Math.random() < 0.1) { // Throttle feedback
      this.emitFeedback({
        type: 'visual',
        message: `Quality issues: ${issues.join(', ')}`,
        level: 'warning',
        duration: 2000
      });
    }
  }

  /**
   * Play audio feedback sound
   */
  private playFeedbackSound(type: string): void {
    if (!this.audioContext || !this.feedbackSounds.has(type)) return;

    try {
      const source = this.audioContext.createBufferSource();
      source.buffer = this.feedbackSounds.get(type)!;
      source.connect(this.audioContext.destination);
      source.start();
    } catch (error) {
      console.warn('Failed to play feedback sound:', error);
    }
  }

  /**
   * Convert ImageData to base64
   */
  private async imageDataToBase64(imageData: ImageData): Promise<string> {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    ctx.putImageData(imageData, 0, 0);
    
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.readAsDataURL(blob!);
      }, 'image/jpeg', 0.8);
    });
  }

  /**
   * Update system status
   */
  private updateStatus(): void {
    const stats = advancedComputerVision.getTrackingStats();
    const totalCaptures = this.captureHistory.length;
    const autoCaptures = this.captureHistory.filter(c => c.mode === 'auto').length;
    const manualCaptures = this.captureHistory.filter(c => c.mode === 'manual').length;
    
    const successfulCaptures = this.captureHistory.filter(c => c.success && c.faces_recognized > 0);
    
    const status: SystemStatus = {
      mode: this.settings.mode,
      is_active: this.isActive,
      last_capture: this.captureHistory.length > 0 ? this.captureHistory[this.captureHistory.length - 1].timestamp : null,
      total_captures: totalCaptures,
      auto_captures: autoCaptures,
      manual_captures: manualCaptures,
      average_quality: stats.average_quality,
      recognition_rate: totalCaptures > 0 ? successfulCaptures.length / totalCaptures : 0,
      current_fps: this.currentFps,
      tracking_active: this.settings.enable_tracking,
      faces_being_tracked: stats.active_tracks
    };

    if (this.onStatusUpdateCallback) {
      this.onStatusUpdateCallback(status);
    }
  }

  /**
   * Emit feedback event
   */
  private emitFeedback(event: FeedbackEvent): void {
    if (this.onFeedbackCallback) {
      this.onFeedbackCallback(event);
    }
  }

  // Public API methods

  /**
   * Update recognition settings
   */
  public updateSettings(newSettings: Partial<RecognitionSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    
    if (newSettings.mode) {
      this.emitFeedback({
        type: 'visual',
        message: `Switched to ${newSettings.mode.toUpperCase()} mode`,
        level: 'info'
      });
    }

    this.updateStatus();
  }

  /**
   * Get current settings
   */
  public getSettings(): RecognitionSettings {
    return { ...this.settings };
  }

  /**
   * Get system status
   */
  public getStatus(): SystemStatus {
    const stats = advancedComputerVision.getTrackingStats();
    const totalCaptures = this.captureHistory.length;
    const autoCaptures = this.captureHistory.filter(c => c.mode === 'auto').length;
    const manualCaptures = this.captureHistory.filter(c => c.mode === 'manual').length;
    
    const successfulCaptures = this.captureHistory.filter(c => c.success && c.faces_recognized > 0);
    
    return {
      mode: this.settings.mode,
      is_active: this.isActive,
      last_capture: this.captureHistory.length > 0 ? this.captureHistory[this.captureHistory.length - 1].timestamp : null,
      total_captures: totalCaptures,
      auto_captures: autoCaptures,
      manual_captures: manualCaptures,
      average_quality: stats.average_quality,
      recognition_rate: totalCaptures > 0 ? successfulCaptures.length / totalCaptures : 0,
      current_fps: this.currentFps,
      tracking_active: this.settings.enable_tracking,
      faces_being_tracked: stats.active_tracks
    };
  }

  /**
   * Get capture history
   */
  public getCaptureHistory(limit?: number): CaptureResult[] {
    const history = [...this.captureHistory].reverse();
    return limit ? history.slice(0, limit) : history;
  }

  /**
   * Clear capture history
   */
  public clearHistory(): void {
    this.captureHistory = [];
    this.updateStatus();
  }

  /**
   * Set event callbacks
   */
  public onCapture(callback: (result: CaptureResult) => void): void {
    this.onCaptureCallback = callback;
  }

  public onFeedback(callback: (event: FeedbackEvent) => void): void {
    this.onFeedbackCallback = callback;
  }

  public onStatusUpdate(callback: (status: SystemStatus) => void): void {
    this.onStatusUpdateCallback = callback;
  }

  /**
   * Get quality recommendations for current frame
   */
  public getQualityRecommendations(): string[] {
    const recommendation = advancedComputerVision.getCaptureRecommendation();
    const recommendations: string[] = [];

    if (!recommendation.should_capture) {
      if (recommendation.quality_score < 0.6) {
        recommendations.push('Improve lighting conditions');
        recommendations.push('Ensure face is clearly visible');
        recommendations.push('Reduce camera shake or motion blur');
      }
      if (recommendation.timing_score < 0.5) {
        recommendations.push('Hold position steady for better tracking');
        recommendations.push('Face the camera directly');
      }
    }

    return recommendations;
  }

  /**
   * Force capture regardless of quality (for testing/debugging)
   */
  public async forceCapture(imageData: ImageData, detectionResult: { faces: Array<{ bbox: number[]; landmarks: number[][]; confidence: number }> }): Promise<CaptureResult> {
    const originalThreshold = this.settings.manual_capture_quality;
    this.settings.manual_capture_quality = 0; // Temporarily disable quality check
    
    const result = await this.triggerManualCapture(imageData, detectionResult);
    
    this.settings.manual_capture_quality = originalThreshold; // Restore original threshold
    return result;
  }
}

export default DualModeRecognitionManager;