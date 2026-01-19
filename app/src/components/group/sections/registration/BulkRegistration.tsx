import type {
  AttendanceGroup,
  AttendanceMember,
} from "../../../../types/recognition";
import { useBulkRegistration } from "./hooks/useBulkRegistration";
import { BulkUploadArea } from "./components/BulkUploadArea";
import { FaceAssignmentGrid } from "./components/FaceAssignmentGrid";
import { RegistrationResults } from "./components/RegistrationResults";

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
    handleFilesSelected,
    handleAssignMember,
    handleUnassign,
    handleBulkRegister,
  } = useBulkRegistration(group, members, onRefresh);

  const assignedCount = detectedFaces.filter((f) => f.assignedPersonId).length;
  const successCount =
    registrationResults?.filter((r) => r.success).length || 0;
  const failedCount =
    registrationResults?.filter((r) => !r.success).length || 0;

  return (
    <div className="h-full flex flex-col overflow-hidden relative bg-[#0a0a0a]">
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
