import type { AttendanceMember } from "@/types/recognition";
import { Modal } from "@/components/common";

interface DeleteMemberModalProps {
  isOpen: boolean;
  member: AttendanceMember | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteMemberModal({
  isOpen,
  member,
  onClose,
  onConfirm,
}: DeleteMemberModalProps) {
  if (!member) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Remove Member"
      icon={<i className="fa-solid fa-user-xmark text-red-200"></i>}
      maxWidth="md"
    >
      <div className="mb-6">
        <p className="text-white mb-4">
          Are you sure you want to remove{" "}
          <strong>&quot;{member.name}&quot;</strong> from this group?
        </p>
        <div className="bg-red-900/30 border border-red-500/40 rounded-lg p-3">
          <p className="text-red-300 text-sm">
            <strong>Warning:</strong> This will also wipe their attendance
            records and registered face data for this group.
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-3 mt-8">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-colors text-sm font-medium"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="px-6 py-2 rounded-lg bg-red-500/20 border border-red-500/40 text-red-200 hover:bg-red-500/30 transition-colors text-sm font-medium"
        >
          Remove Member
        </button>
      </div>
    </Modal>
  );
}
