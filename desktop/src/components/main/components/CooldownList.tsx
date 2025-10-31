import { memo, useMemo } from 'react';
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
  // Memoize active cooldowns to prevent recalculation on every render
  const activeCooldowns = useMemo(() => {
    const now = Date.now();
    const cooldownMs = attendanceCooldownSeconds * 1000;
    const active: Array<{ info: CooldownInfo; remaining: number }> = [];

    for (const cooldownInfo of persistentCooldowns.values()) {
      const timeSinceStart = now - cooldownInfo.startTime;
      if (timeSinceStart >= 0 && timeSinceStart < cooldownMs) {
        const remainingCooldown = Math.max(1, Math.ceil((cooldownMs - timeSinceStart) / 1000));
        active.push({ info: cooldownInfo, remaining: remainingCooldown });
      }
    }

    return active;
  }, [persistentCooldowns, attendanceCooldownSeconds]);

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
