import { useRef, useEffect } from "react";
import { startTransition } from "react";
import { useAttendanceStore } from "../stores";

export function useAttendanceCooldown() {
  const {
    persistentCooldowns,
    setPersistentCooldowns,
    attendanceCooldownSeconds,
  } = useAttendanceStore();
  const persistentCooldownsRef = useRef<
    Map<string, import("../types").CooldownInfo>
  >(new Map());

  useEffect(() => {
    persistentCooldownsRef.current = persistentCooldowns;
  }, [persistentCooldowns]);

  useEffect(() => {
    let lastUpdateTime = 0;
    const updateInterval = 1000;
    let rafId: number | null = null;

    const updateCooldowns = () => {
      const now = Date.now();
      startTransition(() => {
        setPersistentCooldowns((prev) => {
          if (prev.size === 0) return prev;

          const newPersistent = new Map(prev);
          let hasChanges = false;

          for (const [personId, cooldownInfo] of newPersistent) {
            const timeSinceStart = now - cooldownInfo.startTime;
            const cooldownSeconds =
              cooldownInfo.cooldownDurationSeconds ?? attendanceCooldownSeconds;
            const cooldownMs = cooldownSeconds * 1000;
            const expirationThreshold = cooldownMs + 500;

            if (timeSinceStart >= expirationThreshold) {
              newPersistent.delete(personId);
              hasChanges = true;
            }
          }

          persistentCooldownsRef.current = hasChanges ? newPersistent : prev;
          return hasChanges ? newPersistent : prev;
        });
      });
    };

    const scheduleUpdate = () => {
      const now = Date.now();
      if (now - lastUpdateTime >= updateInterval) {
        updateCooldowns();
        lastUpdateTime = now;

        if (persistentCooldownsRef.current.size === 0) {
          rafId = null;
          return;
        }
      }
      rafId = requestAnimationFrame(scheduleUpdate);
    };

    const startUpdate = () => {
      if (rafId === null && persistentCooldownsRef.current.size > 0) {
        rafId = requestAnimationFrame(scheduleUpdate);
      }
    };

    startUpdate();
    const checkInterval = setInterval(() => {
      if (persistentCooldownsRef.current.size > 0 && rafId === null) {
        startUpdate();
      }
    }, 1000);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      clearInterval(checkInterval);
    };
  }, [attendanceCooldownSeconds, setPersistentCooldowns]);

  return {
    persistentCooldownsRef,
  };
}
