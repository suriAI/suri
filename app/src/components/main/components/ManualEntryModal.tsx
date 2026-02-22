import { useState, useMemo, useEffect } from "react";
import { attendanceManager } from "@/services/AttendanceManager";
import { Dropdown } from "@/components/shared";
import { Modal } from "@/components/common";
import type {
  AttendanceMember,
  AttendanceGroup,
} from "@/components/main/types";

interface ManualEntryModalProps {
  onClose: () => void;
  onSuccess: () => void;
  members: AttendanceMember[];
  presentPersonIds: Set<string>;
  onAddMember: () => void;
  currentGroup?: AttendanceGroup | null;
}

export const ManualEntryModal = ({
  onClose,
  onSuccess,
  members,
  presentPersonIds,
  onAddMember,
  currentGroup,
}: ManualEntryModalProps) => {
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [faceDataMap, setFaceDataMap] = useState<Map<string, boolean>>(
    new Map(),
  );

  // Fetch face enrollment status for all members in the current group
  useEffect(() => {
    if (!currentGroup?.id) return;
    attendanceManager
      .getGroupPersons(currentGroup.id)
      .then((persons: AttendanceMember[]) => {
        const map = new Map<string, boolean>();
        persons.forEach((p) => map.set(p.person_id, p.has_face_data ?? false));
        setFaceDataMap(map);
      })
      .catch(() => {
        // Silently ignore — face status is informational only
      });
  }, [currentGroup?.id]);

  const absentMembers = useMemo(() => {
    return members
      .filter((m) => !presentPersonIds.has(m.person_id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [members, presentPersonIds]);

  const sortedAllMembers = useMemo(() => {
    return [...members].sort((a, b) => a.name.localeCompare(b.name));
  }, [members]);

  const noFaceCount = useMemo(() => {
    return sortedAllMembers.filter(
      (m) => faceDataMap.size > 0 && !faceDataMap.get(m.person_id),
    ).length;
  }, [sortedAllMembers, faceDataMap]);

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
    <Modal
      isOpen={true}
      onClose={onClose}
      title={
        <div className="flex flex-col -mt-0.5">
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-users text-blue-400 text-sm"></i>
            <span>Members</span>
          </div>
          <p className="text-white/40 text-[10px] mt-0.5 font-medium">
            {members.length} Total • {presentPersonIds.size} Present
            {noFaceCount > 0 && (
              <span className="text-amber-400/80 ml-1">
                • {noFaceCount} need re-enrollment
              </span>
            )}
          </p>
        </div>
      }
      maxWidth="sm"
    >
      <div className="space-y-4">
        {/* Compact Add Row */}
        <div className=" rounded-xl p-1.5 pt-0">
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

        {/* Member Roster with face status */}
        {sortedAllMembers.length > 0 && (
          <div className="border border-white/[0.06] rounded-lg overflow-hidden">
            <div className="max-h-[220px] overflow-y-auto divide-y divide-white/[0.04]">
              {sortedAllMembers.map((member) => {
                const isPresent = presentPersonIds.has(member.person_id);
                const hasFace =
                  faceDataMap.size === 0
                    ? null // still loading
                    : (faceDataMap.get(member.person_id) ?? false);

                return (
                  <div
                    key={member.person_id}
                    className="flex items-center gap-2.5 px-3 py-2"
                  >
                    {/* Status dot */}
                    <div
                      className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${
                        isPresent ? "bg-emerald-400" : "bg-white/20"
                      }`}
                    />

                    {/* Name */}
                    <span className="flex-1 text-[11px] text-white/80 truncate">
                      {member.name}
                    </span>

                    {/* Badges */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {isPresent && (
                        <span className="text-[9px] font-semibold text-emerald-400/80 uppercase tracking-wide">
                          Present
                        </span>
                      )}
                      {hasFace === false && (
                        <span
                          className="flex items-center gap-1 text-[9px] font-medium text-amber-400/70 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 rounded"
                          title="Face not enrolled! This member wasn't registered yet or was imported from another device. They must be enrolled on this device to be recognized by the camera."
                        >
                          <i className="fa-solid fa-user-slash text-[8px]"></i>
                          No face data
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Re-enrollment note */}
        {noFaceCount > 0 && (
          <p className="text-[9px] text-amber-400/60 leading-relaxed flex items-start gap-1.5">
            <i className="fa-solid fa-circle-info mt-[1px] flex-shrink-0"></i>
            Members marked "No face data" weren't registered yet or were
            imported from another device. They must be enrolled on this device
            to be recognized by the camera.
          </p>
        )}

        {/* Footer with Add Member Button */}
        <div className="pt-3 border-t border-white/5">
          <button
            onClick={() => {
              onClose();
              onAddMember();
            }}
            className="w-full px-4 py-2 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/70 hover:text-white transition-colors flex items-center justify-center gap-2"
          >
            <i className="fa-solid fa-user-plus text-xs"></i>
            Add Member
          </button>
        </div>
      </div>
    </Modal>
  );
};
