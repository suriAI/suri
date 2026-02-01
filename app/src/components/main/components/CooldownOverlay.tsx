import { memo, useMemo, useState, useEffect } from "react";
import type { CooldownInfo } from "@/components/main/types";

interface CooldownOverlayProps {
  trackingMode: "auto" | "manual";
  persistentCooldowns: Map<string, CooldownInfo>;
  attendanceCooldownSeconds: number;
}

const CooldownCard = memo(
  ({
    cooldownInfo,
    startDuration,
    remaining,
  }: {
    cooldownInfo: CooldownInfo;
    startDuration: number;
    remaining: number;
  }) => {
    // Calculate progress percentage (100% full at start, 0% at end)
    // Avoid division by zero
    const progress = startDuration > 0 ? (remaining / startDuration) * 100 : 0;

    // Circular progress math
    const radius = 10;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (progress / 100) * circumference;

    const name = cooldownInfo.memberName || cooldownInfo.personId;

    return (
      <div
        className="group flex items-center gap-3 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl p-3 pr-4 shadow-lg transition-all duration-300 hover:bg-black/80 hover:border-white/20 animate-in slide-in-from-right-4 fade-in-0"
        style={{ minWidth: "200px" }}
      >
        {/* Info */}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-white/90 truncate max-w-[120px] block">
            {name}
          </span>
        </div>

        {/* Circular Timer */}
        <div className="relative w-8 h-8 flex items-center justify-center">
          {/* Background circle */}
          <svg className="w-full h-full rotate-[-90deg]">
            <circle
              cx="50%"
              cy="50%"
              r={radius}
              fill="transparent"
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="2.5"
            />
            {/* Progress circle */}
            <circle
              cx="50%"
              cy="50%"
              r={radius}
              fill="transparent"
              stroke={remaining < 3 ? "#ef4444" : "#3b82f6"} // Red if < 3s, else Blue
              strokeWidth="2.5"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              className="transition-[stroke-dashoffset] duration-300 ease-linear"
            />
          </svg>
          <span className="absolute text-[9px] font-mono font-bold text-white/80">
            {Math.ceil(remaining)}s
          </span>
        </div>
      </div>
    );
  },
);

CooldownCard.displayName = "CooldownCard";

export const CooldownOverlay = memo(function CooldownOverlay({
  trackingMode,
  persistentCooldowns,
  attendanceCooldownSeconds,
}: CooldownOverlayProps) {
  // Drives the re-render loop for the visual countdown
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    // 10fps update for smoother progress circle
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 100);

    return () => clearInterval(interval);
  }, []);

  const activeItems = useMemo(() => {
    // Filter and prepare items
    const items: Array<{
      info: CooldownInfo;
      duration: number;
      remaining: number;
    }> = [];
    const now = currentTime;

    for (const info of persistentCooldowns.values()) {
      const durationSeconds =
        info.cooldownDurationSeconds ?? attendanceCooldownSeconds;
      const durationMs = durationSeconds * 1000;
      const elapsed = now - info.startTime;
      const remainingMs = durationMs - elapsed;

      // Show items that have at least 0.1s remaining to process exit animation logic upstream if needed
      // (Visuals will effectively hide < 0)
      if (remainingMs > 0) {
        items.push({
          info,
          duration: durationSeconds,
          remaining: remainingMs / 1000, // Keep precise for smooth animation
        });
      }
    }

    // Sort: Least time remaining at the top? Or most recent at top?
    // User requested "best UI/UX".
    // Usually, sorting by "soonest to expire" at the top is helpful to know who is becoming available.
    // Or maybe insert order (Start time descending).
    // Let's sort by remaining time ascending (soonest to finish first).
    items.sort((a, b) => a.remaining - b.remaining);

    return items;
  }, [persistentCooldowns, attendanceCooldownSeconds, currentTime]);

  if (trackingMode !== "auto" || activeItems.length === 0) {
    return null;
  }

  return (
    <div className="absolute top-6 right-6 z-40 flex flex-col gap-3 pointer-events-auto select-none max-h-[80vh] overflow-y-auto custom-scroll pr-2">
      {/* pointer-events-auto to allow scrolling */}
      {activeItems.map((item) => (
        <CooldownCard
          key={item.info.personId}
          cooldownInfo={item.info}
          startDuration={item.duration}
          remaining={item.remaining}
        />
      ))}
    </div>
  );
});
