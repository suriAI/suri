import { useState, useMemo } from "react";
import { attendanceManager } from "@/services/AttendanceManager";
import { Dropdown } from "@/components/shared";
import type { AttendanceMember } from "@/components/main/types";

interface ManualEntryModalProps {
  onClose: () => void;
  onSuccess: () => void;
  members: AttendanceMember[];
  presentPersonIds: Set<string>;
  onAddMember: () => void;
}

export const ManualEntryModal = ({
  onClose,
  onSuccess,
  members,
  presentPersonIds,
  onAddMember,
}: ManualEntryModalProps) => {
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter out members who are already present
  const absentMembers = useMemo(() => {
    return members
      .filter((m) => !presentPersonIds.has(m.person_id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [members, presentPersonIds]);

  const handleSubmit = async () => {
    if (!selectedPersonId) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await attendanceManager.addRecord({
        person_id: selectedPersonId,
        timestamp: new Date(),
        is_manual: true,
        notes: "Manual entry by admin",
      });
      onSuccess();
      onClose();
    } catch (err) {
      setError("Failed to add record. Please try again.");
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-[#09090b]/95 border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          {/* Header */}
          <div className="flex justify-between items-center mb-5">
            <div>
              <h2 className="text-base font-semibold text-white tracking-tight flex items-center gap-2">
                <i className="fa-solid fa-users text-blue-400 text-sm"></i>
                Members
              </h2>
              <p className="text-white/40 text-[10px] mt-0.5 font-medium">
                {members.length} Total • {presentPersonIds.size} Present
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all"
            >
              <i className="fa-solid fa-xmark text-xs"></i>
            </button>
          </div>

          {/* Content */}
          <div className="space-y-4">
            {/* Compact Add Row */}
            <div className="bg-white/[0.03] rounded-xl p-1.5 border border-white/[0.05]">
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <Dropdown
                    options={absentMembers.map((m) => ({
                      value: m.person_id,
                      label: m.name,
                    }))}
                    value={selectedPersonId}
                    onChange={setSelectedPersonId}
                    placeholder={
                      absentMembers.length > 0
                        ? "Select absent member..."
                        : "All members present"
                    }
                    emptyMessage="No absent members"
                    maxHeight={200}
                    buttonClassName="w-full bg-transparent border-none hover:bg-white/5 text-xs py-2 rounded-lg transition-all text-white/90 h-8"
                    allowClear={true}
                    iconClassName="text-[10px] opacity-50"
                  />
                </div>
                <button
                  onClick={handleSubmit}
                  disabled={!selectedPersonId || isSubmitting}
                  className="px-3 py-1.5 text-xs font-semibold bg-blue-500 hover:bg-blue-400 text-white rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 whitespace-nowrap h-8"
                >
                  {isSubmitting ? (
                    <i className="fa-solid fa-circle-notch fa-spin"></i>
                  ) : (
                    <>
                      <i className="fa-solid fa-plus text-[10px]"></i>
                      Add
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] font-medium flex items-center gap-2">
                <i className="fa-solid fa-circle-exclamation"></i>
                {error}
              </div>
            )}

            {/* Footer with Add Member Button */}
            <div className="pt-3 border-t border-white/5">
              <button
                onClick={() => {
                  onClose();
                  onAddMember();
                }}
                className="w-full px-4 py-2 text-xs bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.1] rounded text-white/70 hover:text-white/90 transition-colors flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-user-plus text-xs"></i>
                Add Member
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
