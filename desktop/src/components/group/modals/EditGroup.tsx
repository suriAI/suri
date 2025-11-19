import { useState } from "react";
import { attendanceManager } from "../../../services";
import type { AttendanceGroup } from "../../../types/recognition.js";
import { ErrorMessage, FormInput } from "../../common";

interface EditGroupProps {
  group: AttendanceGroup;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditGroup({ group, onClose, onSuccess }: EditGroupProps) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) {
      return;
    }

    setLoading(true);
    try {
      await attendanceManager.updateGroup(group.id, {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      onSuccess();
      onClose();
    } catch (err) {
      console.error("Error updating group:", err);
      setError(err instanceof Error ? err.message : "Failed to update group");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
      <div className="bg-[#0f0f0f] border border-white/10 rounded-3xl p-6 w-full max-w-lg shadow-[0_40px_80px_rgba(0,0,0,0.6)]">
        <h3 className="text-xl font-semibold mb-2">Edit Group</h3>
        <p className="text-sm text-white/60 mb-4">Update group information</p>

        {error && <ErrorMessage message={error} />}

        <div className="grid gap-4">
          <label className="text-sm">
            <span className="text-white/60 block mb-2">Group name *</span>
            <FormInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. CS101 Section A, Engineering Team"
              focusColor="border-blue-500/60"
            />
          </label>

          <label className="text-sm">
            <span className="text-white/60 block mb-2">
              Description (optional)
            </span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-blue-500/60 min-h-[80px]"
              placeholder="Brief description of this group..."
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
            className="btn-secondary text-sm px-4 py-2 disabled:opacity-50"
          >
            {loading ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
