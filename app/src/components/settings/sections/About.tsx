import { useState, useEffect, useCallback, useRef } from "react";
import { updaterService } from "@/services";
import type { UpdateInfo } from "@/types/global";
import { Modal } from "@/components/common";

interface PrivacyModalProps {
  onClose: () => void;
}

const PrivacyModal: React.FC<PrivacyModalProps> = ({ onClose }) => {
  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={
        <div>
          <h2 className="text-xl font-semibold text-white">
            Privacy & Data Handling
          </h2>
          <p className="text-sm text-white/50 mt-1 font-normal">
            How your information is stored and used
          </p>
        </div>
      }
      maxWidth="lg"
    >
      <div className="overflow-y-auto max-h-[70vh] space-y-6 custom-scroll pr-2 -mr-2 mt-2">
        <section>
          <h3 className="text-sm font-medium text-white mb-2">
            Your data stays local
          </h3>
          <p className="text-xs text-white/50 leading-relaxed">
            Suri currently stores face templates, attendance records, and
            settings locally on your device by default. The current desktop app
            does not depend on a hosted biometric service to perform face
            recognition.
          </p>
        </section>

        <section>
          <h3 className="text-sm font-medium text-white mb-2">
            No data collection
          </h3>
          <p className="text-xs text-white/50 leading-relaxed">
            The current desktop app does not include analytics, ads, or hidden
            telemetry. Biometric processing is performed locally, and the app
            does not send routine usage data to a hosted monitoring service.
          </p>
        </section>

        <section>
          <h3 className="text-sm font-medium text-white mb-2">Works offline</h3>
          <p className="text-xs text-white/50 leading-relaxed">
            Face detection, recognition, and attendance recording work without
            internet. This ensures privacy and allows use in environments with
            limited or no network access.
          </p>
        </section>

        <section>
          <h3 className="text-sm font-medium text-white mb-2">
            Optional cloud sync
          </h3>
          <p className="text-xs text-white/50 leading-relaxed">
            Any future hosted sync or dashboard features should have separate
            documentation and terms before use. They are not part of the current
            desktop privacy guarantees.
          </p>
        </section>

        <section>
          <h3 className="text-sm font-medium text-white mb-2">
            Regulatory compliance
          </h3>
          <p className="text-xs text-white/50 leading-relaxed">
            Suri includes local storage, consent tracking, export, and deletion
            controls that can help support privacy-conscious deployments.
            Compliance still depends on your operational policies and legal
            notices.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 pb-2">
            <span className="text-[10px] text-white/40 bg-white/5 px-2 py-0.5 rounded">
              GDPR (EU)
            </span>
            <span className="text-[10px] text-white/40 bg-white/5 px-2 py-0.5 rounded">
              Data Privacy Act of 2012 (PH)
            </span>
          </div>
        </section>
        <div className="flex justify-end mt-8">
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-lg bg-white/5 border border-white/10 text-white/50 hover:bg-white/10 hover:text-white transition-colors text-sm font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
};

interface UpdateStatusProps {
  updateInfo: UpdateInfo | null;
  isChecking: boolean;
  showSuccess: boolean;
  lastChecked: Date | null;
  onCheck: () => void;
  onDownload: () => void;
}

