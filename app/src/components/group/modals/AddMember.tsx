import { useState, useRef, useEffect, useMemo } from "react";
import { attendanceManager } from "@/services";
import type { AttendanceGroup, AttendanceMember } from "@/types/recognition";
import { FormInput, Modal } from "@/components/common";

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
  const [hasBiometricConsent, setHasBiometricConsent] = useState(false);

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
        hasConsent: hasBiometricConsent,
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
      const lines = bulkMembersText
        .split("\n")
        .filter((line: string) => line.trim());
      let success = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const line of lines) {
        const parts = line.split(",").map((p: string) => p.trim());
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
            hasConsent: hasBiometricConsent,
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
          <h3 className="text-xl font-semibold mb-1 tracking-tight">
            Add Members
          </h3>
          <p className="text-[11px] text-white/50 font-normal">
            Enroll new people into{" "}
            <span className="text-cyan-400/80 font-medium">{group.name}</span>
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
            className={`px-4 py-2 text-[11px] font-medium rounded-lg transition ${
              !isBulkMode
                ? "bg-cyan-500/20 text-cyan-200"
                : "text-white/40 hover:text-white/80 hover:bg-white/10"
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
            className={`px-4 py-2 text-[11px] font-medium rounded-lg transition ${
              isBulkMode
                ? "bg-cyan-500/20 text-cyan-200"
                : "text-white/40 hover:text-white/80 hover:bg-white/10"
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
              <FormInput
                ref={nameInputRef}
                value={newMemberName}
                onChange={(event) => setNewMemberName(event.target.value)}
                placeholder="Enter Name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddMember();
                }}
                focusColor={
                  isDuplicate && !confirmDuplicate
                    ? "border-amber-400"
                    : "border-cyan-500/60"
                }
                className={`${isDuplicate && !confirmDuplicate ? "border-amber-500/50" : ""}`}
              />
              {isDuplicate && !confirmDuplicate && (
                <div className="mt-2 text-[11px] text-amber-400/80 flex items-center gap-2">
                  <i className="fa-solid fa-triangle-exclamation text-[10px]"></i>{" "}
                  A member with this name already exists.
                </div>
              )}
            </label>
            <label className="text-sm">
              <FormInput
                value={newMemberRole}
                onChange={(event) => setNewMemberRole(event.target.value)}
                placeholder="e.g. Staff, Student, Teacher"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddMember();
                }}
                focusColor="border-cyan-500/60"
              />
            </label>

            {/* Consent Toggle */}
            <div
              className={`rounded-xl border transition-all duration-300 ${
                hasBiometricConsent
                  ? "bg-black/40 border-cyan-500/30"
                  : "bg-black/20 border-white/5"
              }`}
            >
              <label className="flex items-start gap-4 p-4 cursor-pointer group">
                <div className="relative flex items-center justify-center mt-0.5 shrink-0">
                  <input
                    type="checkbox"
                    checked={hasBiometricConsent}
                    onChange={(e) => setHasBiometricConsent(e.target.checked)}
                    className="peer sr-only"
                  />
                  <div className="h-5 w-5 rounded-md border border-white/20 bg-white/5 transition-all duration-200 peer-checked:border-cyan-500 peer-checked:bg-cyan-500/10 group-hover:border-white/40" />
                  <i className="fa-solid fa-check absolute text-[9px] text-cyan-400 opacity-0 transition-all duration-200 peer-checked:opacity-100" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm font-semibold text-white/90 tracking-tight">
                      I confirm that this member has provided informed biometric
                      consent.
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-white/40 group-hover:text-white/50 transition-colors">
                    Facial features will be encrypted and stored strictly on
                    this device. Suri does not upload biometric data to any
                    cloud servers.
                  </p>
                </div>
              </label>
            </div>
          </div>
        )}

        {/* Bulk Add Form */}
        {isBulkMode && (
          <div className="space-y-4">
            {/* Consent Toggle (Bulk) */}
            <div
              className={`rounded-xl border transition-all duration-300 ${
                hasBiometricConsent
                  ? "bg-black/40 border-cyan-500/30"
                  : "bg-black/20 border-white/5"
              }`}
            >
              <label className="flex items-start gap-4 p-4 cursor-pointer group">
                <div className="relative flex items-center justify-center mt-0.5 shrink-0">
                  <input
                    type="checkbox"
                    checked={hasBiometricConsent}
                    onChange={(e) => setHasBiometricConsent(e.target.checked)}
                    className="peer sr-only"
                  />
                  <div className="h-5 w-5 rounded-md border border-white/20 bg-white/5 transition-all duration-200 peer-checked:border-cyan-500 peer-checked:bg-cyan-500/10 group-hover:border-white/40" />
                  <i className="fa-solid fa-check absolute text-[9px] text-cyan-400 opacity-0 transition-all duration-200 peer-checked:opacity-100" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm font-semibold text-white/90 tracking-tight">
                      I verify that all members in this list have provided
                      explicit consent.
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-white/40 group-hover:text-white/60 transition-colors">
                    As an administrator, you are responsible for ensuring
                    offline consent records are maintained. All data remains
                    within your local encrypted vault.
                  </p>
                </div>
              </label>
            </div>
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
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 outline-none transition-all duration-300 focus:bg-white/10 focus:border-cyan-500/30 focus:ring-4 focus:ring-cyan-500/10 font-mono text-sm min-h-[200px]"
                placeholder="Enter one member per line. Format:&#10;Name, Role (optional)&#10;&#10;Example:&#10;John Doe, Student&#10;Jane Smith, Teacher&#10;Bob Johnson"
              />
              <div className="mt-2 text-[11px] text-white/30">
                Format:{" "}
                <span className="text-white/50 font-mono">Name, Role</span> (one
                per line, role is optional)
              </div>
            </div>

            {/* Bulk Results */}
            {bulkResults && (
              <div
                className={`rounded-lg border p-3 ${
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
                    {bulkResults.errors.map((err: string, idx: number) => (
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
        <div className="flex justify-end gap-3 mt-8">
          <button
            onClick={() => {
              resetForm();
              onClose();
            }}
            className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/50 hover:bg-white/10 hover:text-white transition-colors text-[11px] font-medium"
          >
            Cancel
          </button>
          <button
            onClick={
              isBulkMode ? () => void handleBulkAddMembers() : handleAddMember
            }
            disabled={
              loading ||
              isProcessingBulk ||
              (!isBulkMode && !newMemberName.trim()) ||
              (isBulkMode && !bulkMembersText.trim()) ||
              !hasBiometricConsent
            }
            className={`px-6 py-2 rounded-lg border transition-colors text-sm font-medium disabled:opacity-50 min-w-[120px] ${
              confirmDuplicate && !isBulkMode
                ? "bg-amber-500/20 border-amber-400/40 text-amber-200 hover:bg-amber-500/30"
                : "bg-cyan-500/20 border-cyan-400/40 text-cyan-100 hover:bg-cyan-500/30"
            }`}
          >
            {loading || isProcessingBulk
              ? "Processing…"
              : !hasBiometricConsent
                ? "Consent Required"
                : confirmDuplicate && !isBulkMode
                  ? "Add Anyway"
                  : isBulkMode
                    ? "Add Members"
                    : "Create Member"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
