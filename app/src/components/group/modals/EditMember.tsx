import { useState } from "react";
import { attendanceManager } from "@/services";
import type { AttendanceMember } from "@/types/recognition";
import { Modal } from "@/components/common";

interface EditMemberProps {
  member: AttendanceMember;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditMember({ member, onClose, onSuccess }: EditMemberProps) {
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState(member.role || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) {
      return;
    }

    setLoading(true);
    try {
      const updates: Partial<AttendanceMember> = {
        name: name.trim(),
        role: role.trim() || undefined,
      };

      await attendanceManager.updateMember(member.person_id, updates);
      onSuccess();
      onClose();
    } catch (err) {
      console.error("Error updating member:", err);
      setError(err instanceof Error ? err.message : "Failed to update member");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={
        <div>
          <h3 className="text-xl font-semibold mb-2">Edit Member</h3>
          <p className="text-sm text-white/60 font-normal">
            Update member details and role
          </p>
        </div>
      }
      maxWidth="lg"
    >
      <div className="mt-2">
        {error && (
          <div className="mb-4 px-4 py-2 bg-red-600/20 border border-red-500/40 text-red-200 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="grid gap-4">
          <label className="text-sm">
            <span className="text-white/60 block mb-2">Full name *</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-cyan-500/60 transition-colors"
              placeholder="Enter full name"
            />
          </label>
          <label className="text-sm">
            <span className="text-white/60 block mb-2">Role (optional)</span>
            <input
              type="text"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-cyan-500/60 transition-colors"
              placeholder="e.g. Staff, Student, Teacher"
            />
          </label>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={handleSave}
            disabled={!name.trim() || loading}
            className="w-full px-4 py-2 rounded-xl bg-cyan-500/20 border border-cyan-400/40 text-cyan-100 hover:bg-cyan-500/30 transition-colors text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
