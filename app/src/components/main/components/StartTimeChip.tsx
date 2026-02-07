import { useState, useRef, useEffect } from "react";

interface StartTimeChipProps {
  startTime: string; // "HH:MM" format
  onTimeChange: (newTime: string) => void;
  disabled?: boolean;
}

/**
 * Inline time chip for the control bar.
 * Premium glassmorphism design with digital typography.
 */
export function StartTimeChip({
  startTime,
  onTimeChange,
  disabled = false,
}: StartTimeChipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Format time for display (e.g., "08:00" -> "8:00 AM")
  const formatTimeDisplay = (
    time: string,
  ): {
    time: string;
    period: string;
  } => {
    try {
      const [hours, minutes] = time.split(":").map(Number);
      const period = hours >= 12 ? "PM" : "AM";
      const displayHours = hours % 12 || 12;
      return {
        time: `${displayHours}:${String(minutes).padStart(2, "0")}`,
        period,
      };
    } catch {
      return { time, period: "" };
    }
  };

  // handleConfirm removed - now using auto-save

  const handleSetNow = () => {
    const now = new Date();
    const nowTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    onTimeChange(nowTime);
    // Don't close on "Now" click, let user see it updated
    // setIsOpen(false);
  };

  // Check if the set time seems outdated (>6 hours from now)
  const isTimeOutdated = (): boolean => {
    try {
      const [hours, minutes] = startTime.split(":").map(Number);
      const now = new Date();
      const setTime = new Date();
      setTime.setHours(hours, minutes, 0, 0);

      const diffMs = Math.abs(now.getTime() - setTime.getTime());
      const diffHours = diffMs / (1000 * 60 * 60);
      return diffHours > 6;
    } catch {
      return false;
    }
  };

  const outdated = isTimeOutdated();
  const { time, period } = formatTimeDisplay(startTime);

  return (
    <div ref={containerRef} className="relative">
      {/* Chip Button */}
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`group overflow-hidden relative flex items-center gap-2.5 px-3 py-1.5 rounded-lg transition-all duration-300 ${
          disabled
            ? "bg-white/5 text-white/30 cursor-not-allowed border border-white/5"
            : isOpen
              ? "bg-black/80 border border-cyan-500/50 shadow-[0_0_15px_-3px_rgba(6,182,212,0.3)]"
              : outdated
                ? "bg-amber-900/20 border border-amber-500/30 text-amber-200 hover:bg-amber-900/30 hover:border-amber-500/50"
                : "bg-black/40 backdrop-blur-md border border-white/10 hover:bg-white/[0.07] hover:border-white/20 text-white/90"
        }`}
        title={
          outdated
            ? "Start time may be outdated - click to update"
            : "Click to adjust session start time"
        }
      >
        <div className="flex items-baseline gap-1">
          <span
            className={`font-mono text-base font-light tracking-tight ${
              outdated ? "text-amber-300" : "text-white"
            }`}
          >
            {time}
          </span>
          <span
            className={`text-[10px] font-medium uppercase ${
              outdated ? "text-amber-400/70" : "text-white/50"
            }`}
          >
            {period}
          </span>
        </div>

        {/* Warning Indicator (Only show if outdated) */}
        {outdated && (
          <div className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/10 border border-amber-500/20">
            <i className="fa-solid fa-triangle-exclamation text-[10px] text-amber-400 animate-pulse"></i>
          </div>
        )}
      </button>

      {/* Dropdown Picker - Stealth Minimalist (v5) */}
      {isOpen && (
        <div className="absolute bottom-full right-0 mb-3 bg-[#050505]/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.8)] p-3 min-w-[200px] z-50 animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-200 origin-bottom-right">
          {/* Header & Minimal Now Action */}
          <div className="flex items-center justify-between mb-3 px-1">
            <span
              className="text-[9px] text-white/20 uppercase tracking-[0.2em] font-bold cursor-help"
              title="Attendance is tracked relative to this scheduled time"
            >
              Start Time
            </span>
            <button
              onClick={handleSetNow}
              className="group/now focus:outline-none !bg-transparent !border-none !p-0 !shadow-none"
              title="Set to Current Time"
            >
              <i className="fa-solid fa-arrows-rotate text-white/20 hover:text-cyan-400 text-xs transition-colors group-hover/now:rotate-180 duration-500"></i>
            </button>
          </div>

          {/* Digital Time Display (Compact & Clean) */}
          <div className="relative group rounded-xl overflow-hidden bg-white/[0.03] hover:bg-white/[0.05] border border-white/5 hover:border-white/10 transition-colors">
            <input
              type="time"
              value={startTime}
              onChange={(e) => onTimeChange(e.target.value)}
              onClick={(e) => e.currentTarget.showPicker()}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 focus:outline-none"
            />
            <div className="py-3 px-4 text-center pointer-events-none">
              <div className="font-mono text-3xl text-white font-light tracking-widest flex justify-center items-baseline gap-1.5">
                <span>{formatTimeDisplay(startTime).time}</span>
                <span className="text-xs text-white/30 font-sans font-bold uppercase tracking-wider">
                  {formatTimeDisplay(startTime).period}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
