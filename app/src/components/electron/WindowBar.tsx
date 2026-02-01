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
      className="w-full h-[46px] bg-black/90 flex items-center justify-between select-none flex-shrink-0 border-b border-white/[0.06] transition-all duration-300 relative z-50"
      style={
        {
          WebkitAppRegion: isMaximized ? "no-drag" : "drag",
        } as React.CSSProperties
      }
    >
      <div className="flex items-center ml-4 space-x-3 flex-1">
        {/* Logo with subtle glow */}
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-full blur opacity-0 group-hover:opacity-100 transition duration-500"></div>
          <img
            src="./icons/suri_mark_logo_transparent.png"
            alt="Suri"
            className="relative w-7 h-7 object-contain opacity-90 group-hover:opacity-100 transition-opacity"
          />
        </div>

        {/* Branding Container */}
        <div className="flex flex-col justify-center leading-none space-y-[2px]">
          <div className="flex items-center space-x-2">
            <span className="text-white font-semibold text-[13px] tracking-wide">
              Suri
            </span>
            <span className="w-1 h-3 border-r border-white/10"></span>
            <span className="text-white/40 text-[11px] font-medium tracking-wide bg-gradient-to-r from-white/60 to-white/40 bg-clip-text text-transparent">
              AI-powered Attendance Tracker
            </span>
          </div>
        </div>
      </div>

      {/* Window Controls */}
      <div
        className="flex items-center h-full [webkit-app-region:no-drag]"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          onClick={handleMinimize}
          className="w-12 h-full flex items-center justify-center text-white/40 hover:bg-white/[0.06] hover:text-white transition-all duration-200 border-none bg-transparent p-0 group"
          title="Minimize"
        >
          <span className="w-3 h-[2px] rounded-full bg-current opacity-60 group-hover:opacity-100"></span>
        </button>

        <button
          onClick={handleMaximize}
          className="w-12 h-full flex items-center justify-center text-white/40 hover:bg-white/[0.06] hover:text-white transition-all duration-200 border-none bg-transparent p-0 group"
          title={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? (
            <i className="far fa-window-restore text-[10px] opacity-60 group-hover:opacity-100"></i>
          ) : (
            <span className="w-2.5 h-2.5 border-[2px] border-current rounded-[2px] opacity-60 group-hover:opacity-100"></span>
          )}
        </button>

        <button
          onClick={handleClose}
          className="w-12 h-full flex items-center justify-center text-white/40 hover:bg-red-500 hover:text-white transition-all duration-200 border-none p-0 group"
          title="Close"
        >
          <i className="fa fa-times text-[14px] opacity-60 group-hover:opacity-100 font-light"></i>
        </button>
      </div>
    </div>
  );
}
