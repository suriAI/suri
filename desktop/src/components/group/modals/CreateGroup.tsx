import { useState } from 'react';
import { attendanceManager } from '../../../services/AttendanceManager.js';
import type { AttendanceGroup } from '../../../types/recognition.js';
import { ErrorMessage } from '../../common/ErrorMessage';
import { FormInput } from '../../common/FormInput';
import { FormTextarea } from '../../common/FormTextarea';

interface CreateGroupProps {
  onClose: () => void;
  onSuccess: (group: AttendanceGroup) => void;
}

export function CreateGroup({ onClose, onSuccess }: CreateGroupProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) {
      return;
    }

    setLoading(true);
    try {
      const newGroup = await attendanceManager.createGroup(
        name.trim(),
        description.trim() || undefined
      );
      onSuccess(newGroup);
      onClose();
    } catch (err) {
      console.error('Error creating group:', err);
      setError(err instanceof Error ? err.message : 'Failed to create group');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
      <div className="bg-[#0f0f0f] border border-white/10 rounded-3xl p-6 w-full max-w-lg shadow-[0_40px_80px_rgba(0,0,0,0.6)]">
        <h3 className="text-xl font-semibold mb-2">Create New Group</h3>
        <p className="text-sm text-white/60 mb-4">Set up a new attendance group</p>

        {error && (
          <ErrorMessage message={error} />
        )}

        <div className="grid gap-4">
          <label className="text-sm">
            <span className="text-white/60 block mb-2">Group name *</span>
            <FormInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. CS101 Section A, Engineering Team"
              focusColor="border-emerald-500/60"
            />
          </label>

          <label className="text-sm">
            <span className="text-white/60 block mb-2">Description (optional)</span>
            <FormTextarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Brief description of this group..."
              focusColor="border-emerald-500/60"
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
            onClick={handleCreate}
            disabled={!name.trim() || loading}
            className="btn-success text-sm px-4 py-2 disabled:opacity-50"
          >
            {loading ? 'Creating…' : 'Create Group'}
          </button>
        </div>
      </div>
    </div>
  );
}

