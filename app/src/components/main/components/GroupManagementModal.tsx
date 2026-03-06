import { useEffect, useRef } from "react";
import { FormInput, Modal } from "@/components/common";

interface GroupManagementModalProps {
  showGroupManagement: boolean;
  setShowGroupManagement: (show: boolean) => void;
  newGroupName: string;
  setNewGroupName: (name: string) => void;
  handleCreateGroup: () => void;
}

export function GroupManagementModal({
  showGroupManagement,
  setShowGroupManagement,
  newGroupName,
  setNewGroupName,
  handleCreateGroup,
}: GroupManagementModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showGroupManagement && inputRef.current) {
      const focusInput = () => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
          inputRef.current.click();
        }
      };

      requestAnimationFrame(() => {
        focusInput();
        setTimeout(focusInput, 50);
        setTimeout(focusInput, 150);
      });
    }
  }, [showGroupManagement]);

  // Handle Enter key for submission
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && newGroupName.trim()) {
      handleCreateGroup();
    }
  };

  return (
    <Modal
      isOpen={showGroupManagement}
      onClose={() => setShowGroupManagement(false)}
      title="Create Group"
      maxWidth="sm"
    >
      <div className="space-y-3 mt-2">
        <div>
          <FormInput
            ref={inputRef}
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter group name"
            focusColor="border-cyan-500/60"
          />
        </div>
        <div className="flex justify-end gap-3 mt-8">
          <button
            onClick={() => setShowGroupManagement(false)}
            className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-colors text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleCreateGroup}
            disabled={!newGroupName.trim()}
            className="px-6 py-2 rounded-lg bg-cyan-500/20 border border-cyan-400/40 text-cyan-100 hover:bg-cyan-500/30 transition-colors text-sm font-medium disabled:opacity-50 min-w-[120px]"
          >
            Create Group
          </button>
        </div>
      </div>
    </Modal>
  );
}
