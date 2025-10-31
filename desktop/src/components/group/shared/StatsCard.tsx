interface StatsCardProps {
  type: 'present' | 'absent' | 'late' | 'active';
  value: number;
  total?: number;
  label?: string;
}

export function StatsCard({ type, value, total, label }: StatsCardProps) {
  const config = {
    present: {
      accent: 'bg-emerald-400/70',
      label: label || 'Present Today',
      sublabel: total ? `out of ${total} members` : undefined,
      border: 'border-white/10',
      bg: 'bg-white/5',
      valueColor: 'text-white',
      labelColor: 'text-white/60',
      subColor: 'text-white/40'
    },
    absent: {
      accent: 'bg-rose-400/70',
      label: label || 'Absent Today',
      sublabel: 'no check-in record',
      border: 'border-white/10',
      bg: 'bg-white/5',
      valueColor: 'text-white',
      labelColor: 'text-white/60',
      subColor: 'text-white/40'
    },
    late: {
      accent: 'bg-amber-400/80',
      label: label || 'Late Today',
      sublabel: 'exceeded late threshold',
      border: 'border-white/10',
      bg: 'bg-white/5',
      valueColor: 'text-white',
      labelColor: 'text-white/60',
      subColor: 'text-white/40'
    },
    active: {
      accent: 'bg-sky-400/80',
      label: label || 'Active Now',
      sublabel: undefined,
      border: 'border-white/10',
      bg: 'bg-white/5',
      valueColor: 'text-white',
      labelColor: 'text-white/60',
      subColor: 'text-white/40'
    }
  }[type];

  return (
    <div className={`rounded-xl border ${config.border} ${config.bg} p-4`}>
      <p className={`text-xs ${config.labelColor} uppercase tracking-wider`}>{config.label}</p>
      <div className={`text-2xl font-semibold ${config.valueColor} mt-1`}>{value ?? 0}</div>
      {config.sublabel && (
        <p className={`text-[10px] ${config.subColor} mt-1`}>{config.sublabel}</p>
      )}
    </div>
  );
}

