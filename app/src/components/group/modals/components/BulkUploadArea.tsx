interface BulkUploadAreaProps {
  uploadedCount: number;
  isDetecting: boolean;
  onFilesSelected: (files: FileList | null) => void;
}

export function BulkUploadArea({
  uploadedCount,
  isDetecting,
  onFilesSelected,
}: BulkUploadAreaProps) {
  return (
    <div className="mb-6">
      <label className="group relative flex h-48 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/10 bg-gradient-to-br from-white/5 to-transparent hover:border-white/20 hover:from-white/10 transition-all overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-white/0 to-white/0 group-hover:from-white/5 group-hover:to-transparent transition-all" />
        <div className="relative flex flex-col items-center gap-3">
          <div className="text-center">
            <div className="text-sm text-white/70 mb-1">
              Drop images or click to browse
            </div>
            <div className="text-xs text-white/40">
              Up to 50 photos • Class or individual
            </div>
          </div>
          {uploadedCount > 0 && (
            <div className="flex items-center gap-2 mt-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20">
              <div className="h-1.5 w-1.5 rounded-full bg-white/60" />
              <span className="text-xs text-white/70">
                {uploadedCount} images uploaded
              </span>
            </div>
          )}
        </div>
        <input
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => onFilesSelected(e.target.files)}
        />
      </label>

      {/* Show detection progress when analyzing */}
      {isDetecting && uploadedCount > 0 && (
        <div className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-white/10 to-white/5 border border-white/20 px-4 py-4 text-sm font-medium text-white">
          <div className="h-4 w-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
          <span>Analyzing {uploadedCount} images...</span>
        </div>
      )}
    </div>
  );
}
