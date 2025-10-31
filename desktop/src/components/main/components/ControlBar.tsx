import { Dropdown } from '../../shared/Dropdown';

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
      <div className="rounded-lg p-5 pt-4.5 flex items-center justify-between min-h-[4rem]">
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
          className={`px-4 rounded-lg font-medium text-sm transition-all duration-200 ease-in-out ${
            isStreaming ? 'btn-error' : 'btn-success'
          }`}
        >
          {isStreaming ? 'Stop Scan' : 'Start Scan'}
        </button>
      </div>
    </div>
  );
}

