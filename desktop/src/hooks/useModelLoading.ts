import { useEffect, useState, useRef } from "react";

interface ModelLoadingState {
  modelsReady: boolean;
  isChecking: boolean;
}

/**
 * Custom hook to check if backend server is ready
 * All AI models are loaded on the server side, not in Electron
 */
export function useModelLoading(): ModelLoadingState {
  const [modelsReady, setModelsReady] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const isMountedRef = useRef(true);
  const modelsReadyRef = useRef(false);
  const maxWaitTime = 120000; // 2 minutes max wait time
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    isMountedRef.current = true;
    startTimeRef.current = Date.now();
    modelsReadyRef.current = false;

    // Check if backend server is ready with timeout
    const checkBackendReady = async (): Promise<boolean> => {
      try {
        // Check if we've exceeded max wait time
        if (Date.now() - startTimeRef.current > maxWaitTime) {
          console.error(
            "[useModelLoading] Timeout waiting for backend to be ready",
          );
          if (isMountedRef.current) {
            setModelsReady(false);
            setIsChecking(false);
            modelsReadyRef.current = false;
          }
          return false;
        }

        if (!window.electronAPI || !("backend_ready" in window.electronAPI)) {
          console.warn("[useModelLoading] electronAPI not available");
          // Keep checking - electronAPI might not be ready yet
          return false;
        }

        // Add timeout to the IPC call to prevent hanging
        const timeoutPromise = new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(false), 10000); // 10 second timeout per check
        });

        const readyPromise = window.electronAPI.backend_ready
          .isReady()
          .then((ready) => ready || false);

        const ready = await Promise.race([readyPromise, timeoutPromise]);

        if (isMountedRef.current) {
          if (ready) {
            modelsReadyRef.current = true;
            setModelsReady(true);
            setIsChecking(false);
            return true;
          }
          // Backend not ready yet - keep isChecking=true and continue polling
          return false;
        }

        return false;
      } catch (error) {
        console.error(
          "[useModelLoading] Failed to check backend readiness:",
          error,
        );
        // Don't set isChecking to false on error - keep polling
        // Only stop checking after max wait time
        if (Date.now() - startTimeRef.current > maxWaitTime) {
          if (isMountedRef.current) {
            setModelsReady(false);
            setIsChecking(false);
            modelsReadyRef.current = false;
          }
        }
        return false;
      }
    };

    // Initial check
    checkBackendReady();

    // Poll backend readiness every 500ms until ready
    const pollInterval = setInterval(async () => {
      if (!isMountedRef.current || modelsReadyRef.current) {
        clearInterval(pollInterval);
        return;
      }

      const ready = await checkBackendReady();
      if (ready) {
        clearInterval(pollInterval);
      }
    }, 500);

    // Cleanup timeout - stop checking after max wait time
    const timeoutId = setTimeout(() => {
      if (isMountedRef.current && !modelsReadyRef.current) {
        console.error(
          "[useModelLoading] Max wait time exceeded, stopping checks",
        );
        setIsChecking(false);
        setModelsReady(false);
        modelsReadyRef.current = false;
        clearInterval(pollInterval);
      }
    }, maxWaitTime);

    return () => {
      isMountedRef.current = false;
      clearInterval(pollInterval);
      clearTimeout(timeoutId);
    };
  }, []); // Empty dependency array - only run once on mount

  return { modelsReady, isChecking };
}
