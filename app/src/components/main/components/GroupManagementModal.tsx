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
      title="Create New Group"
      maxWidth="sm"
    >
      <div className="space-y-3 mt-2">
        <div>
          <label className="block text-xs font-medium mb-1.5 text-white/60">
            Group Name:
          </label>
          <FormInput
            ref={inputRef}
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter group name"
            focusColor="border-cyan-500/60"
          />
        </div>
        <button
          onClick={handleCreateGroup}
          disabled={!newGroupName.trim()}
          className="btn-success w-full px-4 py-2 text-sm disabled:opacity-50 mt-4"
        >
          Create Group
        </button>
      </div>
    </Modal>
  );
}
