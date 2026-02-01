import type { AttendanceGroup, AttendanceMember } from "@/types/recognition";
import { useBulkRegistration } from "@/components/group/sections/registration/hooks/useBulkRegistration";
import { BulkUploadArea } from "@/components/group/shared";
import { FaceAssignmentGrid } from "@/components/group/sections/registration/components/FaceAssignmentGrid";
import { RegistrationResults } from "@/components/group/sections/registration/components/RegistrationResults";

interface BulkRegistrationProps {
  group: AttendanceGroup;
  members: AttendanceMember[];
  onRefresh?: () => Promise<void> | void;
  onClose: () => void;
}

export function BulkRegistration({
  group,
  members,
  onRefresh,
  onClose,
}: BulkRegistrationProps) {
  const {
    uploadedFiles,
    detectedFaces,
    isDetecting,
    isRegistering,
    error,
    setError,
    registrationResults,
    availableMembers,
    pendingDuplicates,
    handleFilesSelected,
    handleConfirmDuplicates,
    handleCancelDuplicates,
    handleDismissDuplicates,
    handleAssignMember,
    handleUnassign,
    handleBulkRegister,
    handleClearFiles,
  } = useBulkRegistration(group, members, onRefresh);

  const assignedCount = detectedFaces.filter((f) => f.assignedPersonId).length;
  const successCount =
    registrationResults?.filter((r) => r.success).length || 0;
  const failedCount =
    registrationResults?.filter((r) => !r.success).length || 0;

  return (
    <div className="h-full flex flex-col overflow-hidden relative bg-[#0a0a0a]">
      {/* Duplicate Confirmation Modal */}
      {pendingDuplicates && (
        <>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 z-40" />

          {/* Modal */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-[1.5rem] border border-amber-500/30 bg-black/90 p-6 min-w-[360px] max-w-[95%] intro-y shadow-[0_20px_50px_rgba(0,0,0,0.7)]">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 flex items-center justify-center">
                <i className="fa-solid fa-triangle-exclamation text-xl text-amber-400"></i>
              </div>
              <div>
                <h4 className="text-base font-black text-white">
                  Duplicate Files Detected
                </h4>
                <p className="text-xs text-amber-200/60 font-medium">
                  {pendingDuplicates.duplicates.length} file(s) already uploaded
                </p>
              </div>
            </div>

            <div className="mb-5">
              <p className="text-xs text-white/60 mb-2">
                The following files appear to be duplicates:
              </p>
              <div className="max-h-28 overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-2.5 space-y-1 custom-scroll">
                {pendingDuplicates.duplicates.map((file, idx) => (
                  <div
                    key={idx}
                    className="text-xs text-white/50 flex items-center gap-2"
                  >
                    <i className="fa-solid fa-file-image text-white/30 text-[10px]"></i>
                    <span className="truncate">{file.name}</span>
                  </div>
                ))}
              </div>
              {pendingDuplicates.newFiles.length > 0 && (
                <p className="text-[10px] text-white/40 mt-2">
                  {pendingDuplicates.newFiles.length} new file(s) will be added
                  regardless.
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => void handleDismissDuplicates()}
                className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 text-[10px] font-black uppercase tracking-widest transition-all"
              >
                Cancel
              </button>
              {pendingDuplicates.newFiles.length > 0 && (
                <button
                  onClick={() => void handleCancelDuplicates()}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/20 text-[10px] font-black uppercase tracking-widest transition-all"
                >
                  Skip
                </button>
              )}
              <button
                onClick={() => void handleConfirmDuplicates()}
                className="flex-1 px-4 py-2.5 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-400 hover:bg-amber-500/30 text-[10px] font-black uppercase tracking-widest transition-all"
              >
                Add Anyway
              </button>
            </div>
          </div>
        </>
      )}

      {/* Error Alert */}
      {error && (
        <div className="mx-6 mt-4 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-200 flex items-center gap-3 flex-shrink-0">
          <div className="h-1 w-1 rounded-full bg-red-400 animate-pulse" />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-200/50 hover:text-red-100 transition"
          >
            <i className="fa fa-times text-xs"></i>
          </button>
        </div>
      )}

      {/* Main Content */}
      <div
        className={`flex-1 overflow-y-auto px-6 py-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent ${
          !registrationResults && uploadedFiles.length === 0
            ? "flex flex-col justify-center"
            : ""
        }`}
      >
        {/* Step 1: Upload Files */}
        {!registrationResults && (
          <BulkUploadArea
            uploadedCount={uploadedFiles.length}
            isDetecting={isDetecting}
            onFilesSelected={handleFilesSelected}
            onClear={handleClearFiles}
          />
        )}

        {/* Step 2: Assign Members */}
        {detectedFaces.length > 0 && !registrationResults && (
          <FaceAssignmentGrid
            detectedFaces={detectedFaces}
            members={members}
            availableMembers={availableMembers}
            assignedCount={assignedCount}
            isRegistering={isRegistering}
            onAssignMember={handleAssignMember}
            onUnassign={handleUnassign}
            onBulkRegister={handleBulkRegister}
          />
        )}

        {/* Step 3: Results */}
        {registrationResults && (
          <RegistrationResults
            results={registrationResults}
            successCount={successCount}
            failedCount={failedCount}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}
