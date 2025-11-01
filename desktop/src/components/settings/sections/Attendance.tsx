import type { AttendanceSettings } from '../types';

interface AttendanceProps {
  attendanceSettings: AttendanceSettings;
  onTrackingModeChange: (mode: 'auto' | 'manual') => void;
  onLateThresholdChange: (minutes: number) => void;
  onLateThresholdToggle: (enabled: boolean) => void;
  onClassStartTimeChange: (time: string) => void;
  onCooldownChange: (seconds: number) => void;
  onSpoofDetectionToggle: (enabled: boolean) => void;
  isStreaming?: boolean;
}

export function Attendance({
  attendanceSettings,
  onTrackingModeChange,
  onLateThresholdChange,
  onLateThresholdToggle,
  onClassStartTimeChange,
  onCooldownChange,
  onSpoofDetectionToggle,
  isStreaming = false,
}: AttendanceProps) {
  return (
    <div className="space-y-4 max-w-2xl">
      {/* Tracking Mode Section */}
      <div className="flex items-center justify-between py-3 border-b border-white/5 gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white/90">Capture Method</div>
          <div className="text-xs text-white/50 mt-0.5">
            {attendanceSettings.trackingMode === 'auto' 
              ? 'Automatic detection' 
              : 'Manual confirmation'}
          </div>
        </div>
        
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-xs whitespace-nowrap transition-colors duration-150 ${attendanceSettings.trackingMode === 'auto' ? 'text-white' : 'text-white/40'}`}>
            Auto
          </span>
          <button
            onClick={() => onTrackingModeChange(attendanceSettings.trackingMode === 'auto' ? 'manual' : 'auto')}
            className={`relative w-11 h-6 rounded-full focus:outline-none transition-colors duration-150 flex items-center ${
              attendanceSettings.trackingMode === 'auto' ? 'bg-emerald-500/30' : 'bg-white/10'
            }`}
          >
            <div className={`absolute left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-150 ${
              attendanceSettings.trackingMode === 'auto' ? 'translate-x-0' : 'translate-x-5'
            }`}></div>
          </button>
          <span className={`text-xs whitespace-nowrap transition-colors duration-150 ${attendanceSettings.trackingMode === 'manual' ? 'text-white' : 'text-white/40'}`}>
            Manual
          </span>
        </div>
      </div>

      {/* Spoof Detection Section */}
      <div className="flex items-center justify-between py-3 border-b border-white/5 gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white/90">Anti-Spoof Detection</div>
          <div className="text-xs text-white/50 mt-0.5">
            {attendanceSettings.enableSpoofDetection 
              ? 'Protection enabled - blocks photo/video attacks' 
              : 'Disabled - accepts all faces'}
          </div>
        </div>
        
        <button
          onClick={() => onSpoofDetectionToggle(!attendanceSettings.enableSpoofDetection)}
          disabled={isStreaming}
          className={`relative w-11 h-6 rounded-full focus:outline-none transition-colors duration-150 flex-shrink-0 flex items-center ${
            attendanceSettings.enableSpoofDetection ? 'bg-red-500/30' : 'bg-white/10'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <div className={`absolute left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-150 ${
            attendanceSettings.enableSpoofDetection ? 'translate-x-5' : 'translate-x-0'
          }`}></div>
        </button>
      </div>

      {/* Attendance Cooldown Section */}
      <div className="flex items-center justify-between py-3 border-b border-white/5 gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white/90">Attendance Cooldown</div>
          <div className="text-xs text-white/50 mt-0.5">
            Prevent duplicate logs: {attendanceSettings.attendanceCooldownSeconds}s
          </div>
        </div>
        
        <div className="flex items-center gap-3 flex-shrink-0">
          <input
            type="range"
            min="3"
            max="60"
            step="1"
            value={attendanceSettings.attendanceCooldownSeconds}
            onChange={(e) => onCooldownChange(parseInt(e.target.value))}
            disabled={isStreaming}
            className="w-24 accent-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <span className="text-cyan-400 font-semibold text-sm min-w-[2.5rem] text-right whitespace-nowrap">
            {attendanceSettings.attendanceCooldownSeconds}s
          </span>
        </div>
      </div>

      {/* Late Tracking Section */}
      <div className="space-y-4">
          {/* Enable/Disable Toggle */}
          <div className="flex items-center justify-between py-3 border-b border-white/5 gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white/90">Late</div>
              <div className="text-xs text-white/50 mt-0.5">Track late arrivals</div>
            </div>
            
            <button
              onClick={() => onLateThresholdToggle(!attendanceSettings.lateThresholdEnabled)}
              disabled={isStreaming}
              className={`relative w-11 h-6 rounded-full focus:outline-none transition-colors duration-150 flex-shrink-0 flex items-center ${
                attendanceSettings.lateThresholdEnabled ? 'bg-amber-500/30' : 'bg-white/10'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <div className={`absolute left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-150 ${
                attendanceSettings.lateThresholdEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}></div>
            </button>
          </div>

          {/* Class Start Time */}
          {attendanceSettings.lateThresholdEnabled && (
            <>
              <div className="flex items-center justify-between py-3 border-b border-white/5 gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white/90">Start Time</div>
                  <div className="text-xs text-white/50 mt-0.5">Session begins at</div>
                </div>
                
                <input
                  type="time"
                  value={attendanceSettings.classStartTime}
                  onChange={(e) => onClassStartTimeChange(e.target.value)}
                  disabled={isStreaming}
                  className="px-3 py-2 bg-white/5 text-white text-sm border border-white/10 rounded-md focus:border-amber-500/50 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                />
              </div>

              {/* Late Threshold */}
              <div className="flex items-center justify-between py-3 border-b border-white/5 gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white/90">Late After</div>
                  <div className="text-xs text-white/50 mt-0.5">
                    {attendanceSettings.lateThresholdMinutes} minutes after start time
                  </div>
                </div>
                
                <div className="flex items-center gap-3 flex-shrink-0">
                  <input
                    type="range"
                    min="5"
                    max="60"
                    step="5"
                    value={attendanceSettings.lateThresholdMinutes}
                    onChange={(e) => onLateThresholdChange(parseInt(e.target.value))}
                    disabled={isStreaming}
                    className="w-24 accent-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <span className="text-amber-400 font-semibold text-sm min-w-[2.5rem] text-right whitespace-nowrap">
                    {attendanceSettings.lateThresholdMinutes} min
                  </span>
                </div>
              </div>

              <div className="mt-2 p-3 rounded-md bg-amber-500/5 border border-amber-500/20">
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" strokeWidth={2}/>
                  </svg>
                  <div className="text-xs text-amber-200/80">
                    Late status applied after {attendanceSettings.classStartTime} +{attendanceSettings.lateThresholdMinutes}min
                  </div>
                </div>
              </div>
            </>
          )}
      </div>
    </div>
  );
}

