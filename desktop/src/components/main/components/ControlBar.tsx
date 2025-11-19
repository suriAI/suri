import { Dropdown } from "../../shared";

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
      <div className="rounded-lg p-4 flex items-center justify-between min-h-[4rem]">
        <div className="flex items-center space-x-6">
          {/* Camera Selection */}
          {cameraDevices.length > 0 && (
            <div className="flex flex-col items-start space-y-1">
              <div className="min-w-[200px]">
                <Dropdown
                  options={cameraDevices.map((device, index) => ({
                    value: device.deviceId,
                    label: device.label || `Camera ${index + 1}`,
                  }))}
                  value={selectedCamera}
                  onChange={(deviceId) => {
                    if (deviceId) setSelectedCamera(deviceId);
                  }}
                  placeholder="Select camera…"
                  emptyMessage="No cameras available"
                  disabled={isStreaming || cameraDevices.length <= 1}
                  maxHeight={256}
                  buttonClassName="text-md px-4"
                  showPlaceholderOption={false}
                  allowClear={false}
                />
              </div>
            </div>
          )}
        </div>

        {/* Start/Stop Button */}
        <button
          onClick={isStreaming ? stopCamera : startCamera}
          className={`min-w-[140px] px-6 py-3 rounded-lg font-semibold text-sm transition-all duration-200 ease-in-out flex items-center justify-center gap-2 ${
            isStreaming
              ? "bg-red-500/20 border border-red-400/40 text-red-200 hover:bg-red-500/30"
              : "bg-cyan-500/20 border border-cyan-400/40 text-cyan-100 hover:bg-cyan-500/30 shadow-lg shadow-cyan-500/10"
          }`}
        >
          {isStreaming ? "Stop Tracking" : "Start Tracking"}
        </button>
      </div>
    </div>
  );
}
