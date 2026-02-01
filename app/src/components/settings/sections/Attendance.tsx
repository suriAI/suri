import type { AttendanceSettings } from "@/components/settings/types";

interface AttendanceProps {
  attendanceSettings: AttendanceSettings;
  onTrackingModeChange: (mode: "auto" | "manual") => void;
  onLateThresholdChange: (minutes: number) => void;
  onLateThresholdToggle: (enabled: boolean) => void;
  onClassStartTimeChange: (time: string) => void;
  onReLogCooldownChange: (seconds: number) => void;
  onSpoofDetectionToggle: (enabled: boolean) => void;
  isStreaming?: boolean;
}

export function Attendance({
  attendanceSettings,
  onTrackingModeChange,
  onLateThresholdChange,
  onLateThresholdToggle,
  onClassStartTimeChange,
  onReLogCooldownChange,
  onSpoofDetectionToggle,
  isStreaming = false,
}: AttendanceProps) {
  // Calculate late time by adding minutes to class start time
  const calculateLateTime = (startTime: string, minutes: number): string => {
    try {
      const [hours, mins] = startTime.split(":").map(Number);
      let totalMinutes = hours * 60 + mins + minutes;
      // Handle day overflow (wrap around to next day)
      if (totalMinutes < 0) totalMinutes += 24 * 60;
      totalMinutes = totalMinutes % (24 * 60);
      const finalHours = Math.floor(totalMinutes / 60);
      const finalMins = totalMinutes % 60;
      return `${String(finalHours).padStart(2, "0")}:${String(finalMins).padStart(2, "0")}`;
    } catch {
      return startTime;
    }
  };

  const lateTime = calculateLateTime(
    attendanceSettings.classStartTime,
    attendanceSettings.lateThresholdMinutes,
  );

  return (
    <div className="space-y-4 max-w-3xl p-6">
      {/* Tracking Mode Section */}
      <div className="flex items-center py-3 border-b border-white/5 gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white/90">
            Capture Method
          </div>
          <div className="text-xs text-white/50 mt-0.5">
            {attendanceSettings.trackingMode === "auto"
              ? "Automatic detection"
              : "Manual confirmation"}
          </div>
        </div>

        <button
          onClick={() =>
            onTrackingModeChange(
              attendanceSettings.trackingMode === "auto" ? "manual" : "auto",
            )
          }
          className={`relative w-11 h-6 rounded-full focus:outline-none transition-colors duration-150 flex-shrink-0 flex items-center ml-auto ${
            attendanceSettings.trackingMode === "manual"
              ? "bg-cyan-500/30"
              : "bg-white/10"
          }`}
        >
          <div
            className={`absolute left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-150 ${
              attendanceSettings.trackingMode === "manual"
                ? "translate-x-5"
                : "translate-x-0"
            }`}
          ></div>
        </button>
      </div>

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
          disabled={isStreaming}
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
            disabled={isStreaming}
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
              Track late arrivals
            </div>
          </div>

          <button
            onClick={() =>
              onLateThresholdToggle(!attendanceSettings.lateThresholdEnabled)
            }
            disabled={isStreaming}
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
        {attendanceSettings.lateThresholdEnabled && (
          <>
            <div className="flex items-center py-3 border-b border-white/5 gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white/90">
                  Start Time
                </div>
                <div className="text-xs text-white/50 mt-0.5">
                  Session begins at
                </div>
              </div>

              <input
                type="time"
                value={attendanceSettings.classStartTime}
                onChange={(e) => onClassStartTimeChange(e.target.value)}
                disabled={isStreaming}
                className="px-3 py-2 bg-white/5 text-white text-sm border border-white/10 rounded-md focus:border-amber-500/50 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0 ml-auto"
              />
            </div>

            {/* Late Threshold */}
            <div className="flex items-center py-3 border-b border-white/5 gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white/90">
                  Late Time
                </div>
                <div className="text-xs text-white/50 mt-0.5">
                  Late from {lateTime}
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
                  disabled={isStreaming}
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
