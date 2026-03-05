import { useState, useEffect } from "react";

export default function WindowBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
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
      className="w-full h-[32px] flex items-center justify-between select-none flex-shrink-0 relative"
      style={
        {
          WebkitAppRegion: isMaximized ? "no-drag" : "drag",
        } as React.CSSProperties
      }
    >
      <div className="absolute inset-0 bg-black/90 border-b border-white/[0.06] z-40 pointer-events-none"></div>

      <div className="flex items-center ml-4 space-x-3 flex-1 relative z-40 pointer-events-none">
        <img
          src="./icons/suri_mark_logo_transparent.png"
          alt="Suri"
          className="w-6 h-6 object-contain opacity-90 -ml-3 mr-1"
        />

        <div className="flex items-center gap-4">
          <span className="text-[10px] font-bold text-white/30">
            AI Attendance Tracker
          </span>
        </div>
      </div>

      <div
        className="flex items-center h-full relative z-[70] [webkit-app-region:no-drag]"
        style={
          {
            WebkitAppRegion: "no-drag",
            fontFamily: '"Segoe MDL2 Assets", Arial, sans-serif',
          } as React.CSSProperties
        }
      >
        <button
          onClick={handleMinimize}
          title="Minimize"
          className="w-[46px] h-full flex items-center justify-center text-white/70 hover:bg-white/10 transition-colors duration-150 border-none bg-transparent p-0 text-[10px]"
        >
          &#xE921;
        </button>

        <button
          onClick={handleMaximize}
          title={isMaximized ? "Restore" : "Maximize"}
          className="w-[46px] outline-none h-full flex items-center justify-center text-white/70 hover:bg-white/10 transition-colors duration-150 border-none bg-transparent p-0 text-[10px]"
        >
          {isMaximized ? <>&#xE923;</> : <>&#xE922;</>}
        </button>

        <button
          onClick={handleClose}
          title="Close"
          className="w-[46px] outline-none h-full flex items-center justify-center text-white/70 hover:bg-[#e81123] hover:text-white transition-colors duration-150 border-none bg-transparent p-0 text-[10px]"
        >
          &#xE8BB;
        </button>
      </div>
    </div>
  );
}
