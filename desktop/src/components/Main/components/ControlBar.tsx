interface ControlBarProps {
  cameraDevices: MediaDeviceInfo[];
  selectedCamera: string;
  setSelectedCamera: (deviceId: string) => void;
  isStreaming: boolean;
  trackingMode: 'auto' | 'manual';
  setTrackingMode: (mode: 'auto' | 'manual') => void;
  startCamera: () => void;
  stopCamera: () => void;
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
}: ControlBarProps) {
  return (
    <div className="px-4 pt-2 pb-2">
      <div className="bg-white/[0.02] border border-white/[0.08] rounded-lg p-4 flex items-center justify-between">
        <div className="flex items-center space-x-6">
          {/* Camera Selection */}
          {cameraDevices.length > 0 && (
            <div className="flex items-center space-x-2">
              <select
                value={selectedCamera}
                onChange={(e) => setSelectedCamera(e.target.value)}
                disabled={isStreaming || cameraDevices.length <= 1}
                className="bg-white/[0.05] text-white text-sm border border-white/[0.1] rounded px-2 py-1 focus:border-blue-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
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
            <div className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-green-500' : 'bg-red-500'}`}></div>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          {/* Tracking Mode Toggle */}
          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-2">
              <span className={`text-xs transition-colors duration-200 ${trackingMode === 'auto' ? 'text-cyan-300' : 'text-white/40'}`}>Auto</span>
              <button
                onClick={() => setTrackingMode(trackingMode === 'auto' ? 'manual' : 'auto')}
                className={`relative w-10 h-3 rounded-full transition-all duration-300 focus:outline-none flex items-center ${trackingMode === 'auto' ? 'bg-cyan-500' : 'bg-orange-500'}`}
              >
                <div className={`absolute left-1 w-4 h-4 bg-white rounded-full shadow-md transition-transform duration-300 ${trackingMode === 'auto' ? 'translate-x-0' : 'translate-x-6'}`}></div>
              </button>
              <span className={`text-xs transition-colors duration-200 ${trackingMode === 'manual' ? 'text-orange-300' : 'text-white/40'}`}>Manual</span>
            </div>
          </div>

          <button
            onClick={isStreaming ? stopCamera : startCamera}
            className={`px-4 py-2 rounded font-medium transition-colors duration-150 ${isStreaming ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white'}`}
          >
            {isStreaming ? 'Stop' : 'Start Scan'}
          </button>
        </div>
      </div>
    </div>
  );
}

