import { useState, useRef, useEffect, useMemo } from "react";
import { attendanceManager } from "@/services";
import type { AttendanceGroup, AttendanceMember } from "@/types/recognition";
import { Modal } from "@/components/common";

interface AddMemberProps {
  group: AttendanceGroup;
  existingMembers?: AttendanceMember[];
  onClose: () => void;
  onSuccess: () => void;
}

export function AddMember({
  group,
  existingMembers = [],
  onClose,
  onSuccess,
}: AddMemberProps) {
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberRole, setNewMemberRole] = useState("");
  const [bulkMembersText, setBulkMembersText] = useState("");
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);
  const [bulkResults, setBulkResults] = useState<{
    success: number;
    failed: number;
    errors: string[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setNewMemberName("");
    setNewMemberRole("");
    setBulkMembersText("");
    setBulkResults(null);
    setIsBulkMode(false);
    setConfirmDuplicate(false);
    setError(null);
  };

  useEffect(() => {
    if (!isBulkMode && nameInputRef.current) {
      const focusInput = () => {
        if (nameInputRef.current) {
          nameInputRef.current.focus();
          nameInputRef.current.select();
          nameInputRef.current.click();
        }
      };

      requestAnimationFrame(() => {
        focusInput();
        setTimeout(focusInput, 50);
        setTimeout(focusInput, 150);
      });
    }
  }, [isBulkMode]);

  const handleFileUpload = async (file: File) => {
    try {
      const text = await file.text();
      setBulkMembersText(text);
    } catch {
      setError(
        "Failed to read file. Please ensure it's a valid text or CSV file.",
      );
    }
  };

  const isDuplicate = useMemo(() => {
    if (!newMemberName.trim()) return false;
    const normalizedName = newMemberName.trim().toLowerCase();
    return existingMembers.some((m) => m.name.toLowerCase() === normalizedName);
  }, [newMemberName, existingMembers]);

  // Reset confirmation when name changes
  useEffect(() => {
    setConfirmDuplicate(false);
  }, [newMemberName]);

  const handleAddMember = async () => {
    if (!newMemberName.trim()) {
      return;
    }

    if (isDuplicate && !confirmDuplicate) {
      setConfirmDuplicate(true);
      return;
    }

    setLoading(true);
    try {
      await attendanceManager.addMember(group.id, newMemberName.trim(), {
        role: newMemberRole.trim() || undefined,
      });
      resetForm();
      onSuccess();
      onClose();
    } catch (err) {
      console.error("Error adding member:", err);
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setLoading(false);
    }
  };

  const handleBulkAddMembers = async () => {
    if (!bulkMembersText.trim()) {
      return;
    }

    setIsProcessingBulk(true);
    setBulkResults(null);

    try {
      const lines = bulkMembersText.split("\n").filter((line) => line.trim());
      let success = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const line of lines) {
        const parts = line.split(",").map((p) => p.trim());
        const name = parts[0];
        const role = parts[1] || "";

        if (!name) {
          failed++;
          errors.push(`Empty name in line: "${line}"`);
          continue;
        }

        try {
          await attendanceManager.addMember(group.id, name, {
            role: role || undefined,
          });
          success++;
        } catch (err) {
          failed++;
          errors.push(
            `Failed to add "${name}": ${err instanceof Error ? err.message : "Unknown error"}`,
          );
        }
      }

      setBulkResults({ success, failed, errors });
      onSuccess();

      if (failed === 0) {
        setTimeout(() => {
          resetForm();
          onClose();
        }, 2000);
      }
    } catch (err) {
      console.error("Error bulk adding members:", err);
      setError(
        err instanceof Error ? err.message : "Failed to bulk add members",
      );
    } finally {
      setIsProcessingBulk(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={() => {
        resetForm();
        onClose();
      }}
      title={
        <div>
          <h3 className="text-xl font-semibold mb-2">Add Members</h3>
          <p className="text-sm text-white/60 font-normal">
            Add one or more people to the group
          </p>
        </div>
      }
      maxWidth="2xl"
    >
      <div className="max-h-[90vh] overflow-y-auto mt-2 -m-5 p-5">
        {/* Tab selector */}
        <div className="flex gap-2 mb-4 border-b border-white/10 pb-2">
          <button
            onClick={() => {
              setIsBulkMode(false);
              setBulkMembersText("");
              setConfirmDuplicate(false);
            }}
            className={`px-4 py-2 text-sm rounded-lg transition ${
              !isBulkMode
                ? "bg-cyan-500/20 text-cyan-200"
                : "text-white/60 hover:text-white"
            }`}
          >
            One person
          </button>
          <button
            onClick={() => {
              setIsBulkMode(true);
              setNewMemberName("");
              setNewMemberRole("");
              setConfirmDuplicate(false);
            }}
            className={`px-4 py-2 text-sm rounded-lg transition ${
              isBulkMode
                ? "bg-cyan-500/20 text-cyan-200"
                : "text-white/60 hover:text-white"
            }`}
          >
            Bulk Add
          </button>
        </div>

        {error && (
          <div className="mb-4 px-4 py-2 bg-red-600/20 border border-red-500/40 text-red-200 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Single Member Form */}
        {!isBulkMode && (
          <div className="grid gap-4">
            <label className="text-sm">
              <span className="text-white/60 block mb-2">Name *</span>
              <input
                ref={nameInputRef}
                type="text"
                value={newMemberName}
                onChange={(event) => setNewMemberName(event.target.value)}
                className={`w-full bg-white/5 border rounded-xl px-4 py-2 focus:outline-none transition-colors ${
                  isDuplicate && !confirmDuplicate
                    ? "border-amber-500/50 focus:border-amber-400"
                    : "border-white/10 focus:border-cyan-500/60"
                }`}
                placeholder="Enter Name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddMember();
                }}
              />
              {isDuplicate && !confirmDuplicate && (
                <div className="mt-2 text-xs text-amber-300 flex items-center gap-2">
                  <i className="fa-solid fa-triangle-exclamation"></i>A member
                  with this name already exists.
                </div>
              )}
            </label>
            <label className="text-sm">
              <span className="text-white/60 block mb-2">Role (optional)</span>
              <input
                type="text"
                value={newMemberRole}
                onChange={(event) => setNewMemberRole(event.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-cyan-500/60 transition-colors"
                placeholder="e.g. Staff, Student, Teacher"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddMember();
                }}
              />
            </label>
          </div>
        )}

        {/* Bulk Add Form */}
        {isBulkMode && (
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-white/60">
                  Upload CSV/TXT file or paste below
                </span>
                <label className="px-3 py-1 text-xs rounded-lg bg-cyan-500/20 border border-cyan-400/40 text-cyan-200 hover:bg-cyan-500/30 cursor-pointer transition">
                  📁 Upload File
                  <input
                    type="file"
                    accept=".txt,.csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleFileUpload(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              <textarea
                value={bulkMembersText}
                onChange={(event) => setBulkMembersText(event.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-cyan-500/60 font-mono text-sm min-h-[200px]"
                placeholder="Enter one member per line. Format:&#10;Name, Role (optional)&#10;&#10;Example:&#10;John Doe, Student&#10;Jane Smith, Teacher&#10;Bob Johnson"
              />
              <div className="mt-2 text-xs text-white/50">
                Format:{" "}
                <span className="text-white/70 font-mono">Name, Role</span> (one
                per line, role is optional)
              </div>
            </div>

            {/* Bulk Results */}
            {bulkResults && (
              <div
                className={`rounded-xl border p-3 ${
                  bulkResults.failed === 0
                    ? "border-cyan-500/40 bg-cyan-500/10"
                    : "border-yellow-500/40 bg-yellow-500/10"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold">
                    {bulkResults.failed === 0
                      ? "✓ Success!"
                      : "⚠ Partial Success"}
                  </span>
                  <span className="text-xs">
                    {bulkResults.success} added, {bulkResults.failed} failed
                  </span>
                </div>
                {bulkResults.errors.length > 0 && (
                  <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
                    {bulkResults.errors.map((err, idx) => (
                      <div
                        key={idx}
                        className="text-xs text-red-200 bg-red-500/10 rounded px-2 py-1"
                      >
                        {err}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 mt-6">
          {!isBulkMode ? (
            <button
              onClick={handleAddMember}
              disabled={!newMemberName.trim() || loading}
              className={`w-full px-4 py-2 rounded-xl border transition-colors text-sm font-medium disabled:opacity-50 ${
                confirmDuplicate
                  ? "bg-amber-500/20 border-amber-400/40 text-amber-200 hover:bg-amber-500/30"
                  : "bg-cyan-500/20 border-cyan-400/40 text-cyan-100 hover:bg-cyan-500/30"
              }`}
            >
              {loading
                ? "Adding…"
                : confirmDuplicate
                  ? "Add Anyway"
                  : "Add Member"}
            </button>
          ) : (
            <button
              onClick={() => void handleBulkAddMembers()}
              disabled={!bulkMembersText.trim() || isProcessingBulk}
              className="w-full px-4 py-2 rounded-xl bg-cyan-500/20 border border-cyan-400/40 text-cyan-100 hover:bg-cyan-500/30 transition-colors text-sm font-medium disabled:opacity-50"
            >
              {isProcessingBulk ? "Processing…" : `Add Members`}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
