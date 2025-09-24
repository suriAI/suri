/**
 * Advanced Computer Vision Service for State-of-the-Art Face Recognition
 * Implements intelligent frame selection, quality assessment, and optimization algorithms
 */

export interface FaceQualityMetrics {
  sharpness: number;          // 0-1, higher is better
  brightness: number;         // 0-1, optimal around 0.5
  contrast: number;           // 0-1, higher is better
  symmetry: number;           // 0-1, higher is better
  pose_quality: number;       // 0-1, frontal faces score higher
  eye_openness: number;       // 0-1, open eyes score higher
  mouth_state: number;        // 0-1, neutral/slight smile is optimal
  occlusion_score: number;    // 0-1, no occlusion scores higher
  lighting_quality: number;   // 0-1, even lighting scores higher
  overall_quality: number;    // 0-1, weighted combination of all metrics
}

export interface FrameAnalysis {
  timestamp: number;
  face_count: number;
  faces: Array<{
    bbox: [number, number, number, number];
    confidence: number;
    landmarks: number[][];
    quality_metrics: FaceQualityMetrics;
    tracking_id?: string;
  }>;
  frame_quality: {
    motion_blur: number;      // 0-1, lower is better
    noise_level: number;      // 0-1, lower is better
    exposure_quality: number; // 0-1, higher is better
  };
  optimal_for_capture: boolean;
}

export interface TrackingState {
  id: string;
  bbox_history: Array<[number, number, number, number]>;
  quality_history: FaceQualityMetrics[];
  confidence_history: number[];
  last_seen: number;
  stable_frames: number;
  best_quality_frame?: {
    timestamp: number;
    quality: FaceQualityMetrics;
    bbox: [number, number, number, number];
  };
}

export interface CaptureRecommendation {
  should_capture: boolean;
  confidence: number;
  reason: string;
  best_face_index?: number;
  quality_score: number;
  timing_score: number;
}

export class AdvancedComputerVision {
  private trackingStates: Map<string, TrackingState> = new Map();
  private frameHistory: FrameAnalysis[] = [];
  private readonly MAX_HISTORY = 30; // Keep last 30 frames for analysis
  private readonly TRACKING_TIMEOUT = 2000; // 2 seconds
  private nextTrackingId = 1;

  // Quality thresholds for optimal capture
  private readonly QUALITY_THRESHOLDS = {
    min_sharpness: 0.6,
    min_brightness: 0.3,
    max_brightness: 0.8,
    min_contrast: 0.4,
    min_symmetry: 0.7,
    min_pose_quality: 0.6,
    min_eye_openness: 0.7,
    min_overall_quality: 0.7,
    max_motion_blur: 0.3,
    max_noise_level: 0.4,
    min_exposure_quality: 0.5
  };

  /**
   * Analyze frame for face quality and tracking
   */
  public analyzeFrame(
    imageData: ImageData,
    detectionResult: { faces: Array<{ bbox: number[]; landmarks: number[][]; confidence: number }> },
    timestamp: number = Date.now()
  ): FrameAnalysis {
    const analysis: FrameAnalysis = {
      timestamp,
      face_count: detectionResult.faces?.length || 0,
      faces: [],
      frame_quality: this.assessFrameQuality(imageData),
      optimal_for_capture: false
    };

    // Process each detected face
    if (detectionResult.faces) {
      analysis.faces = detectionResult.faces.map((face: { bbox: number[]; landmarks: number[][]; confidence: number }) => {
        const quality_metrics = this.calculateFaceQuality(imageData, face);
        const bbox = (face.bbox.length >= 4 ? [face.bbox[0], face.bbox[1], face.bbox[2], face.bbox[3]] : [0, 0, 0, 0]) as [number, number, number, number];
        const tracking_id = this.updateTracking(bbox, quality_metrics, timestamp);
        
        return {
          bbox,
          confidence: face.confidence,
          landmarks: face.landmarks,
          quality_metrics,
          tracking_id
        };
      });
    }

    // Determine if frame is optimal for capture
    analysis.optimal_for_capture = this.isOptimalForCapture(analysis);

    // Update frame history
    this.frameHistory.push(analysis);
    if (this.frameHistory.length > this.MAX_HISTORY) {
      this.frameHistory.shift();
    }

    // Clean up old tracking states
    this.cleanupTracking(timestamp);

    return analysis;
  }

