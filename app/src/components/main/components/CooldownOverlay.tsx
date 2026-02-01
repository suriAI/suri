import { memo, useMemo, useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { CooldownInfo } from "@/components/main/types";

interface CooldownOverlayProps {
  trackingMode: "auto" | "manual";
  persistentCooldowns: Map<string, CooldownInfo>;
  attendanceCooldownSeconds: number;
}

const CooldownCard = memo(
  ({ cooldownInfo }: { cooldownInfo: CooldownInfo }) => {
    const name = cooldownInfo.memberName || cooldownInfo.personId;

    return (
      <motion.div
        layout
        initial={{ opacity: 0, x: 20, scale: 0.95 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className="group flex items-center gap-3 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl p-3 pr-4 shadow-lg hover:bg-black/80 hover:border-white/20"
        style={{ minWidth: "180px" }}
      >
        {/* Success Icon */}
        <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-green-500/20 text-green-400">
          <i className="fa-solid fa-check text-sm"></i>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-white/90 truncate max-w-[140px] block">
            {name}
          </span>
          <span className="text-[10px] text-white/50 uppercase tracking-wider font-semibold">
            Logged
          </span>
        </div>
      </motion.div>
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
    <div className="absolute top-6 right-6 z-40 flex flex-col gap-3 pointer-events-auto select-none max-h-[80vh] overflow-y-auto overflow-x-hidden custom-scroll p-2">
      {/* pointer-events-auto to allow scrolling */}
      <AnimatePresence mode="popLayout">
        {activeItems.map((item) => (
          <CooldownCard key={item.info.personId} cooldownInfo={item.info} />
        ))}
      </AnimatePresence>
    </div>
  );
});
