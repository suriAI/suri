import type { BulkRegistrationResult } from "../types";

interface RegistrationResultsProps {
  results: BulkRegistrationResult[];
  successCount: number;
  failedCount: number;
  onClose: () => void;
}

export function RegistrationResults({
  results,
  successCount,
  failedCount,
  onClose,
}: RegistrationResultsProps) {
  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-cyan-400/30 bg-gradient-to-br from-cyan-500/10 to-cyan-600/5 p-6">
          <div className="text-3xl font-light text-cyan-200 mb-1">
            {successCount}
          </div>
          <div className="text-xs text-cyan-300/70 uppercase tracking-wide">
            Registered
          </div>
        </div>
        <div className="rounded-xl border border-red-400/30 bg-gradient-to-br from-red-500/10 to-red-600/5 p-6">
          <div className="text-3xl font-light text-red-200 mb-1">
            {failedCount}
          </div>
          <div className="text-xs text-red-300/70 uppercase tracking-wide">
            Failed
          </div>
        </div>
      </div>

      {/* Details */}
      {results.length > 0 && (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {results.map((result, idx) => (
            <div
              key={idx}
              className={`rounded-xl border p-3 flex items-start gap-3 ${
                result.success
                  ? "border-cyan-400/20 bg-cyan-500/5"
                  : "border-red-400/20 bg-red-500/5"
              }`}
            >
              <div
                className={`h-6 w-6 rounded-lg flex items-center justify-center text-sm ${
                  result.success ? "bg-cyan-500/20" : "bg-red-500/20"
                }`}
              >
                {result.success ? "✓" : "✕"}
              </div>
              <div className="flex-1 min-w-0">
                <div
                  className={`text-sm font-medium ${result.success ? "text-cyan-200" : "text-red-200"}`}
                >
                  {result.memberName || result.personId}
                </div>
                {result.error && (
                  <div className="text-xs text-red-300/80 mt-1">
                    {result.error}
                  </div>
                )}
                {result.qualityWarning && (
                  <div className="text-xs text-yellow-300/80 mt-1">
                    ⚠️ {result.qualityWarning}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={onClose}
        className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-all"
      >
        Done
      </button>
    </div>
  );
}
