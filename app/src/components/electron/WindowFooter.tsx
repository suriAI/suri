import { useState, useEffect } from "react";
import { updaterService } from "@/services";
import type { UpdateInfo } from "@/types/global";

export default function WindowFooter() {
  const [version, setVersion] = useState<string>("...");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    // Get current version
    updaterService.getVersion().then(setVersion);

    let disposed = false;

    // Ensure we load cached info after initialization, then stay in sync with any checks.
    updaterService
      .waitForInitialization()
      .then(() => {
        if (disposed) return;
        setUpdateInfo(updaterService.getCachedUpdateInfo());
      })
      .catch(() => {});

    const unsubscribe = updaterService.onUpdateInfoChanged((info) => {
      if (disposed) return;
      setUpdateInfo(info);
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const handleUpdateClick = () => {
    // Dispatch event to open Settings with About section
    window.dispatchEvent(
      new CustomEvent("openSettings", { detail: { section: "about" } }),
    );
  };

  return (
    <div className="w-full h-7 bg-black/90 flex items-center justify-between select-none flex-shrink-0 border-t border-white/[0.06] relative z-50 px-3">
      {/* Left: System Status */}
      <div className="flex items-center opacity-60 hover:opacity-100 transition-opacity">
        <span className="text-[10px] font-medium text-white tracking-wide uppercase">
          Active
        </span>
      </div>

      {/* Right: Version Info + Update Indicator */}
      <div className="flex items-center gap-2">
        {updateInfo?.hasUpdate && (
          <button
            onClick={handleUpdateClick}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 transition-all group"
            title={`Update available: v${updateInfo.latestVersion}`}
          >
            <span className="text-[9px] font-semibold text-emerald-400 uppercase tracking-wider">
              Update
            </span>
          </button>
        )}
        <span className="text-white/30 text-[10px] font-medium tracking-wider font-mono">
          v{version}
        </span>
      </div>
    </div>
  );
}