const UpdateStatus: React.FC<UpdateStatusProps> = ({
  updateInfo,
  isChecking,
  showSuccess,
  lastChecked,
  onCheck,
  onDownload,
}) => {
  const formatLastChecked = (date: Date) => {
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (updateInfo?.isOffline) {
    return <span className="text-xs text-amber-400/70">No internet</span>;
  }

  if (updateInfo?.hasUpdate) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-cyan-400 font-bold tracking-wide">
            Update available (v{updateInfo.latestVersion})
          </span>
          <button
            onClick={onDownload}
            className="px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 text-xs font-medium transition-all border border-cyan-500/20 active:scale-95"
          >
            Download
          </button>
        </div>
        {lastChecked && (
          <span className="text-[10px] text-white/20 whitespace-nowrap">
            Last checked: {formatLastChecked(lastChecked)}
          </span>
        )}
      </div>
    );
  }

  if (updateInfo?.error) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-3">
          <span className="text-xs text-red-400/50 whitespace-nowrap">
            Update check failed
          </span>
          <button
            onClick={onCheck}
            disabled={isChecking}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white text-xs font-medium transition-colors border border-white/5"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-3">
        {showSuccess && (
          <span className="text-xs text-cyan-500/60 font-medium">
            Up to date
          </span>
        )}
        <button
          onClick={onCheck}
          disabled={isChecking}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
            isChecking
              ? "bg-white/5 text-white/30 border-white/5"
              : "bg-transparent hover:bg-white/5 text-white/50 hover:text-white border-transparent hover:border-white/10"
          } disabled:opacity-50`}
        >
          {isChecking ? (
            <div className="flex items-center gap-2">
              <i className="fa-solid fa-spinner animate-spin text-[10px]" />
              <span>Checking...</span>
            </div>
          ) : (
            "Check for updates"
          )}
        </button>
      </div>
      {lastChecked && !isChecking && (
        <span className="text-[10px] text-white/20 whitespace-nowrap">
          Last checked: {formatLastChecked(lastChecked)}
        </span>
      )}
    </div>
  );
};

export const About: React.FC = () => {
  const [version, setVersion] = useState<string>("");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    updaterService.getVersion().then(setVersion);

    const init = async () => {
      await updaterService.waitForInitialization();
      const cached = updaterService.getCachedUpdateInfo();
      if (cached) setUpdateInfo(cached);

      const last = updaterService.getLastChecked();
      if (last) setLastChecked(last);
    };

    init();

    const unsubscribe = updaterService.onUpdateInfoChanged((info) => {
      setUpdateInfo(info);
      const last = updaterService.getLastChecked();
      if (last) setLastChecked(last);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleCheckForUpdates = useCallback(async () => {
    setIsChecking(true);
    setShowSuccess(false);
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
    try {
      const info = await updaterService.checkForUpdates(true);
      setUpdateInfo(info);
      setLastChecked(new Date());

      // Show success state if no update found
      if (!info.hasUpdate) {
        setShowSuccess(true);
        successTimerRef.current = setTimeout(() => {
          setShowSuccess(false);
          successTimerRef.current = null;
        }, 5000);
      }
    } finally {
      setIsChecking(false);
    }
  }, []);

  // Cleanup the success timer on unmount
  useEffect(() => {
    return () => {
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  const handleDownload = useCallback(() => {
    updaterService.openReleasePage(updateInfo?.releaseUrl);
  }, [updateInfo]);

  const openLink = (url: string) => () => updaterService.openReleasePage(url);

  return (
    <div className="relative h-full overflow-y-auto custom-scroll">
      {showPrivacyModal && (
        <PrivacyModal onClose={() => setShowPrivacyModal(false)} />
      )}

      <div className="pt-4 px-10 pb-10 h-full flex flex-col items-center max-w-lg mx-auto text-center">
        <div className="w-full flex-1 space-y-12">
          <div className="space-y-2">
            <h1 className="text-4xl font-black text-white tracking-[-0.04em]">
              Suri
            </h1>
            <p className="text-[11px] text-white/40 font-medium">
              AI Attendance Tracker
            </p>
          </div>

          <div className="space-y-1 w-full text-left">
            <div className="flex items-center justify-between py-3 border-b border-white/5">
              <span className="text-[11px] font-medium text-white/30">
                Version
              </span>
              <div className="px-3 py-1.5 flex items-center justify-center">
                <span className="text-xs font-mono text-white/60">
                  {version || "—"}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between py-3 border-b border-white/5">
              <span className="text-[11px] font-medium text-white/30">
                Updates
              </span>
              <UpdateStatus
                updateInfo={updateInfo}
                isChecking={isChecking}
                showSuccess={showSuccess}
                lastChecked={lastChecked}
                onCheck={handleCheckForUpdates}
                onDownload={handleDownload}
              />
            </div>

            <div className="flex items-center justify-between py-3 border-b border-white/5">
              <span className="text-[11px] font-medium text-white/30">
                License
              </span>
              <button
                onClick={openLink("https://www.gnu.org/licenses/agpl-3.0.html")}
                className="px-3 py-1.5 rounded-lg bg-transparent hover:bg-white/5 text-white/40 hover:text-white/90 text-xs font-medium transition-all border border-transparent hover:border-white/10 active:scale-95"
              >
                View GNU AGPL v3
              </button>
            </div>

            <div className="flex items-center justify-between py-3 border-b border-white/5">
              <span className="text-[11px] font-medium text-white/30">
                Source code
              </span>
              <button
                onClick={openLink("https://github.com/suriAI/suri")}
                className="px-3 py-1.5 rounded-lg bg-transparent hover:bg-white/5 text-white/40 hover:text-white/90 text-xs font-medium transition-all border border-transparent hover:border-white/10 active:scale-95"
              >
                View Repository
              </button>
            </div>

            <div className="flex items-center justify-between py-3 border-b border-white/5">
              <span className="text-[11px] font-medium text-white/30">
                Privacy & Data
              </span>
              <button
                onClick={() => setShowPrivacyModal(true)}
                className="px-3 py-1.5 rounded-lg bg-transparent hover:bg-cyan-500/10 text-white/50 hover:text-cyan-400 text-xs font-medium transition-all border border-transparent hover:border-cyan-500/10 active:scale-95"
              >
                Read Policy
              </button>
            </div>
          </div>
        </div>

        <div className="pt-12 pb-4 mt-auto border-t border-white/5 w-full">
          <div className="flex items-center justify-center gap-6 mb-6">
            <button
              onClick={openLink("https://github.com/suriAI/suri/releases")}
              className="text-[11px] font-semibold text-white/35 hover:text-white/80 transition-colors"
            >
              Releases
            </button>
            <button
              onClick={openLink("https://github.com/suriAI/suri/issues")}
              className="text-[11px] font-semibold text-white/35 hover:text-white/80 transition-colors"
            >
              Support
            </button>
            <button
              onClick={openLink("https://github.com/suriAI/suri#readme")}
              className="text-[11px] font-semibold text-white/35 hover:text-white/80 transition-colors"
            >
              Docs
            </button>
          </div>
          <p className="text-[11px] text-white/25 font-medium">© 2026 Suri</p>
        </div>
      </div>
    </div>
  );
};
