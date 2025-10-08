import type { CooldownInfo } from '../types';

interface CooldownListProps {
  trackingMode: 'auto' | 'manual';
  persistentCooldowns: Map<string, CooldownInfo>;
  attendanceCooldownSeconds: number;
  currentTime: number;
}

export function CooldownList({
  trackingMode,
  persistentCooldowns,
  attendanceCooldownSeconds,
  currentTime,
}: CooldownListProps) {
  if (trackingMode !== 'auto' || persistentCooldowns.size === 0) {
    return null;
  }

  return (
    <div className="p-4 border-b border-white/[0.08] flex-shrink-0">
      <div className="text-xs font-medium text-white/60 mb-2">Active Cooldowns:</div>
      <div className="space-y-1">
        {Array.from(persistentCooldowns.values()).map((cooldownInfo) => {
          const now = Date.now();
          const timeSinceStart = now - cooldownInfo.startTime;
          const cooldownMs = attendanceCooldownSeconds * 1000;

          if (timeSinceStart >= 0 && timeSinceStart < cooldownMs) {
            const remainingCooldown = Math.max(1, Math.ceil((cooldownMs - timeSinceStart) / 1000));

            return (
              <div key={cooldownInfo.personId} className="flex items-center justify-between bg-red-900/20 border border-red-500/30 rounded px-2 py-1">
                <span className="text-xs text-red-300">{cooldownInfo.memberName || cooldownInfo.personId}</span>
                <span className="text-xs text-red-300 font-mono">📝 {remainingCooldown}s</span>
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

