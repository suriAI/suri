import { memo, useMemo, useState, useEffect } from 'react';
import type { CooldownInfo } from '../types';

interface CooldownListProps {
  trackingMode: 'auto' | 'manual';
  persistentCooldowns: Map<string, CooldownInfo>;
  attendanceCooldownSeconds: number;
}

// Memoize individual cooldown item to prevent unnecessary re-renders
const CooldownItem = memo(({ 
  cooldownInfo, 
  remainingCooldown 
}: { 
  cooldownInfo: CooldownInfo; 
  remainingCooldown: number;
}) => (
  <div className="flex items-center justify-between bg-red-900/20 border border-red-500/30 rounded px-2 py-1">
    <span className="text-xs text-red-300">{cooldownInfo.memberName || cooldownInfo.personId}</span>
    <span className="text-xs text-red-300 font-mono">{remainingCooldown}s</span>
  </div>
));

CooldownItem.displayName = 'CooldownItem';

export const CooldownList = memo(function CooldownList({
  trackingMode,
  persistentCooldowns,
  attendanceCooldownSeconds,
}: CooldownListProps) {
  // Force re-render every second for continuous countdown
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    // Update every second to recalculate remaining time
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const activeCooldowns = useMemo(() => {
    const now = currentTime;
    const active: Array<{ info: CooldownInfo; remaining: number }> = [];

    for (const cooldownInfo of persistentCooldowns.values()) {
      const timeSinceStart = now - cooldownInfo.startTime;
      
      // Use stored cooldown duration to prevent premature removal when setting changes
      const cooldownSecondsForThisCooldown = cooldownInfo.cooldownDurationSeconds ?? attendanceCooldownSeconds;
      const cooldownMsForThisCooldown = cooldownSecondsForThisCooldown * 1000;
      const expirationThreshold = cooldownMsForThisCooldown + 500;
      
      if (timeSinceStart >= 0 && timeSinceStart < expirationThreshold) {
        const remainingMs = cooldownMsForThisCooldown - timeSinceStart;
        
        let remainingCooldown: number;
        if (remainingMs <= 0) {
          remainingCooldown = 0;
        } else {
          remainingCooldown = Math.ceil(remainingMs / 1000);
          if (remainingCooldown === 0 && remainingMs > 0) {
            remainingCooldown = 1;
          }
        }
        
        active.push({ info: cooldownInfo, remaining: remainingCooldown });
      }
    }

    active.sort((a, b) => a.remaining - b.remaining);
    return active;
  }, [persistentCooldowns, attendanceCooldownSeconds, currentTime]);

  if (trackingMode !== 'auto' || activeCooldowns.length === 0) {
    return null;
  }

  return (
    <div className="p-4 border-b border-white/[0.08] flex-shrink-0">
      <div className="text-xs font-medium text-white/60 mb-2">Active Cooldowns:</div>
      <div className="space-y-1">
        {activeCooldowns.map(({ info, remaining }) => (
          <CooldownItem 
            key={info.personId} 
            cooldownInfo={info} 
            remainingCooldown={remaining} 
          />
        ))}
      </div>
    </div>
  );
});
