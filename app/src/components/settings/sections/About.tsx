/**
 * About Section - Settings
 *
 * Clean about page with privacy modal for detailed information.
 */

import { useState, useEffect, useCallback } from "react";
import { updaterService } from "@/services";
import type { UpdateInfo } from "@/types/global";

// ============================================================================
// Privacy Modal Component
// ============================================================================

interface PrivacyModalProps {
  onClose: () => void;
}

const PrivacyModal: React.FC<PrivacyModalProps> = ({ onClose }) => {
  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[#0f0f0f] border border-white/10 rounded-3xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col p-6">
        {/* Header */}
        <div className="flex-shrink-0 mb-4">
          <h2 className="text-xl font-semibold text-white">
            Privacy & Data Handling
          </h2>
          <p className="text-sm text-white/50 mt-1">
            How your information is stored and used
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-6 custom-scroll pr-2 -mr-2">
          {/* Local-first */}
          <section>
            <h3 className="text-sm font-medium text-white mb-2">
              Your data stays local
            </h3>
            <p className="text-xs text-white/50 leading-relaxed">
              Suri runs entirely on your device. Face recognition data
              (including biometric templates), attendance records, and settings
              are stored locally on your computer. Nothing is uploaded to
              external servers unless you explicitly choose to enable cloud sync
              features.
            </p>
          </section>

          {/* No collection */}
          <section>
            <h3 className="text-sm font-medium text-white mb-2">
              No data collection
            </h3>
            <p className="text-xs text-white/50 leading-relaxed">
              This application does not collect, transmit, or share any personal
              information. We don't track usage patterns, gather analytics, or
              monitor your activity. There are no hidden callbacks, telemetry,
              or background data transfers.
            </p>
          </section>

          {/* Offline operation */}
          <section>
            <h3 className="text-sm font-medium text-white mb-2">
              Works offline
            </h3>
            <p className="text-xs text-white/50 leading-relaxed">
              Face detection, recognition, and attendance recording work without
              internet. This ensures privacy and allows use in environments with
              limited or no network access.
            </p>
          </section>

          {/* Optional cloud */}
          <section>
            <h3 className="text-sm font-medium text-white mb-2">
              Optional cloud sync
            </h3>
            <p className="text-xs text-white/50 leading-relaxed">
              If you enable cloud synchronization in the future, those features
              will have separate terms you can review before opting in. Cloud
              features are entirely optional.
            </p>
          </section>

          {/* Legal compliance */}
          <section>
            <h3 className="text-sm font-medium text-white mb-2">
              Regulatory compliance
            </h3>
            <p className="text-xs text-white/50 leading-relaxed">
              Your data, including biometric templates, is stored locally in an
              isolated environment. You maintain full control with the ability
              to export or permanently delete your records at any time. This
              supports compliance with:
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="text-[10px] text-white/40 bg-white/5 px-2 py-0.5 rounded">
                GDPR (EU)
              </span>
              <span className="text-[10px] text-white/40 bg-white/5 px-2 py-0.5 rounded">
                CCPA (California)
              </span>
              <span className="text-[10px] text-white/40 bg-white/5 px-2 py-0.5 rounded">
                LGPD (Brazil)
              </span>
              <span className="text-[10px] text-white/40 bg-white/5 px-2 py-0.5 rounded">
                Data Privacy Act of 2012 (PH)
              </span>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Update Status Component
// ============================================================================

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

  // Offline
  if (updateInfo?.isOffline) {
    return <span className="text-xs text-amber-400/70">No internet</span>;
  }

  // Update available
  if (updateInfo?.hasUpdate) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 mr-1">
          <span className="text-xs text-emerald-400 font-medium whitespace-nowrap">
            v{updateInfo.latestVersion} available
          </span>
          {lastChecked && (
            <>
              <span className="text-white/10 text-[10px]">·</span>
              <span className="text-[10px] text-white/30 whitespace-nowrap">
                Last checked: {formatLastChecked(lastChecked)}
              </span>
            </>
          )}
        </div>

        <button
          onClick={onCheck}
          disabled={isChecking}
          title={isChecking ? "Checking..." : "Check for updates"}
          className="w-8 h-8 flex items-center justify-center !bg-transparent hover:!bg-transparent !border-0 !p-0 text-white/50 hover:text-white transition-colors disabled:opacity-50 focus-visible:outline-1 focus-visible:outline-white/20 rounded"
        >
          {isChecking ? (
            <i className="fa-solid fa-spinner animate-spin" />
          ) : (
            <i className="fa-solid fa-arrows-rotate" />
          )}
        </button>

        <button
          onClick={onDownload}
          className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-medium transition-colors border border-emerald-500/20"
        >
          Download
        </button>
      </div>
    );
  }

  // Error
  if (updateInfo?.error) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-xs text-red-400/60 whitespace-nowrap">
          Update check failed
        </span>
        <button
          onClick={onCheck}
          disabled={isChecking}
          className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-xs font-medium transition-colors border border-white/5"
        >
          Retry
        </button>
      </div>
    );
  }

  // Up to date or initial
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 mr-1">
        <span className="text-xs text-white/60 font-medium">
          {updateInfo && !updateInfo.hasUpdate ? "Up to date" : "Not checked"}
        </span>
        {lastChecked && (
          <>
            <span className="text-white/10 text-[10px]">·</span>
            <span className="text-[10px] text-white/30 whitespace-nowrap">
              Last checked: {formatLastChecked(lastChecked)}
            </span>
          </>
        )}
      </div>
      <button
        onClick={onCheck}
        disabled={isChecking || showSuccess}
        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
          showSuccess
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
            : "bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border-white/5"
        } disabled:opacity-50`}
      >
        {isChecking
          ? "Checking..."
          : showSuccess
            ? "Up to date"
            : "Check for updates"}
      </button>
    </div>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const About: React.FC = () => {
  const [version, setVersion] = useState<string>("");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

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

    const unsubscribe = updaterService.onUpdateAvailable((info) => {
      setUpdateInfo(info);
      setLastChecked(new Date());
    });

    return unsubscribe;
  }, []);

  const handleCheckForUpdates = useCallback(async () => {
    setIsChecking(true);
    setShowSuccess(false);
    try {
      const info = await updaterService.checkForUpdates(true);
      setUpdateInfo(info);
      setLastChecked(new Date());

      // Show success state if no update found
      if (!info.hasUpdate) {
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 5000);
      }
    } finally {
      setIsChecking(false);
    }
  }, []);

  const handleDownload = useCallback(() => {
    updaterService.openReleasePage(updateInfo?.releaseUrl);
  }, [updateInfo]);

  const openLink = (url: string) => () => updaterService.openReleasePage(url);

  return (
    <div className="relative h-full">
      {/* Privacy Modal */}
      {showPrivacyModal && (
        <PrivacyModal onClose={() => setShowPrivacyModal(false)} />
      )}

      {/* Main Content */}
      <div className="p-6 h-full flex flex-col">
        <div className="flex-1 space-y-6">
          {/* ============================================================ */}
          {/* App Identity */}
          {/* ============================================================ */}
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Suri
            </h1>
            <p className="text-sm text-white/40 mt-1">
              AI-powered attendance tracker
            </p>
          </div>

          {/* ============================================================ */}
          {/* Info Rows */}
          {/* ============================================================ */}
          <div className="space-y-3">
            {/* Version */}
            <div className="flex items-center justify-between py-2 border-b border-white/[0.04]">
              <span className="text-xs text-white/50">Version</span>
              <div className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 text-xs font-mono text-white/50">
                {version || "—"}
              </div>
            </div>

            {/* Updates */}
            <div className="flex items-center justify-between py-2 border-b border-white/[0.04]">
              <span className="text-xs text-white/50">Updates</span>
              <UpdateStatus
                updateInfo={updateInfo}
                isChecking={isChecking}
                showSuccess={showSuccess}
                lastChecked={lastChecked}
                onCheck={handleCheckForUpdates}
                onDownload={handleDownload}
              />
            </div>

            {/* License */}
            <div className="flex items-center justify-between py-2 border-b border-white/[0.04]">
              <span className="text-xs text-white/50">License</span>
              <button
                onClick={openLink("https://www.gnu.org/licenses/agpl-3.0.html")}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-xs font-medium transition-colors border border-white/5"
              >
                View License
              </button>
            </div>

            {/* Source */}
            <div className="flex items-center justify-between py-2 border-b border-white/[0.04]">
              <span className="text-xs text-white/50">Source code</span>
              <button
                onClick={openLink("https://github.com/suriAI/suri")}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-xs font-medium transition-colors border border-white/5"
              >
                View Source
              </button>
            </div>

            {/* Privacy */}
            <div className="flex items-center justify-between py-2 border-b border-white/[0.04]">
              <span className="text-xs text-white/50">Privacy & data</span>
              <button
                onClick={() => setShowPrivacyModal(true)}
                className="px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 text-xs font-medium transition-colors border border-cyan-500/20 flex items-center gap-1"
              >
                Read more
                <i className="fa-solid fa-arrow-right text-[9px]"></i>
              </button>
            </div>
          </div>
        </div>

        {/* ============================================================== */}
        {/* Footer Actions & Copyright */}
        {/* ============================================================== */}
        <div className="pt-6 pb-6 mt-auto flex items-center justify-between border-t border-white/[0.04]">
          <div className="flex items-center gap-3">
            <button
              onClick={openLink("https://github.com/suriAI/suri/releases")}
              className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-xs font-medium transition-colors border border-white/5"
            >
              Releases
            </button>
            <button
              onClick={openLink("https://github.com/suriAI/suri/issues")}
              className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-xs font-medium transition-colors border border-white/5"
            >
              Report issue
            </button>
            <button
              onClick={openLink("https://github.com/suriAI/suri#readme")}
              className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-xs font-medium transition-colors border border-white/5"
            >
              Documentation
            </button>
          </div>
          <p className="text-xs text-white/30 font-medium">© 2026 Suri</p>
        </div>
      </div>
    </div>
  );
};
