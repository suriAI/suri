interface ControlBarProps {
  cameraDevices: MediaDeviceInfo[];
  selectedCamera: string;
  setSelectedCamera: (deviceId: string) => void;
  isStreaming: boolean;
  trackingMode: 'auto' | 'manual';
  setTrackingMode: (mode: 'auto' | 'manual') => void;
  startCamera: () => void;
  stopCamera: () => void;
  // Late threshold functionality
  lateThresholdMinutes: number;
  onLateThresholdChange: (minutes: number) => void;
  lateThresholdEnabled: boolean;
  onLateThresholdToggle: (enabled: boolean) => void;
  // Start time functionality
  classStartTime: string;
  onClassStartTimeChange: (time: string) => void;
}

export function ControlBar({
  cameraDevices,
  selectedCamera,
  setSelectedCamera,
  isStreaming,
  trackingMode,
  setTrackingMode,
  startCamera,
  stopCamera,
  lateThresholdMinutes,
  onLateThresholdChange,
  lateThresholdEnabled,
  onLateThresholdToggle,
  classStartTime,
  onClassStartTimeChange,
}: ControlBarProps) {
  return (
    <div>
      <div className="rounded-lg p-6 flex items-center justify-between min-h-[4rem]">
        <div className="flex items-center space-x-6">
          {/* Camera Selection */}
          {cameraDevices.length > 0 && (
            <div className="flex flex-col items-start space-y-1">
              <select
                value={selectedCamera}
                onChange={(e) => setSelectedCamera(e.target.value)}
                disabled={isStreaming || cameraDevices.length <= 1}
                className="bg-white/[0.05] text-white text-base border border-white/[0.1] rounded-lg px-4 py-3 focus:border-white/20 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed min-w-[200px] transition-all duration-300 ease-in-out hover:bg-white/[0.08]"
              >
                {cameraDevices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId} className="bg-black text-white">
                    {device.label || `Camera ${index + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center space-x-2">
            <div className={`w-3 h-3 rounded-full ${isStreaming ? 'bg-green-400' : 'bg-red-400'}`}></div>
          </div>

          {/* Late Tracking Settings - Compact Design */}
          <div className="flex items-center space-x-4">
            {/* Toggle with Label */}
            <div className="flex items-center space-x-2">
              <span className="text-white/60 text-xs font-medium">Late Tracking</span>
              <button
                onClick={() => onLateThresholdToggle(!lateThresholdEnabled)}
                className={`relative w-8 h-4 rounded-full focus:outline-none flex items-center transition-all duration-300 ease-in-out ${
                  lateThresholdEnabled ? 'bg-amber-500/40' : 'bg-white/10'
                }`}
              >
                <div className={`absolute left-0.5 w-3 h-3 bg-white rounded-full shadow-md transition-transform duration-300 ease-in-out ${
                  lateThresholdEnabled ? 'translate-x-4' : 'translate-x-0'
                }`}></div>
              </button>
            </div>

            {/* Settings - Only show when enabled */}
            {lateThresholdEnabled && (
              <div className="flex items-center space-x-3 animate-in slide-in-from-left-2 duration-300">
                {/* Start Time - Compact */}
                <div className="flex items-center space-x-2">
                  <span className="text-white/60 text-xs">Start:</span>
                  <input
                    type="time"
                    value={classStartTime}
                    onChange={(e) => onClassStartTimeChange(e.target.value)}
                    className="px-2 py-1 bg-white/[0.05] text-white text-xs border border-white/[0.1] rounded focus:border-amber-500/50 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 ease-in-out hover:bg-white/[0.08]"
                    disabled={isStreaming}
                  />
                </div>

                {/* Threshold - Compact */}
                <div className="flex items-center space-x-2">
                  <span className="text-white/60 text-xs">Threshold:</span>
                  <input
                    type="range"
                    min="5"
                    max="60"
                    step="5"
                    value={lateThresholdMinutes}
                    onChange={(e) => onLateThresholdChange(parseInt(e.target.value))}
                    className="w-16 accent-amber-500"
                    disabled={isStreaming}
                  />
                  <span className="text-amber-400 font-medium text-xs min-w-[2.5rem]">{lateThresholdMinutes}min</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Vertical Layout for Controls */}
        <div className="flex flex-col items-center space-y-3">
          {/* Start/Stop Button - Primary Action First */}
          <button
            onClick={isStreaming ? stopCamera : startCamera}
            className={`px-6 py-3 rounded-lg font-medium text-sm transition-all duration-300 ease-in-out ${
              isStreaming ? 'btn-error' : 'btn-success'
            }`}
          >
            {isStreaming ? 'Stop Scan' : 'Start Scan'}
          </button>

          {/* Tracking Mode Toggle */}
          <div className="flex flex-col items-center space-y-2">
            <div className="flex items-center space-x-2">
              <span className={`text-xs transition-colors duration-300 ease-in-out ${trackingMode === 'auto' ? 'text-white' : 'text-white/40'}`}>Auto</span>
              <button
                onClick={() => setTrackingMode(trackingMode === 'auto' ? 'manual' : 'auto')}
                className={`relative w-12 h-4 rounded-full focus:outline-none flex items-center transition-all duration-300 ease-in-out ${
                  trackingMode === 'auto' ? 'bg-white/20' : 'bg-white/10'
                }`}
              >
                <div className={`absolute left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-300 ease-in-out ${
                  trackingMode === 'auto' ? 'translate-x-0' : 'translate-x-5'
                }`}></div>
              </button>
              <span className={`text-xs transition-colors duration-300 ease-in-out ${trackingMode === 'manual' ? 'text-white' : 'text-white/40'}`}>Manual</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

