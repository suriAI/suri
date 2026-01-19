interface DatabaseStatsProps {
  groupsCount: number;
  totalMembers: number;
  totalPersons: number;
}

export function DatabaseStats({
  groupsCount,
  totalMembers,
  totalPersons,
}: DatabaseStatsProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="rounded-lg p-4 bg-white/5 border border-white/10">
        <div className="text-xs text-white/50 mb-1">Total Groups</div>
        <div className="text-2xl font-semibold text-white">{groupsCount}</div>
      </div>
      <div className="rounded-lg p-4 bg-white/5 border border-white/10">
        <div className="text-xs text-white/50 mb-1">Total Members</div>
        <div className="text-2xl font-semibold text-white">{totalMembers}</div>
      </div>
      <div className="rounded-lg p-4 bg-white/5 border border-white/10">
        <div className="text-xs text-white/50 mb-1">Registered Faces</div>
        <div className="text-2xl font-semibold text-white">{totalPersons}</div>
      </div>
    </div>
  );
}
