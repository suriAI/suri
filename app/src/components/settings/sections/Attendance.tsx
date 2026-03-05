import { motion, AnimatePresence } from "framer-motion";
import type { AttendanceSettings } from "@/components/settings/types";

interface AttendanceProps {
  attendanceSettings: AttendanceSettings;
  onLateThresholdChange: (minutes: number) => void;
  onLateThresholdToggle: (enabled: boolean) => void;
  onReLogCooldownChange: (seconds: number) => void;
  onSpoofDetectionToggle: (enabled: boolean) => void;
  onTrackCheckoutToggle: (enabled: boolean) => void;
  hasSelectedGroup?: boolean;
}

export function Attendance({
  attendanceSettings,
  onLateThresholdChange,
  onLateThresholdToggle,
  onReLogCooldownChange,
  onSpoofDetectionToggle,
  onTrackCheckoutToggle,
  hasSelectedGroup = false,
}: AttendanceProps) {
  return (
    <div className="space-y-4 max-w-auto p-10">
      {/* 1. Core Logic: Time In & Time Out */}
      <div className="flex flex-col">
        <div
          className={`flex items-center py-3 gap-4 ${hasSelectedGroup ? "" : "border-b border-white/5"}`}
        >
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white/90">
              Time In & Time Out
            </div>
            <div className="min-h-4 relative">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${hasSelectedGroup}-${attendanceSettings.trackCheckout}`}
                  initial={{ opacity: 0, y: -2 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 2 }}
                  transition={{ duration: 0.15 }}
                  className="text-xs text-white/50"
                >
                  {!hasSelectedGroup
                    ? "Select a group to enable this feature"
                    : attendanceSettings.trackCheckout
                      ? "Record both arrival and when people leave to automatically calculate total hours."
                      : "Arrival Only: Only the first scan will be recorded."}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          <button
            onClick={() =>
              onTrackCheckoutToggle(!attendanceSettings.trackCheckout)
            }
            disabled={!hasSelectedGroup}
            className={`relative w-11 h-6 rounded-full focus:outline-none transition-colors duration-150 shrink-0 flex items-center ml-auto ${attendanceSettings.trackCheckout
                ? "bg-cyan-500/30"
                : "bg-white/10"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <div
              className={`absolute left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-150 ${attendanceSettings.trackCheckout
                  ? "translate-x-5"
                  : "translate-x-0"
                }`}
            ></div>
          </button>
        </div>

        <AnimatePresence>
          {hasSelectedGroup && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <div className="flex items-center pb-4 pt-1 border-b border-white/5 gap-4 pl-4 relative">
                {/* Visual indicator of nesting */}
                <div className="absolute left-0 top-0 bottom-1/2 w-px bg-white/10 rounded-bl-[2px]"></div>
                <div className="absolute left-0 top-1/2 w-3 h-px bg-white/10 -translate-y-1/2 rounded-bl-[2px]"></div>

                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white/50 mt-0.5">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={
                          attendanceSettings.trackCheckout
                            ? "session"
                            : "prevention"
                        }
                        initial={{ opacity: 0, x: -5 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 5 }}
                        transition={{ duration: 0.15 }}
                      >
                        {attendanceSettings.trackCheckout
                          ? `Session Window: Wait for ${Math.floor(
                            (attendanceSettings.reLogCooldownSeconds ??
                              1800) / 60,
                          )} minutes before starting a NEW session.`
                          : `Duplicate Prevention: Ignore other scans for ${Math.floor(
                            (attendanceSettings.reLogCooldownSeconds ??
                              1800) / 60,
                          )} minutes.`}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 ml-auto">
                  <span className="text-cyan-400 font-semibold text-sm min-w-10 text-right whitespace-nowrap">
                    {Math.floor(
                      (attendanceSettings.reLogCooldownSeconds ?? 1800) / 60,
                    )}{" "}
                    m
                  </span>
                  <input
                    type="range"
                    min="60"
                    max="3600"
                    step="60"
                    value={attendanceSettings.reLogCooldownSeconds ?? 1800}
                    onChange={(e) =>
                      onReLogCooldownChange(parseInt(e.target.value))
                    }
                    className="w-24 accent-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 2. Reporting Rules: Late Tracking */}
      <div className="flex flex-col">
        <div
          className={`flex items-center py-3 gap-4 ${attendanceSettings.lateThresholdEnabled && hasSelectedGroup
              ? ""
              : "border-b border-white/5"
            }`}
        >
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white/90">
              Late Tracking
            </div>
            <div className="min-h-4 relative">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${hasSelectedGroup}-${attendanceSettings.lateThresholdEnabled}`}
                  initial={{ opacity: 0, y: -2 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 2 }}
                  transition={{ duration: 0.15 }}
                  className="text-xs text-white/50"
                >
                  {!hasSelectedGroup
                    ? "Select a group to enable late tracking"
                    : attendanceSettings.lateThresholdEnabled
                      ? "Active: Flag members as late based on schedule."
                      : "Disabled: No late flags will be added to reports."}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          <button
            onClick={() =>
              onLateThresholdToggle(!attendanceSettings.lateThresholdEnabled)
            }
            disabled={!hasSelectedGroup}
            className={`relative w-11 h-6 rounded-full focus:outline-none transition-colors duration-150 shrink-0 flex items-center ml-auto ${attendanceSettings.lateThresholdEnabled
                ? "bg-cyan-500/30"
                : "bg-white/10"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <div
              className={`absolute left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-150 ${attendanceSettings.lateThresholdEnabled
                  ? "translate-x-5"
                  : "translate-x-0"
                }`}
            ></div>
          </button>
        </div>

        <AnimatePresence>
          {attendanceSettings.lateThresholdEnabled && hasSelectedGroup && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <div className="flex items-center pb-4 pt-1 border-b border-white/5 gap-4 pl-4 relative">
                {/* Visual indicator of nesting */}
                <div className="absolute left-0 top-0 bottom-1/2 w-px bg-white/10 rounded-bl-[2px]"></div>
                <div className="absolute left-0 top-1/2 w-3 h-px bg-white/10 -translate-y-1/2 rounded-bl-[2px]"></div>

                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white/50 mt-0.5">
                    Minutes after the start time before a member is marked as
                    late.
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 ml-auto">
                  <span className="text-cyan-400 font-semibold text-sm min-w-10 text-right whitespace-nowrap">
                    {attendanceSettings.lateThresholdMinutes} m
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="60"
                    step="5"
                    value={attendanceSettings.lateThresholdMinutes}
                    onChange={(e) =>
                      onLateThresholdChange(parseInt(e.target.value))
                    }
                    className="w-24 accent-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 3. Security Layer: Anti-Spoof Detection */}
      <div className="flex items-center py-3 border-b border-white/5 gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white/90">
            Anti-Spoof Detection
          </div>
          <div className="min-h-4 relative">
            <AnimatePresence mode="wait">
              <motion.div
                key={attendanceSettings.enableSpoofDetection ? "on" : "off"}
                initial={{ opacity: 0, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 2 }}
                transition={{ duration: 0.15 }}
                className="text-xs text-white/50"
              >
                {attendanceSettings.enableSpoofDetection
                  ? "Active: Protecting against fake faces and photos."
                  : "Disabled: Fast scanning but less secure."}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <button
          onClick={() =>
            onSpoofDetectionToggle(!attendanceSettings.enableSpoofDetection)
          }
          className={`relative w-11 h-6 rounded-full focus:outline-none transition-colors duration-150 shrink-0 flex items-center ml-auto ${attendanceSettings.enableSpoofDetection
              ? "bg-cyan-500/30"
              : "bg-white/10"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <div
            className={`absolute left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-150 ${attendanceSettings.enableSpoofDetection
                ? "translate-x-5"
                : "translate-x-0"
              }`}
          ></div>
        </button>
      </div>
    </div>
  );
}
