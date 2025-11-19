interface GroupHeaderProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export function GroupHeader({
  isCollapsed,
  onToggleCollapse,
}: GroupHeaderProps) {
  return (
    <div className="px-4 py-4 border-b border-white/10 flex items-center justify-between">
      {!isCollapsed && (
        <div className="flex items-center gap-2">
          <img src="/icons/icon-1024.png" alt="Suri" className="w-9 h-9" />
          <h1 className="text-lg font-semibold text-white">Group</h1>
        </div>
      )}

      {/* Collapse/Expand Button */}
      <button
        onClick={onToggleCollapse}
        className={`w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-all group ${isCollapsed ? "mx-auto" : "ml-auto"}`}
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <i
          className={`fa-solid text-sm ${isCollapsed ? "fa-chevron-right" : "fa-chevron-left"} text-white/50 group-hover:text-white transition-all duration-200`}
        ></i>
      </button>
    </div>
  );
}
