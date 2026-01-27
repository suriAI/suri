interface EmptyStateProps {
  onCreateGroup: () => void;
  hasGroups: boolean;
}

export function EmptyState({ onCreateGroup, hasGroups }: EmptyStateProps) {
  if (hasGroups) {
    // Has groups but none selected
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4 max-w-md">
          <div>
            <h3 className="text-lg font-medium text-white/90 mb-2">
              No group selected
            </h3>
            <p className="text-sm text-white/50">
              Select a group first to view details
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-4 max-w-md">
        <div>
          <h3 className="text-lg font-medium text-white/90 mb-2">
            No groups yet
          </h3>
          <p className="text-sm text-white/50">
            Create your first attendance group to get started
          </p>
        </div>
        <button
          onClick={onCreateGroup}
          className="px-4 py-2.5 rounded-xl bg-cyan-500/20 border border-cyan-400/40 text-cyan-100 hover:bg-cyan-500/30 transition-colors text-sm flex items-center gap-2 mx-auto"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4.5v15m7.5-7.5h-15"
              strokeWidth={2.5}
            />
          </svg>
          Create Group
        </button>
      </div>
    </div>
  );
}
