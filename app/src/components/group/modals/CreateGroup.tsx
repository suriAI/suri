import { useState } from "react";
import { attendanceManager } from "@/services";
import type { AttendanceGroup } from "@/types/recognition";
import {
  ErrorMessage,
  FormInput,
  FormTextarea,
  Modal,
} from "@/components/common";

interface CreateGroupProps {
  onClose: () => void;
  onSuccess: (group: AttendanceGroup) => void;
}

export function CreateGroup({ onClose, onSuccess }: CreateGroupProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
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
        description.trim() || undefined,
      );
      onSuccess(newGroup);
      onClose();
    } catch (err) {
      console.error("Error creating group:", err);
      setError(err instanceof Error ? err.message : "Failed to create group");
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
          <h3 className="text-xl font-semibold mb-2">Create New Group</h3>
          <p className="text-sm text-white/60 font-normal">
            Set up a new attendance group
          </p>
        </div>
      }
      maxWidth="lg"
    >
      <div className="mt-2">
        {error && <ErrorMessage message={error} />}

        <div className="grid gap-4">
          <label className="text-sm">
            <span className="text-white/60 block mb-2">Group name *</span>
            <FormInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. CS101 Section A, Engineering Team"
              focusColor="border-cyan-500/60"
            />
          </label>

          <label className="text-sm">
            <span className="text-white/60 block mb-2">
              Description (optional)
            </span>
            <FormTextarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Brief description of this group..."
              focusColor="border-cyan-500/60"
            />
          </label>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={handleCreate}
            disabled={!name.trim() || loading}
            className="w-full px-4 py-2 rounded-xl bg-cyan-500/20 border border-cyan-400/40 text-cyan-100 hover:bg-cyan-500/30 transition-colors text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Creating…" : "Create Group"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
