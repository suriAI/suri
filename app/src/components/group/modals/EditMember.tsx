import { useState, useEffect, useRef } from "react";
import { attendanceManager } from "@/services";
import type { AttendanceMember } from "@/types/recognition";
import { FormInput, Modal } from "@/components/common";

interface EditMemberProps {
  member: AttendanceMember;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditMember({ member, onClose, onSuccess }: EditMemberProps) {
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState(member.role || "");
  const [hasBiometricConsent, setHasBiometricConsent] = useState(
    member.has_consent || false,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      const focusInput = () => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      };
      requestAnimationFrame(() => {
        focusInput();
        setTimeout(focusInput, 50);
      });
    }
  }, []);

  const handleSave = async () => {
    if (!name.trim()) {
      return;
    }

    setLoading(true);
    try {
      const updates: Partial<AttendanceMember> = {
        name: name.trim(),
        role: role.trim() || undefined,
        has_consent: hasBiometricConsent,
      };

      await attendanceManager.updateMember(member.person_id, updates);
      onSuccess();
      onClose();
    } catch (err) {
      console.error("Error updating member:", err);
      setError(err instanceof Error ? err.message : "Failed to update member");
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
          <h3 className="text-xl font-semibold mb-1">Edit Member</h3>
          <p className="text-sm text-white/40 font-normal">
            Update details for{" "}
            <span className="text-cyan-400/70 font-medium">{member.name}</span>
          </p>
        </div>
      }
      maxWidth="lg"
    >
      <div className="mt-2">
        {error && (
          <div className="mb-4 px-4 py-2 bg-red-600/20 border border-red-500/40 text-red-200 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="grid gap-4">
          <label className="text-sm">
            <FormInput
              ref={inputRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="New Name"
              focusColor="border-cyan-500/60"
            />
          </label>
          <label className="text-sm">
            <FormInput
              value={role}
              onChange={(event) => setRole(event.target.value)}
              placeholder="New Role"
              focusColor="border-cyan-500/60"
            />
          </label>

          {/* Consent Toggle */}
          <div
            className={`rounded-xl transition-all duration-300 ${
              hasBiometricConsent ? "bg-black/40" : "bg-black/20"
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
                <div className="h-5 w-5 rounded-md border border-white/20 bg-white/5 transition-all duration-200 group-hover:border-white/40" />
                <i className="fa-solid fa-check absolute text-[9px] text-cyan-400 opacity-0 transition-all duration-200 peer-checked:opacity-100" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold text-white/90 tracking-tight">
                    I confirm that this member has provided informed biometric
                    consent.
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-white/40 group-hover:text-white/60 transition-colors">
                  Note: Facial features are encrypted and stored strictly on
                  this device. Suri does not upload biometric data to the cloud.
                </p>
              </div>
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-8">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-colors text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || loading}
            className="px-6 py-2 rounded-lg bg-cyan-500/20 border border-cyan-400/40 text-cyan-100 hover:bg-cyan-500/30 transition-colors text-sm font-medium disabled:opacity-50 min-w-[120px]"
          >
            {loading ? "Saving…" : "Update Member"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
