/**
 * Enhanced Face Registration Service
 * Provides streamlined face enrollment with quality validation and step-by-step guidance
 */

import { BackendService } from './BackendService.js';
import { advancedComputerVision, type FaceQualityMetrics } from './AdvancedComputerVision.js';

export interface RegistrationStep {
  id: string;
  title: string;
  description: string;
  instruction: string;
  required_quality: Partial<FaceQualityMetrics>;
  completed: boolean;
  attempts: number;
  best_capture?: {
    timestamp: number;
    quality: FaceQualityMetrics;
    image_data: string;
    landmarks: number[][];
  };
}

export interface RegistrationSession {
  session_id: string;
  person_id: string;
  started_at: number;
  current_step: number;
  steps: RegistrationStep[];
  overall_progress: number;
  status: 'active' | 'completed' | 'failed' | 'cancelled';
  quality_requirements: QualityRequirements;
  captures_collected: number;
  min_captures_required: number;
  max_captures_allowed: number;
}

export interface QualityRequirements {
  min_sharpness: number;
  min_brightness: number;
  max_brightness: number;
  min_contrast: number;
  min_symmetry: number;
  min_pose_quality: number;
  min_eye_openness: number;
  min_overall_quality: number;
  max_pose_variation: number;
  require_multiple_angles: boolean;
}

export interface RegistrationResult {
  success: boolean;
  session_id: string;
  person_id: string;
  total_captures: number;
  processing_time: number;
  quality_score: number;
  template_strength: number;
  error?: string;
  warnings?: string[];
}

export interface RegistrationGuidance {
  current_instruction: string;
  quality_feedback: string[];
  pose_guidance: string;
  lighting_guidance: string;
  distance_guidance: string;
  next_action: 'continue' | 'capture' | 'retry' | 'complete';
  progress_percentage: number;
}

export class EnhancedFaceRegistration {
  private backendService: BackendService;
  private activeSessions: Map<string, RegistrationSession> = new Map();
  private sessionCounter = 1;

  // Default quality requirements for registration
  private readonly DEFAULT_QUALITY_REQUIREMENTS: QualityRequirements = {
    min_sharpness: 0.7,
    min_brightness: 0.35,
    max_brightness: 0.75,
    min_contrast: 0.5,
    min_symmetry: 0.8,
    min_pose_quality: 0.7,
    min_eye_openness: 0.8,
    min_overall_quality: 0.75,
    max_pose_variation: 0.3,
    require_multiple_angles: true
  };

  // Registration steps for comprehensive enrollment
  private readonly REGISTRATION_STEPS: Omit<RegistrationStep, 'completed' | 'attempts' | 'best_capture'>[] = [
    {
      id: 'frontal_high_quality',
      title: 'Frontal Face - High Quality',
      description: 'Capture a high-quality frontal face image',
      instruction: 'Look directly at the camera with a neutral expression. Ensure good lighting and hold still.',
      required_quality: {
        pose_quality: 0.8,
        symmetry: 0.85,
        overall_quality: 0.8
      }
    },
    {
      id: 'frontal_secondary',
      title: 'Frontal Face - Secondary',
      description: 'Capture a second frontal image for verification',
      instruction: 'Look directly at the camera again. You may blink or slightly adjust your position.',
      required_quality: {
        pose_quality: 0.75,
        symmetry: 0.8,
        overall_quality: 0.75
      }
    },
    {
      id: 'slight_left',
      title: 'Slight Left Turn',
      description: 'Capture face with slight left turn',
      instruction: 'Turn your head slightly to the left (about 15 degrees) while keeping eyes on camera.',
      required_quality: {
        pose_quality: 0.6,
        overall_quality: 0.7
      }
    },
    {
      id: 'slight_right',
      title: 'Slight Right Turn',
      description: 'Capture face with slight right turn',
      instruction: 'Turn your head slightly to the right (about 15 degrees) while keeping eyes on camera.',
      required_quality: {
        pose_quality: 0.6,
        overall_quality: 0.7
      }
    },
    {
      id: 'slight_up',
      title: 'Slight Upward Look',
      description: 'Capture face looking slightly upward',
      instruction: 'Tilt your head slightly up while maintaining eye contact with the camera.',
      required_quality: {
        pose_quality: 0.6,
        overall_quality: 0.7
      }
    }
  ];