  /**
   * Calculate comprehensive face quality metrics
   */
  private calculateFaceQuality(imageData: ImageData, face: { bbox: number[]; landmarks: number[][]; confidence: number }): FaceQualityMetrics {
    const bbox = (face.bbox.length >= 4 ? [face.bbox[0], face.bbox[1], face.bbox[2], face.bbox[3]] : [0, 0, 0, 0]) as [number, number, number, number];
    const landmarks = face.landmarks;
    
    // Extract face region from image
    const faceRegion = this.extractFaceRegion(imageData, bbox);
    
    const sharpness = this.calculateSharpness(faceRegion);
    const brightness = this.calculateBrightness(faceRegion);
    const contrast = this.calculateContrast(faceRegion);
    const symmetry = this.calculateSymmetry(landmarks);
    const pose_quality = this.calculatePoseQuality(landmarks);
    const eye_openness = this.calculateEyeOpenness(landmarks);
    const mouth_state = this.calculateMouthState(landmarks);
    const occlusion_score = this.calculateOcclusionScore(faceRegion, landmarks);
    const lighting_quality = this.calculateLightingQuality(faceRegion, landmarks);

    // Calculate weighted overall quality
    const overall_quality = (
      sharpness * 0.20 +
      Math.min(brightness * 2, (1 - brightness) * 2) * 0.15 + // Optimal around 0.5
      contrast * 0.15 +
      symmetry * 0.15 +
      pose_quality * 0.15 +
      eye_openness * 0.10 +
      mouth_state * 0.05 +
      occlusion_score * 0.10 +
      lighting_quality * 0.15
    );

    return {
      sharpness,
      brightness,
      contrast,
      symmetry,
      pose_quality,
      eye_openness,
      mouth_state,
      occlusion_score,
      lighting_quality,
      overall_quality: Math.max(0, Math.min(1, overall_quality))
    };
  }

