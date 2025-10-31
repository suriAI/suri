import { useState } from 'react';
import { attendanceManager } from '../../../services/AttendanceManager.js';
import type { AttendanceMember } from '../../../types/recognition.js';

interface EditMemberProps {
  member: AttendanceMember;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditMember({ member, onClose, onSuccess }: EditMemberProps) {
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState(member.role || '');
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
        role: role.trim() || undefined
      };

      await attendanceManager.updateMember(member.person_id, updates);
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Error updating member:', err);
      setError(err instanceof Error ? err.message : 'Failed to update member');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
      <div className="bg-[#0f0f0f] border border-white/10 rounded-2xl p-6 w-full max-w-lg shadow-[0_40px_80px_rgba(0,0,0,0.6)]">
        <h3 className="text-xl font-semibold mb-4">Edit member</h3>
        
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
              onChange={event => setName(event.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-blue-500/60"
              placeholder="Enter full name"
            />
          </label>
          <label className="text-sm">
            <span className="text-white/60 block mb-2">Role (optional)</span>
            <input
              type="text"
              value={role}
              onChange={event => setRole(event.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-blue-500/60"
              placeholder="e.g. Staff, Student, Teacher"
            />
          </label>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || loading}
            className="px-4 py-2 rounded-xl bg-blue-500/20 border border-blue-400/40 text-blue-100 hover:bg-blue-500/30 transition-colors text-sm disabled:opacity-50"
          >
            {loading ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

