/**
 * Cleanup utility functions to eliminate code duplication
 * Used for stream, video, and animation frame cleanup
 */

/**
 * Cleans up a media stream by stopping all tracks
 */
export function cleanupStream(
  streamRef: React.RefObject<MediaStream | null>,
): void {
  if (streamRef.current) {
    streamRef.current.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // Ignore cleanup errors
      }
    });
    (streamRef as React.MutableRefObject<MediaStream | null>).current = null;
  }
}

/**
 * Cleans up a video element by clearing srcObject and optionally pausing
 */
export function cleanupVideo(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  pause: boolean = true,
): void {
  if (videoRef.current) {
    try {
      videoRef.current.srcObject = null;
      if (pause) {
        videoRef.current.pause();
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Cleans up an animation frame by canceling it
 */
export function cleanupAnimationFrame(
  animationFrameRef: React.RefObject<number | undefined>,
): void {
  if (animationFrameRef.current) {
    try {
      cancelAnimationFrame(animationFrameRef.current);
      (
        animationFrameRef as React.MutableRefObject<number | undefined>
      ).current = undefined;
    } catch {
      // Ignore cleanup errors
    }
  }
}
