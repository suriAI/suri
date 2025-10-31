interface MobileHeaderProps {
  onClose: () => void;
}

export function MobileHeader({ onClose }: MobileHeaderProps) {
  return (
    <div className="h-16 border-b border-white/10 flex items-center justify-between px-6">
      <h2 className="text-lg font-semibold text-white">Menu</h2>
      <button
        onClick={onClose}
        className="p-2 hover:bg-white/10 rounded-lg transition-colors group"
        aria-label="Close menu"
      >
        <div className="relative w-4 h-4">
          <div className="absolute top-1/2 left-1/2 w-3 h-0.5 bg-white/70 group-hover:bg-white transition-all duration-200 rotate-45 -translate-x-1/2 -translate-y-1/2"></div>
          <div className="absolute top-1/2 left-1/2 w-3 h-0.5 bg-white/70 group-hover:bg-white transition-all duration-200 -rotate-45 -translate-x-1/2 -translate-y-1/2"></div>
        </div>
      </button>
    </div>
  );
}
