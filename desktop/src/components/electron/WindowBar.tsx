import { useState, useEffect } from "react";

export default function WindowBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    // Listen for window state changes
    const handleMaximize = () => setIsMaximized(true);
    const handleUnmaximize = () => setIsMaximized(false);

    let cleanupMaximize: (() => void) | undefined;
    let cleanupUnmaximize: (() => void) | undefined;

    if (window.suriElectron) {
      cleanupMaximize = window.suriElectron.onMaximize(handleMaximize);
      cleanupUnmaximize = window.suriElectron.onUnmaximize(handleUnmaximize);
    }

    return () => {
      if (cleanupMaximize) cleanupMaximize();
      if (cleanupUnmaximize) cleanupUnmaximize();
    };
  }, []);

  const handleMinimize = () => {
    if (window.suriElectron) {
      window.suriElectron.minimize();
    }
  };

  const handleMaximize = () => {
    if (window.suriElectron) {
      window.suriElectron.maximize();
    }
  };

  const handleClose = () => {
    if (window.suriElectron) {
      window.suriElectron.close();
    }
  };

  return (
    <div
      className="z-60 absolute top-0 w-full h-auto bg-gradient-surface flex items-center justify-between select-none flex-shrink-0 border-b border-white/[0.08]"
      style={
        {
          WebkitAppRegion: isMaximized ? "no-drag" : "drag",
        } as React.CSSProperties
      }
    >
      <div className="flex items-center ml-3 space-x-1 flex-1">
        <img src="/icons/icon-1024.png" alt="Suri" className="w-9 h-9" />
        <span className="text-white/40 text-[11px] font-medium">
          AI-Powered Attendance Tracker
        </span>
      </div>

      <div
        className="flex items-center [webkit-app-region:no-drag]"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          onClick={handleMinimize}
          className="w-11.5 h-9 flex items-center justify-center text-white/40 hover:bg-white/10 transition-all duration-200 border-none bg-transparent p-0 rounded"
          title="Minimize"
        >
          <i className="fas fa-window-minimize text-[10px] pb-1.5"></i>
        </button>

        <button
          onClick={handleMaximize}
          className="w-11.5 h-9 flex items-center justify-center text-white/40 hover:bg-white/10 transition-all duration-200 border-none bg-transparent p-0 rounded"
          title={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? (
            <i className="far fa-window-restore text-[11px]"></i>
          ) : (
            <i className="far fa-square text-[11px]"></i>
          )}
        </button>

        <button
          onClick={handleClose}
          className="w-11.5 h-9 flex items-center justify-center text-white/40 hover:bg-red-500/90 hover:text-white bg-transparent transition-all duration-200 border-none p-0 rounded"
          title="Close"
        >
          <i className="fa fa-times text-[14px]"></i>
        </button>
      </div>
    </div>
  );
}