  constructor(backendService: BackendService) {
    this.backendService = backendService;
  }

  /**
   * Start a new registration session
   */
  public startRegistration(
    personId: string,
    customRequirements?: Partial<QualityRequirements>
  ): RegistrationSession {
    const sessionId = `reg_${this.sessionCounter++}_${Date.now()}`;
    
    const qualityRequirements = {
      ...this.DEFAULT_QUALITY_REQUIREMENTS,
      ...customRequirements
    };

    const steps: RegistrationStep[] = this.REGISTRATION_STEPS.map(step => ({
      ...step,
      completed: false,
      attempts: 0
    }));

    const session: RegistrationSession = {
      session_id: sessionId,
      person_id: personId,
      started_at: Date.now(),
      current_step: 0,
      steps,
      overall_progress: 0,
      status: 'active',
      quality_requirements: qualityRequirements,
      captures_collected: 0,
      min_captures_required: 3,
      max_captures_allowed: 10
    };

    this.activeSessions.set(sessionId, session);
    return session;
  }

  /**
   * Process a capture attempt for registration
   */
  public async processCaptureAttempt(
    sessionId: string,
    imageData: ImageData,
    detectionResult: { faces: Array<{ bbox: number[]; landmarks: number[][]; confidence: number }> },
    timestamp: number = Date.now()
  ): Promise<{
    success: boolean;
    step_completed: boolean;
    guidance: RegistrationGuidance;
    session: RegistrationSession;
    error?: string;
  }> {
    const session = this.activeSessions.get(sessionId);
    if (!session || session.status !== 'active') {
      throw new Error('Invalid or inactive registration session');
    }

    const currentStep = session.steps[session.current_step];
    currentStep.attempts++;

    // Analyze frame quality
    const frameAnalysis = advancedComputerVision.analyzeFrame(imageData, detectionResult, timestamp);
    
    if (frameAnalysis.faces.length === 0) {
      return {
        success: false,
        step_completed: false,
        guidance: this.generateGuidance(session, null, ['No face detected']),
        session,
        error: 'No face detected in the image'
      };
    }

    if (frameAnalysis.faces.length > 1) {
      return {
        success: false,
        step_completed: false,
        guidance: this.generateGuidance(session, null, ['Multiple faces detected']),
        session,
        error: 'Multiple faces detected. Please ensure only one person is in the frame.'
      };
    }

    const face = frameAnalysis.faces[0];
    const quality = face.quality_metrics;

    // Check if capture meets step requirements
    const meetsRequirements = this.checkStepRequirements(currentStep, quality, session.quality_requirements);
    
    if (meetsRequirements.success) {
      // Convert ImageData to base64 for storage
      const imageBase64 = await this.imageDataToBase64(imageData);
      
      // Store the capture
      currentStep.best_capture = {
        timestamp,
        quality,
        image_data: imageBase64,
        landmarks: face.landmarks
      };
      
      currentStep.completed = true;
      session.captures_collected++;
      
      // Move to next step or complete registration
      if (session.current_step < session.steps.length - 1) {
        session.current_step++;
      }
      
      // Update progress
      session.overall_progress = (session.captures_collected / session.steps.length) * 100;
      
      // Check if registration is complete
      const allStepsCompleted = session.steps.every(step => step.completed);
      const hasMinimumCaptures = session.captures_collected >= session.min_captures_required;
      
      if (allStepsCompleted || hasMinimumCaptures) {
        session.status = 'completed';
      }
      
      return {
        success: true,
        step_completed: true,
        guidance: this.generateGuidance(session, quality),
        session
      };
    } else {
      return {
        success: false,
        step_completed: false,
        guidance: this.generateGuidance(session, quality, meetsRequirements.issues),
        session,
        error: `Quality requirements not met: ${meetsRequirements.issues.join(', ')}`
      };
    }
  }

