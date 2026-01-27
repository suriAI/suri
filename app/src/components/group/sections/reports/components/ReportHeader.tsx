interface ReportHeaderProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  daysTracked: number;
  loading: boolean;
}

export function ReportHeader({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  daysTracked,
  loading,
}: ReportHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 flex-shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex bg-white/5 border border-white/5 rounded-lg p-0.5 items-center">
          <label className="flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-white/5 transition-colors rounded-md">
            <span className="text-[9px] uppercase font-bold tracking-widest text-white/20">
              From
            </span>
            <input
              type="date"
              value={startDate}
              onChange={(event) => onStartDateChange(event.target.value)}
              className="bg-transparent focus:outline-none text-[11px] font-bold text-white/80 cursor-pointer w-[110px]"
              style={{ colorScheme: "dark" }}
            />
          </label>
          <div className="w-px h-3 bg-white/5" />
          <label className="flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-white/5 transition-colors rounded-md">
            <span className="text-[9px] uppercase font-bold tracking-widest text-white/20">
              To
            </span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => onEndDateChange(event.target.value)}
              className="bg-transparent focus:outline-none text-[11px] font-bold text-white/80 cursor-pointer w-[110px]"
              style={{ colorScheme: "dark" }}
            />
          </label>
        </div>
      </div>

      {!loading && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-500/5 border border-cyan-500/10 shadow-sm">
          <div className="flex items-center justify-center w-5 h-5 rounded-md bg-cyan-500/10 text-cyan-400">
            <i className="fa-solid fa-calendar-check text-[9px]"></i>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-bold text-cyan-100/90 leading-none">
              {daysTracked} {daysTracked === 1 ? "Day" : "Days"}
            </span>
            <span className="text-[8px] font-bold uppercase tracking-widest text-cyan-500/40 leading-none mt-0.5">
              Tracked
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
