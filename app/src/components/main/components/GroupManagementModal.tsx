import { useEffect, useRef } from "react";
import { FormInput, ModalCloseButton } from "@/components/common";

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

  if (!showGroupManagement) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={() => setShowGroupManagement(false)}
    >
      <div
        className="w-full max-w-sm bg-[#09090b]/95 border border-white/10 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          {/* Header */}
          <div className="flex justify-between items-start mb-5">
            <h2 className="text-base font-semibold text-white tracking-tight">
              Create New Group
            </h2>
            <ModalCloseButton onClick={() => setShowGroupManagement(false)} />
          </div>

          {/* Form */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1.5 text-white/60">
                Group Name:
              </label>
              <FormInput
                ref={inputRef}
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Enter group name"
                focusColor="border-cyan-500/60"
              />
            </div>
            <button
              onClick={handleCreateGroup}
              disabled={!newGroupName.trim()}
              className="btn-success w-full px-4 py-2 text-sm disabled:opacity-50"
            >
              Create Group
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
