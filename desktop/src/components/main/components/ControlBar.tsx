interface ControlBarProps {
  cameraDevices: MediaDeviceInfo[];
  selectedCamera: string;
  setSelectedCamera: (deviceId: string) => void;
  isStreaming: boolean;
  startCamera: () => void;
  stopCamera: () => void;
}

export function ControlBar({
  cameraDevices,
  selectedCamera,
  setSelectedCamera,
  isStreaming,
  startCamera,
  stopCamera,
}: ControlBarProps) {
  return (
    <div>
      <div className="rounded-lg p-6 pt-5 flex items-center justify-between min-h-[4rem]">
        <div className="flex items-center space-x-6">
          {/* Camera Selection */}
          {cameraDevices.length > 0 && (
            <div className="flex flex-col items-start space-y-1">
              <div className="relative min-w-[200px] group">
                <select
                  value={selectedCamera}
                  onChange={(e) => setSelectedCamera(e.target.value)}
                  disabled={isStreaming || cameraDevices.length <= 1}
                  className="bg-white/[0.05] text-white text-base border border-white/[0.1] rounded-lg px-4 py-3 pr-10 focus:border-white/20 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed w-full transition-all duration-300 ease-in-out hover:bg-white/[0.08] appearance-none cursor-pointer"
                  style={{ colorScheme: 'dark' }}
                >
                  {cameraDevices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId} className="bg-black text-white">
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))}
                </select>
                {/* Custom dropdown arrow */}
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                  <svg
                    className="w-4 h-4 text-white/50 transition-colors duration-200 group-hover:text-white/70"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Start/Stop Button */}
        <button
          onClick={isStreaming ? stopCamera : startCamera}
          className={`px-6 py-3 rounded-lg font-medium text-sm transition-all duration-300 ease-in-out ${
            isStreaming ? 'btn-error' : 'btn-success'
          }`}
        >
          {isStreaming ? 'Stop Scan' : 'Start Scan'}
        </button>
      </div>
    </div>
  );
}