  /**
   * Complete the registration process
   */
  public async completeRegistration(sessionId: string): Promise<RegistrationResult> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error('Registration session not found');
    }

    if (session.status !== 'completed') {
      throw new Error('Registration session is not ready for completion');
    }

    const startTime = performance.now();
    const warnings: string[] = [];

    try {
      // Collect all successful captures
      const captures = session.steps
        .filter(step => step.completed && step.best_capture)
        .map(step => step.best_capture!);

      if (captures.length < session.min_captures_required) {
        throw new Error(`Insufficient captures: ${captures.length} < ${session.min_captures_required}`);
      }

      // Register each capture with the backend
      const registrationPromises = captures.map(async (capture, index) => {
        try {
          const response = await this.backendService.registerFace(
            capture.image_data,
            session.person_id,
            capture.landmarks
          );
          
          if (!response.success) {
            throw new Error(response.error || 'Registration failed');
          }
          
          return response;
        } catch (error) {
          console.error(`Failed to register capture ${index}:`, error);
          throw error;
        }
      });

      await Promise.all(registrationPromises);
      
      // Calculate overall quality and template strength
      const averageQuality = captures.reduce((sum, capture) => 
        sum + capture.quality.overall_quality, 0) / captures.length;
      
      // Template strength based on number of captures and quality variation
      const qualityVariation = this.calculateQualityVariation(captures);
      const templateStrength = Math.min(1, (captures.length / session.max_captures_allowed) * 0.7 + 
                                           (1 - qualityVariation) * 0.3);

      // Add warnings for suboptimal conditions
      if (captures.length < session.steps.length) {
        warnings.push(`Only ${captures.length} of ${session.steps.length} recommended captures completed`);
      }
      
      if (averageQuality < 0.8) {
        warnings.push('Average capture quality could be improved');
      }

      const processingTime = performance.now() - startTime;

      const result: RegistrationResult = {
        success: true,
        session_id: sessionId,
        person_id: session.person_id,
        total_captures: captures.length,
        processing_time: processingTime,
        quality_score: averageQuality,
        template_strength: templateStrength,
        warnings: warnings.length > 0 ? warnings : undefined
      };

      // Clean up session
      this.activeSessions.delete(sessionId);

      return result;

    } catch (error) {
      session.status = 'failed';
      
      const processingTime = performance.now() - startTime;
      
      return {
        success: false,
        session_id: sessionId,
        person_id: session.person_id,
        total_captures: 0,
        processing_time: processingTime,
        quality_score: 0,
        template_strength: 0,
        error: error instanceof Error ? error.message : 'Registration failed',
        warnings
      };
    }
  }

  /**
   * Cancel registration session
   */
  public cancelRegistration(sessionId: string): boolean {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.status = 'cancelled';
      this.activeSessions.delete(sessionId);
      return true;
    }
    return false;
  }

  /**
   * Get registration session
   */
  public getSession(sessionId: string): RegistrationSession | null {
    return this.activeSessions.get(sessionId) || null;
  }

  /**
   * Get all active sessions
   */
  public getActiveSessions(): RegistrationSession[] {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Check if capture meets step requirements
   */
  private checkStepRequirements(
    step: RegistrationStep,
    quality: FaceQualityMetrics,
    globalRequirements: QualityRequirements
  ): { success: boolean; issues: string[] } {
    const issues: string[] = [];
    
    // Check global requirements
    if (quality.sharpness < globalRequirements.min_sharpness) {
      issues.push('Image is too blurry');
    }
    
    if (quality.brightness < globalRequirements.min_brightness) {
      issues.push('Image is too dark');
    }
    
    if (quality.brightness > globalRequirements.max_brightness) {
      issues.push('Image is too bright');
    }
    
    if (quality.contrast < globalRequirements.min_contrast) {
      issues.push('Image contrast is too low');
    }
    
    if (quality.symmetry < globalRequirements.min_symmetry) {
      issues.push('Face is not properly centered');
    }
    
    if (quality.eye_openness < globalRequirements.min_eye_openness) {
      issues.push('Eyes should be open');
    }
    
    if (quality.overall_quality < globalRequirements.min_overall_quality) {
      issues.push('Overall image quality is insufficient');
    }

    // Check step-specific requirements
    const stepReqs = step.required_quality;
    
    if (stepReqs.pose_quality && quality.pose_quality < stepReqs.pose_quality) {
      issues.push('Face pose does not match step requirements');
    }
    
    if (stepReqs.symmetry && quality.symmetry < stepReqs.symmetry) {
      issues.push('Face symmetry does not meet step requirements');
    }
    
    if (stepReqs.overall_quality && quality.overall_quality < stepReqs.overall_quality) {
      issues.push('Quality does not meet step requirements');
    }

    return {
      success: issues.length === 0,
      issues
    };
  }

  /**
   * Generate guidance for user
   */
  private generateGuidance(
    session: RegistrationSession,
    quality: FaceQualityMetrics | null,
    issues?: string[]
  ): RegistrationGuidance {
    const currentStep = session.steps[session.current_step];
    const isCompleted = session.status === 'completed';
    
    let instruction = currentStep?.instruction || 'Registration complete';
    let qualityFeedback: string[] = [];
    let poseGuidance = '';
    let lightingGuidance = '';
    let distanceGuidance = '';
    let nextAction: 'continue' | 'capture' | 'retry' | 'complete' = 'capture';

    if (isCompleted) {
      instruction = 'All steps completed! Ready to finalize registration.';
      nextAction = 'complete';
    } else if (issues && issues.length > 0) {
      qualityFeedback = issues;
      nextAction = 'retry';
    } else if (quality) {
      // Provide specific guidance based on quality metrics
      if (quality.sharpness < 0.7) {
        qualityFeedback.push('Hold camera steady to reduce blur');
      }
      
      if (quality.brightness < 0.4) {
        lightingGuidance = 'Move to a brighter location or improve lighting';
      } else if (quality.brightness > 0.7) {
        lightingGuidance = 'Reduce lighting or move away from bright light source';
      } else {
        lightingGuidance = 'Lighting looks good';
      }
      
      if (quality.pose_quality < 0.7) {
        poseGuidance = currentStep?.instruction || 'Adjust face position according to step instructions';
      } else {
        poseGuidance = 'Face position looks good';
      }
      
      if (quality.symmetry < 0.8) {
        distanceGuidance = 'Center your face in the frame';
      } else {
        distanceGuidance = 'Face positioning looks good';
      }
      
      nextAction = 'capture';
    }

    return {
      current_instruction: instruction,
      quality_feedback: qualityFeedback,
      pose_guidance: poseGuidance,
      lighting_guidance: lightingGuidance,
      distance_guidance: distanceGuidance,
      next_action: nextAction,
      progress_percentage: session.overall_progress
    };
  }

  /**
   * Calculate quality variation across captures
   */
  private calculateQualityVariation(captures: NonNullable<RegistrationStep['best_capture']>[]): number {
    if (captures.length < 2) return 0;
    
    const qualities = captures.map(c => c.quality.overall_quality);
    const mean = qualities.reduce((sum, q) => sum + q, 0) / qualities.length;
    const variance = qualities.reduce((sum, q) => sum + Math.pow(q - mean, 2), 0) / qualities.length;
    
    return Math.sqrt(variance);
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
      }, 'image/jpeg', 0.9); // High quality for registration
    });
  }

  /**
   * Get registration statistics
   */
  public getRegistrationStats(): {
    active_sessions: number;
    completed_today: number;
    average_completion_time: number;
    success_rate: number;
  } {
    // This would typically be stored in a database
    // For now, return basic stats from active sessions
    return {
      active_sessions: this.activeSessions.size,
      completed_today: 0, // Would need persistent storage
      average_completion_time: 0, // Would need historical data
      success_rate: 0 // Would need historical data
    };
  }

  /**
   * Validate person ID for registration
   */
  public validatePersonId(personId: string): { valid: boolean; error?: string } {
    if (!personId || personId.trim().length === 0) {
      return { valid: false, error: 'Person ID cannot be empty' };
    }
    
    if (personId.length < 2) {
      return { valid: false, error: 'Person ID must be at least 2 characters long' };
    }
    
    if (personId.length > 50) {
      return { valid: false, error: 'Person ID cannot exceed 50 characters' };
    }
    
    if (!/^[a-zA-Z0-9_-]+$/.test(personId)) {
      return { valid: false, error: 'Person ID can only contain letters, numbers, underscores, and hyphens' };
    }
    
    return { valid: true };
  }
}

export const enhancedFaceRegistration = new EnhancedFaceRegistration(new BackendService());