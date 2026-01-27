export default function WindowFooter() {
  return (
    <div className="w-full h-7 bg-black/60 backdrop-blur-xl flex items-center justify-between select-none flex-shrink-0 border-t border-white/[0.06] relative z-50 px-3">
      {/* Left: System Status */}
      <div className="flex items-center opacity-60 hover:opacity-100 transition-opacity">
        <span className="text-[10px] font-medium text-white tracking-wide uppercase">
          Active
        </span>
      </div>

      {/* Right: Version Info */}
      <div className="flex items-center">
        <span className="text-white/30 text-[10px] font-medium tracking-wider font-mono">
          v1.0.0
        </span>
      </div>
    </div>
  );
}
