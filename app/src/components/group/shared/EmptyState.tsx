interface EmptyStateProps {
  title: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({ title, action, className = "" }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-1 items-center justify-center min-h-0 h-full w-full ${className}`}
    >
      <div className="flex flex-col items-center justify-center space-y-3 text-center">
        <div className="text-white/40 text-xs font-medium tracking-tight">
          {title}
        </div>

        {action && (
          <button
            onClick={action.onClick}
            className="px-4 py-2 text-xs bg-white/5 hover:bg-white/10 border border-white/[0.1] rounded text-white/70 hover:text-white/90 transition-colors flex items-center gap-2 active:scale-95"
          >
            <i className="fa-solid fa-user-plus text-xs"></i>
            <span className="font-bold">{action.label}</span>
          </button>
        )}
      </div>
    </div>
  );
}
