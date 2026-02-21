import type { AttendanceSettings } from "@/components/settings/types";

interface AttendanceProps {
  attendanceSettings: AttendanceSettings;
  onLateThresholdChange: (minutes: number) => void;
  onLateThresholdToggle: (enabled: boolean) => void;
  onReLogCooldownChange: (seconds: number) => void;
  onSpoofDetectionToggle: (enabled: boolean) => void;
  hasSelectedGroup?: boolean;
}

export function Attendance({
  attendanceSettings,
  onLateThresholdChange,
  onLateThresholdToggle,
  onReLogCooldownChange,
  onSpoofDetectionToggle,
  hasSelectedGroup = false,
}: AttendanceProps) {
  return (
    <div className="space-y-4 max-w-3xl p-6">
      {/* Spoof Detection Section */}
      <div className="flex items-center py-3 border-b border-white/5 gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white/90">
            Anti-Spoof Detection
          </div>
          <div className="text-xs text-white/50 mt-0.5">
            {attendanceSettings.enableSpoofDetection
              ? "Protection enabled - blocks photo/video attacks"
              : "Disabled - accepts all faces"}
          </div>
        </div>

        <button
          onClick={() =>
            onSpoofDetectionToggle(!attendanceSettings.enableSpoofDetection)
          }
          className={`relative w-11 h-6 rounded-full focus:outline-none transition-colors duration-150 flex-shrink-0 flex items-center ml-auto ${
            attendanceSettings.enableSpoofDetection
              ? "bg-cyan-500/30"
              : "bg-white/10"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <div
            className={`absolute left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-150 ${
              attendanceSettings.enableSpoofDetection
                ? "translate-x-5"
                : "translate-x-0"
            }`}
          ></div>
        </button>
      </div>

      {/* Attendance Cooldown (Re-Log Prevention) */}
      <div className="flex items-center py-3 border-b border-white/5 gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white/90">
            Attendance Cooldown
          </div>
          <div className="text-xs text-white/50 mt-0.5">
            Prevent duplicate logs for:{" "}
            {Math.floor((attendanceSettings.reLogCooldownSeconds ?? 1800) / 60)}{" "}
            min
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0 ml-auto">
          <input
            type="range"
            min="300" // 5 mins
            max="7200" // 2 hours
            step="300" // 5 min steps
            value={attendanceSettings.reLogCooldownSeconds ?? 1800}
            onChange={(e) => onReLogCooldownChange(parseInt(e.target.value))}
            className="w-24 accent-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <span className="text-cyan-400 font-semibold text-sm min-w-[2.5rem] text-right whitespace-nowrap">
            {Math.floor((attendanceSettings.reLogCooldownSeconds ?? 1800) / 60)}{" "}
            m
          </span>
        </div>
      </div>

      {/* Late Tracking Section */}
      <div className="space-y-4">
        {/* Enable/Disable Toggle */}
        <div className="flex items-center py-3 border-b border-white/5 gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white/90">Late</div>
            <div className="text-xs text-white/50 mt-0.5">
              {!hasSelectedGroup
                ? "Select a group to enable late tracking"
                : "Track late arrivals"}
            </div>
          </div>

          <button
            onClick={() =>
              onLateThresholdToggle(!attendanceSettings.lateThresholdEnabled)
            }
            disabled={!hasSelectedGroup}
            className={`relative w-11 h-6 rounded-full focus:outline-none transition-colors duration-150 flex-shrink-0 flex items-center ml-auto ${
              attendanceSettings.lateThresholdEnabled
                ? "bg-cyan-500/30"
                : "bg-white/10"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <div
              className={`absolute left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-150 ${
                attendanceSettings.lateThresholdEnabled
                  ? "translate-x-5"
                  : "translate-x-0"
              }`}
            ></div>
          </button>
        </div>

        {/* Class Start Time */}
        {attendanceSettings.lateThresholdEnabled && hasSelectedGroup && (
          <>
            {/* Scheduled Start removed - now handled via main UI chip */}

            {/* Late Threshold */}
            <div className="flex items-center py-3 border-b border-white/5 gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white/90">
                  Late Threshold
                </div>
                <div className="text-xs text-white/50 mt-0.5">
                  Marked as Late after {attendanceSettings.lateThresholdMinutes}{" "}
                  minutes
                </div>
              </div>

              <div className="flex items-center gap-3 flex-shrink-0 ml-auto">
                <input
                  type="range"
                  min="5"
                  max="60"
                  step="5"
                  value={attendanceSettings.lateThresholdMinutes}
                  onChange={(e) =>
                    onLateThresholdChange(parseInt(e.target.value))
                  }
                  className="w-24 accent-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <span className="text-cyan-400 font-semibold text-sm min-w-[2.5rem] text-right whitespace-nowrap">
                  {attendanceSettings.lateThresholdMinutes} min
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
