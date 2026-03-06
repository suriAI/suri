import { Modal } from "@/components/common";

interface BulkConsentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  memberCount: number;
}

export function BulkConsentModal({
  isOpen,
  onClose,
  onConfirm,
  memberCount,
}: BulkConsentModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      icon={<i className="fa-solid fa-shield-check text-cyan-400"></i>}
      maxWidth="md"
    >
      <div className="mt-2 space-y-4">
        <p className="text-sm text-center leading-relaxed text-white/85">
          Are you sure you want to grant biometric consent to
          <span className="font-semibold text-cyan-300"> {memberCount}</span>
          <span className="text-white/65">
            {" "}
            member{memberCount !== 1 ? "s" : ""}
          </span>
          <span className="text-white/85"> in this group?</span>
        </p>

        <div className="rounded-lg border border-white/6 bg-black/30 px-4 py-3">
          <p className="text-xs leading-relaxed text-white/50">
            Proceed only if explicit and informed permission has already been
            obtained from each individual, or from their legal representative
            where required.
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-3 mt-8">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-colors text-sm font-medium"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="px-6 py-2 rounded-lg border border-cyan-400/30 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25 transition-colors text-sm font-medium"
        >
          Grant Consent
        </button>
      </div>
    </Modal>
  );
}