  /**
   * Calculate image sharpness using Laplacian variance
   */
  private calculateSharpness(imageData: ImageData): number {
    const { data, width, height } = imageData;
    let variance = 0;
    let mean = 0;
    let count = 0;

    // Convert to grayscale and apply Laplacian filter
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        
        // Laplacian kernel
        const laplacian = Math.abs(
          -gray +
          -((data[((y-1) * width + x) * 4] + data[((y-1) * width + x) * 4 + 1] + data[((y-1) * width + x) * 4 + 2]) / 3) +
          -((data[(y * width + (x-1)) * 4] + data[(y * width + (x-1)) * 4 + 1] + data[(y * width + (x-1)) * 4 + 2]) / 3) +
          4 * gray +
          -((data[(y * width + (x+1)) * 4] + data[(y * width + (x+1)) * 4 + 1] + data[(y * width + (x+1)) * 4 + 2]) / 3) +
          -((data[((y+1) * width + x) * 4] + data[((y+1) * width + x) * 4 + 1] + data[((y+1) * width + x) * 4 + 2]) / 3)
        );
        
        mean += laplacian;
        count++;
      }
    }

    mean /= count;

    // Calculate variance
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        
        const laplacian = Math.abs(
          -gray +
          -((data[((y-1) * width + x) * 4] + data[((y-1) * width + x) * 4 + 1] + data[((y-1) * width + x) * 4 + 2]) / 3) +
          -((data[(y * width + (x-1)) * 4] + data[(y * width + (x-1)) * 4 + 1] + data[(y * width + (x-1)) * 4 + 2]) / 3) +
          4 * gray +
          -((data[(y * width + (x+1)) * 4] + data[(y * width + (x+1)) * 4 + 1] + data[(y * width + (x+1)) * 4 + 2]) / 3) +
          -((data[((y+1) * width + x) * 4] + data[((y+1) * width + x) * 4 + 1] + data[((y+1) * width + x) * 4 + 2]) / 3)
        );
        
        variance += Math.pow(laplacian - mean, 2);
      }
    }

    variance /= count;
    return Math.min(1, variance / 1000); // Normalize to 0-1 range
  }

  /**
   * Calculate average brightness
   */
  private calculateBrightness(imageData: ImageData): number {
    const { data } = imageData;
    let total = 0;
    
    for (let i = 0; i < data.length; i += 4) {
      total += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
    
    return (total / (data.length / 4)) / 255;
  }

  /**
   * Calculate contrast using standard deviation
   */
  private calculateContrast(imageData: ImageData): number {
    const { data } = imageData;
    let mean = 0;
    let variance = 0;
    const pixelCount = data.length / 4;
    
    // Calculate mean
    for (let i = 0; i < data.length; i += 4) {
      mean += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
    mean /= pixelCount;
    
    // Calculate variance
    for (let i = 0; i < data.length; i += 4) {
      const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
      variance += Math.pow(gray - mean, 2);
    }
    variance /= pixelCount;
    
    const stdDev = Math.sqrt(variance);
    return Math.min(1, stdDev / 64); // Normalize to 0-1 range
  }

  /**
   * Calculate facial symmetry based on landmarks
   */
  private calculateSymmetry(landmarks: number[][]): number {
    if (!landmarks || landmarks.length < 5) return 0;
    
    const [leftEye, rightEye, nose, leftMouth, rightMouth] = landmarks;
    
    // Calculate face center
    const centerX = (leftEye[0] + rightEye[0]) / 2;
    
    // Check eye symmetry
    const leftEyeDistance = Math.abs(leftEye[0] - centerX);
    const rightEyeDistance = Math.abs(rightEye[0] - centerX);
    const eyeSymmetry = 1 - Math.abs(leftEyeDistance - rightEyeDistance) / Math.max(leftEyeDistance, rightEyeDistance);
    
    // Check mouth symmetry
    const leftMouthDistance = Math.abs(leftMouth[0] - centerX);
    const rightMouthDistance = Math.abs(rightMouth[0] - centerX);
    const mouthSymmetry = 1 - Math.abs(leftMouthDistance - rightMouthDistance) / Math.max(leftMouthDistance, rightMouthDistance);
    
    // Check nose alignment
    const noseAlignment = 1 - Math.abs(nose[0] - centerX) / (Math.abs(rightEye[0] - leftEye[0]) / 2);
    
    return (eyeSymmetry + mouthSymmetry + noseAlignment) / 3;
  }

  /**
   * Calculate pose quality (frontal faces score higher)
   */
  private calculatePoseQuality(landmarks: number[][]): number {
    if (!landmarks || landmarks.length < 5) return 0;
    
    const [leftEye, rightEye, nose] = landmarks;
    
    // Calculate eye line angle
    const eyeVector = [rightEye[0] - leftEye[0], rightEye[1] - leftEye[1]];
    const eyeAngle = Math.abs(Math.atan2(eyeVector[1], eyeVector[0]));
    
    // Calculate nose-to-eye-center distance ratio
    const eyeCenter = [(leftEye[0] + rightEye[0]) / 2, (leftEye[1] + rightEye[1]) / 2];
    const noseToEyeDistance = Math.sqrt(Math.pow(nose[0] - eyeCenter[0], 2) + Math.pow(nose[1] - eyeCenter[1], 2));
    const eyeDistance = Math.sqrt(Math.pow(rightEye[0] - leftEye[0], 2) + Math.pow(rightEye[1] - leftEye[1], 2));
    
    // Frontal faces have nose close to eye center line
    const noseAlignment = Math.max(0, 1 - (noseToEyeDistance / eyeDistance) * 2);
    
    // Frontal faces have minimal eye line tilt
    const angleScore = Math.max(0, 1 - (eyeAngle / (Math.PI / 6)) * 2); // Penalize angles > 30 degrees
    
    return (noseAlignment + angleScore) / 2;
  }

  /**
   * Calculate eye openness
   */
  private calculateEyeOpenness(landmarks: number[][]): number {
    if (!landmarks || landmarks.length < 5) return 0;
    
    // This is a simplified calculation - in a real implementation,
    // you would need more detailed eye landmarks
    // Estimate eye openness based on the assumption that closed eyes
    // would affect the landmark detection confidence
    // This is a placeholder - real implementation would need eye contour landmarks
    return 0.8; // Assume eyes are generally open
  }

  /**
   * Calculate mouth state (neutral/slight smile is optimal)
   */
  private calculateMouthState(landmarks: number[][]): number {
    if (!landmarks || landmarks.length < 5) return 0;
    
    // This is simplified - real implementation would analyze mouth curvature
    // and calculate mouth width for neutral expressions
    return 0.8; // Assume neutral mouth state
  }

  /**
   * Calculate occlusion score
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private calculateOcclusionScore(_imageData: ImageData, _landmarks: number[][]): number {
    // Simplified occlusion detection
    // Real implementation would analyze face region for obstructions
    return 0.9; // Assume minimal occlusion
  }

  /**
   * Calculate lighting quality
   */
  private calculateLightingQuality(imageData: ImageData, landmarks: number[][]): number {
    if (!landmarks || landmarks.length < 5) return 0;
    
    const [leftEye, rightEye, nose] = landmarks;
    
    // Sample brightness at key facial points
    const leftEyeBrightness = this.sampleBrightnessAtPoint(imageData, leftEye);
    const rightEyeBrightness = this.sampleBrightnessAtPoint(imageData, rightEye);
    const noseBrightness = this.sampleBrightnessAtPoint(imageData, nose);
    
    // Calculate lighting uniformity
    const brightnesses = [leftEyeBrightness, rightEyeBrightness, noseBrightness];
    const mean = brightnesses.reduce((a, b) => a + b) / brightnesses.length;
    const variance = brightnesses.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / brightnesses.length;
    
    // Lower variance indicates more uniform lighting
    return Math.max(0, 1 - Math.sqrt(variance) / 128);
  }

  /**
   * Sample brightness at a specific point
   */
  private sampleBrightnessAtPoint(imageData: ImageData, point: number[]): number {
    const { data, width } = imageData;
    const x = Math.round(point[0]);
    const y = Math.round(point[1]);
    const idx = (y * width + x) * 4;
    
    if (idx >= 0 && idx < data.length - 2) {
      return (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
    }
    return 128; // Default middle brightness
  }

  /**
   * Extract face region from image
   */
  private extractFaceRegion(imageData: ImageData, bbox: [number, number, number, number]): ImageData {
    const [x, y, width, height] = bbox;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    
    canvas.width = width;
    canvas.height = height;
    
    // Create temporary canvas with original image
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCanvas.width = imageData.width;
    tempCanvas.height = imageData.height;
    tempCtx.putImageData(imageData, 0, 0);
    
    // Extract face region
    ctx.drawImage(tempCanvas, x, y, width, height, 0, 0, width, height);
    
    return ctx.getImageData(0, 0, width, height);
  }

  /**
   * Assess overall frame quality
   */
  private assessFrameQuality(imageData: ImageData): { motion_blur: number; noise_level: number; exposure_quality: number } {
    const brightness = this.calculateBrightness(imageData);
    const contrast = this.calculateContrast(imageData);
    const sharpness = this.calculateSharpness(imageData);
    
    return {
      motion_blur: 1 - sharpness, // Inverse of sharpness
      noise_level: Math.max(0, 1 - contrast), // Low contrast can indicate noise
      exposure_quality: 1 - Math.abs(brightness - 0.5) * 2 // Optimal exposure around 0.5
    };
  }

  /**
   * Update face tracking
   */
  private updateTracking(bbox: [number, number, number, number], quality: FaceQualityMetrics, timestamp: number): string {
    // Find matching tracking state based on bbox overlap
    let bestMatch: string | null = null;
    let bestOverlap = 0;
    
    for (const [id, state] of this.trackingStates) {
      if (state.bbox_history.length > 0) {
        const lastBbox = state.bbox_history[state.bbox_history.length - 1];
        const overlap = this.calculateBboxOverlap(bbox, lastBbox);
        
        if (overlap > bestOverlap && overlap > 0.5) {
          bestOverlap = overlap;
          bestMatch = id;
        }
      }
    }
    
    if (bestMatch) {
      // Update existing tracking state
      const state = this.trackingStates.get(bestMatch)!;
      state.bbox_history.push(bbox);
      state.quality_history.push(quality);
      state.confidence_history.push(quality.overall_quality);
      state.last_seen = timestamp;
      state.stable_frames++;
      
      // Update best quality frame if this is better
      if (!state.best_quality_frame || quality.overall_quality > state.best_quality_frame.quality.overall_quality) {
        state.best_quality_frame = {
          timestamp,
          quality,
          bbox
        };
      }
      
      // Limit history size
      if (state.bbox_history.length > 10) {
        state.bbox_history.shift();
        state.quality_history.shift();
        state.confidence_history.shift();
      }
      
      return bestMatch;
    } else {
      // Create new tracking state
      const id = `track_${this.nextTrackingId++}`;
      this.trackingStates.set(id, {
        id,
        bbox_history: [bbox],
        quality_history: [quality],
        confidence_history: [quality.overall_quality],
        last_seen: timestamp,
        stable_frames: 1,
        best_quality_frame: {
          timestamp,
          quality,
          bbox
        }
      });
      
      return id;
    }
  }

  /**
   * Calculate bounding box overlap
   */
  private calculateBboxOverlap(bbox1: [number, number, number, number], bbox2: [number, number, number, number]): number {
    const [x1, y1, w1, h1] = bbox1;
    const [x2, y2, w2, h2] = bbox2;
    
    const overlapX = Math.max(0, Math.min(x1 + w1, x2 + w2) - Math.max(x1, x2));
    const overlapY = Math.max(0, Math.min(y1 + h1, y2 + h2) - Math.max(y1, y2));
    const overlapArea = overlapX * overlapY;
    
    const area1 = w1 * h1;
    const area2 = w2 * h2;
    const unionArea = area1 + area2 - overlapArea;
    
    return unionArea > 0 ? overlapArea / unionArea : 0;
  }

  /**
   * Clean up old tracking states
   */
  private cleanupTracking(currentTime: number): void {
    for (const [id, state] of this.trackingStates) {
      if (currentTime - state.last_seen > this.TRACKING_TIMEOUT) {
        this.trackingStates.delete(id);
      }
    }
  }

  /**
   * Determine if frame is optimal for capture
   */
  private isOptimalForCapture(analysis: FrameAnalysis): boolean {
    const { frame_quality, faces } = analysis;
    
    // Check frame quality
    if (frame_quality.motion_blur > this.QUALITY_THRESHOLDS.max_motion_blur ||
        frame_quality.noise_level > this.QUALITY_THRESHOLDS.max_noise_level ||
        frame_quality.exposure_quality < this.QUALITY_THRESHOLDS.min_exposure_quality) {
      return false;
    }
    
    // Check if any face meets quality requirements
    return faces.some(face => {
      const q = face.quality_metrics;
      return q.sharpness >= this.QUALITY_THRESHOLDS.min_sharpness &&
             q.brightness >= this.QUALITY_THRESHOLDS.min_brightness &&
             q.brightness <= this.QUALITY_THRESHOLDS.max_brightness &&
             q.contrast >= this.QUALITY_THRESHOLDS.min_contrast &&
             q.symmetry >= this.QUALITY_THRESHOLDS.min_symmetry &&
             q.pose_quality >= this.QUALITY_THRESHOLDS.min_pose_quality &&
             q.eye_openness >= this.QUALITY_THRESHOLDS.min_eye_openness &&
             q.overall_quality >= this.QUALITY_THRESHOLDS.min_overall_quality;
    });
  }

  /**
   * Get capture recommendation for auto mode
   */
  public getCaptureRecommendation(): CaptureRecommendation {
    if (this.frameHistory.length === 0) {
      return {
        should_capture: false,
        confidence: 0,
        reason: "No frame data available",
        quality_score: 0,
        timing_score: 0
      };
    }
    
    const latestFrame = this.frameHistory[this.frameHistory.length - 1];
    
    if (latestFrame.faces.length === 0) {
      return {
        should_capture: false,
        confidence: 0,
        reason: "No faces detected",
        quality_score: 0,
        timing_score: 0
      };
    }
    
    // Find best face in current frame
    let bestFaceIndex = 0;
    let bestQuality = 0;
    
    latestFrame.faces.forEach((face, index) => {
      if (face.quality_metrics.overall_quality > bestQuality) {
        bestQuality = face.quality_metrics.overall_quality;
        bestFaceIndex = index;
      }
    });
    
    const bestFace = latestFrame.faces[bestFaceIndex];
    const trackingState = bestFace.tracking_id ? this.trackingStates.get(bestFace.tracking_id) : null;
    
    // Calculate timing score based on tracking stability
    let timing_score = 0.5; // Default
    if (trackingState) {
      timing_score = Math.min(1, trackingState.stable_frames / 10); // Stable for 10 frames = perfect timing
    }
    
    const quality_score = bestFace.quality_metrics.overall_quality;
    const should_capture = latestFrame.optimal_for_capture && quality_score >= this.QUALITY_THRESHOLDS.min_overall_quality;
    
    return {
      should_capture,
      confidence: (quality_score + timing_score) / 2,
      reason: should_capture ? "Optimal quality and timing detected" : "Quality or timing not optimal",
      best_face_index: bestFaceIndex,
      quality_score,
      timing_score
    };
  }

  /**
   * Get best quality frame for a tracked face
   */
  public getBestQualityFrame(trackingId: string): TrackingState['best_quality_frame'] | null {
    const state = this.trackingStates.get(trackingId);
    return state?.best_quality_frame || null;
  }

  /**
   * Reset tracking and history
   */
  public reset(): void {
    this.trackingStates.clear();
    this.frameHistory = [];
    this.nextTrackingId = 1;
  }

  /**
   * Get current tracking statistics
   */
  public getTrackingStats(): {
    active_tracks: number;
    total_frames_analyzed: number;
    average_quality: number;
  } {
    const active_tracks = this.trackingStates.size;
    const total_frames_analyzed = this.frameHistory.length;
    
    let totalQuality = 0;
    let qualityCount = 0;
    
    this.frameHistory.forEach(frame => {
      frame.faces.forEach(face => {
        totalQuality += face.quality_metrics.overall_quality;
        qualityCount++;
      });
    });
    
    const average_quality = qualityCount > 0 ? totalQuality / qualityCount : 0;
    
    return {
      active_tracks,
      total_frames_analyzed,
      average_quality
    };
  }
}

export const advancedComputerVision = new AdvancedComputerVision();