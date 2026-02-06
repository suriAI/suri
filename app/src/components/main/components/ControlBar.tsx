import { Dropdown } from "@/components/shared";

interface ControlBarProps {
  cameraDevices: MediaDeviceInfo[];
  selectedCamera: string;
  setSelectedCamera: (deviceId: string) => void;
  isStreaming: boolean;
  startCamera: () => void;
  stopCamera: () => void;
  hasSelectedGroup: boolean;
  requestGroupSelection: () => void;
}

export function ControlBar({
  cameraDevices,
  selectedCamera,
  setSelectedCamera,
  isStreaming,
  startCamera,
  stopCamera,
  hasSelectedGroup,
  requestGroupSelection,
}: ControlBarProps) {
  // Check if a camera is selected and valid (exists in available devices)
  const isCameraSelected =
    !!selectedCamera &&
    selectedCamera.trim() !== "" &&
    cameraDevices.some((device) => device.deviceId === selectedCamera);
  const hasCameraDevices = cameraDevices.length > 0;
  const canStartTracking =
    (isCameraSelected || hasCameraDevices) && !isStreaming && hasSelectedGroup;
  // Button should be enabled if streaming (to allow stop) OR if ready to start
  const isButtonEnabled = isStreaming || canStartTracking || !hasSelectedGroup;

  const handlePrimaryAction = () => {
    if (isStreaming) {
      stopCamera();
      return;
    }

    if (!hasSelectedGroup) {
      requestGroupSelection();
      return;
    }

    startCamera();
  };

  return (
    <div>
      <div className="rounded-lg p-4 flex items-center justify-between min-h-[4rem] gap-4">
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

        <div className="flex items-center gap-3">
          {/* Start/Stop Button */}
          <button
            onClick={handlePrimaryAction}
            disabled={!isButtonEnabled}
            className={`min-w-[140px] px-6 py-3 rounded-lg font-semibold text-sm transition-all duration-200 ease-in-out flex items-center justify-center gap-2 ${
              isStreaming
                ? "bg-red-500/20 border border-red-400/40 text-red-200 hover:bg-red-500/30"
                : hasSelectedGroup && canStartTracking
                  ? "bg-cyan-500/20 border border-cyan-400/40 text-cyan-100 hover:bg-cyan-500/30 shadow-lg shadow-cyan-500/10"
                  : "bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white"
            }`}
            title={
              !hasCameraDevices
                ? "No camera detected"
                : !hasSelectedGroup
                  ? "Select a group to start tracking"
                  : !isCameraSelected
                    ? "Select a camera or use the first available"
                    : isStreaming
                      ? "Stop tracking attendance"
                      : "Start tracking attendance"
            }
          >
            {isStreaming
              ? "Stop Tracking"
              : hasSelectedGroup
                ? "Start Tracking"
                : "Select Group"}
          </button>
        </div>
      </div>
    </div>
  );
}
