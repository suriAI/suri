import type { AttendanceGroup } from "@/components/main/types";
import { Modal } from "@/components/common";

interface DeleteConfirmationModalProps {
  showDeleteConfirmation: boolean;
  groupToDelete: AttendanceGroup | null;
  currentGroup: AttendanceGroup | null;
  cancelDeleteGroup: () => void;
  confirmDeleteGroup: () => void;
}

export function DeleteConfirmationModal({
  showDeleteConfirmation,
  groupToDelete,
  currentGroup,
  cancelDeleteGroup,
  confirmDeleteGroup,
}: DeleteConfirmationModalProps) {
  if (!groupToDelete) return null;

  return (
    <Modal
      isOpen={showDeleteConfirmation}
      onClose={cancelDeleteGroup}
      title="Delete group"
      icon={<i className="fa-solid fa-triangle-exclamation text-red-300"></i>}
      maxWidth="md"
    >
      <div className="mb-6">
        <p className="text-white/80 text-sm mb-4">
          Are you sure you want to delete the group{" "}
          <strong className="text-white">"{groupToDelete.name}"</strong>?
        </p>
        <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 mb-4">
          <p className="text-red-300 text-xs">
            <strong>Warning:</strong> This action cannot be undone. All group
            data, members, and attendance records will be permanently removed.
          </p>
        </div>
        {currentGroup?.id === groupToDelete.id && (
          <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-3">
            <p className="text-amber-300 text-xs">
              <strong>Note:</strong> This is your currently active group.
              Deleting it will clear your current selection.
            </p>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={confirmDeleteGroup}
          className="btn-error flex-1 px-4 py-2 rounded-lg text-sm"
        >
          Delete Group
        </button>
      </div>
    </Modal>
  );
}
