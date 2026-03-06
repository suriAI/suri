import { useState } from "react";
import { attendanceManager } from "@/services";
import type { AttendanceGroup } from "@/types/recognition";
import { ErrorMessage, FormInput, Modal } from "@/components/common";

interface CreateGroupProps {
  onClose: () => void;
  onSuccess: (group: AttendanceGroup) => void;
}

export function CreateGroup({ onClose, onSuccess }: CreateGroupProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) {
      return;
    }

    setLoading(true);
    try {
      const newGroup = await attendanceManager.createGroup(name.trim());
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
          <h3 className="text-xl font-semibold mb-2">Create Group</h3>
        </div>
      }
      maxWidth="lg"
    >
      <div className="mt-2">
        {error && <ErrorMessage message={error} />}

        <div className="grid gap-4">
          <FormInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Enter Group Name"
            focusColor="border-cyan-500/60"
          />
        </div>

        <div className="flex justify-end gap-3 mt-8">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-colors text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || loading}
            className="px-6 py-2 rounded-lg bg-cyan-500/20 border border-cyan-400/40 text-cyan-100 hover:bg-cyan-500/30 transition-colors text-sm font-medium disabled:opacity-50 min-w-[120px]"
          >
            {loading ? "Creating…" : "Create Group"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
