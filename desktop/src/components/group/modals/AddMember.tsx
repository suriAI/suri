import { useState } from 'react';
import { attendanceManager } from '../../../services/AttendanceManager.js';
import type { AttendanceGroup } from '../../../types/recognition.js';

interface AddMemberProps {
  group: AttendanceGroup;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddMember({ group, onClose, onSuccess }: AddMemberProps) {
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('');
  const [bulkMembersText, setBulkMembersText] = useState('');
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);
  const [bulkResults, setBulkResults] = useState<{ success: number; failed: number; errors: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setNewMemberName('');
    setNewMemberRole('');
    setBulkMembersText('');
    setBulkResults(null);
    setIsBulkMode(false);
  };

  const handleFileUpload = async (file: File) => {
    try {
      const text = await file.text();
      setBulkMembersText(text);
    } catch {
      setError('Failed to read file. Please ensure it\'s a valid text or CSV file.');
    }
  };

  const handleAddMember = async () => {
    if (!newMemberName.trim()) {
      return;
    }

    setLoading(true);
    try {
      await attendanceManager.addMember(group.id, newMemberName.trim(), {
        role: newMemberRole.trim() || undefined
      });
      resetForm();
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Error adding member:', err);
      setError(err instanceof Error ? err.message : 'Failed to add member');
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
      const lines = bulkMembersText.split('\n').filter(line => line.trim());
      let success = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const line of lines) {
        const parts = line.split(',').map(p => p.trim());
        const name = parts[0];
        const role = parts[1] || '';

        if (!name) {
          failed++;
          errors.push(`Empty name in line: "${line}"`);
          continue;
        }

        try {
          await attendanceManager.addMember(group.id, name, {
            role: role || undefined
          });
          success++;
        } catch (err) {
          failed++;
          errors.push(`Failed to add "${name}": ${err instanceof Error ? err.message : 'Unknown error'}`);
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
      console.error('Error bulk adding members:', err);
      setError(err instanceof Error ? err.message : 'Failed to bulk add members');
    } finally {
      setIsProcessingBulk(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
      <div className="bg-[#0f0f0f] border border-white/10 rounded-3xl p-6 w-full max-w-2xl shadow-[0_40px_80px_rgba(0,0,0,0.6)] max-h-[90vh] overflow-y-auto">
        <h3 className="text-xl font-semibold mb-2">Add Members</h3>
        <p className="text-sm text-white/60 mb-4">Add one or multiple members to the group</p>
        
        {/* Tab selector */}
        <div className="flex gap-2 mb-4 border-b border-white/10 pb-2">
          <button
            onClick={() => {
              setIsBulkMode(false);
              setBulkMembersText('');
            }}
            className={`px-4 py-2 text-sm rounded-lg transition ${
              !isBulkMode ? 'bg-blue-500/20 text-blue-200' : 'text-white/60 hover:text-white'
            }`}
          >
            Single Member
          </button>
          <button
            onClick={() => {
              setIsBulkMode(true);
              setNewMemberName('');
              setNewMemberRole('');
            }}
            className={`px-4 py-2 text-sm rounded-lg transition ${
              isBulkMode ? 'bg-blue-500/20 text-blue-200' : 'text-white/60 hover:text-white'
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
              <span className="text-white/60 block mb-2">Full name *</span>
              <input
                type="text"
                value={newMemberName}
                onChange={event => setNewMemberName(event.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-blue-500/60"
                placeholder="Enter full name"
              />
            </label>
            <label className="text-sm">
              <span className="text-white/60 block mb-2">Role (optional)</span>
              <input
                type="text"
                value={newMemberRole}
                onChange={event => setNewMemberRole(event.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-blue-500/60"
                placeholder="e.g. Staff, Student, Teacher"
              />
            </label>
          </div>
        )}

        {/* Bulk Add Form */}
        {isBulkMode && (
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-white/60">Upload CSV/TXT file or paste below</span>
                <label className="px-3 py-1 text-xs rounded-lg bg-blue-500/20 border border-blue-400/40 text-blue-200 hover:bg-blue-500/30 cursor-pointer transition">
                  📁 Upload File
                  <input
                    type="file"
                    accept=".txt,.csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleFileUpload(file);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              <textarea
                value={bulkMembersText}
                onChange={event => setBulkMembersText(event.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500/60 font-mono text-sm min-h-[200px]"
                placeholder="Enter one member per line. Format:&#10;Name, Role (optional)&#10;&#10;Example:&#10;John Doe, Student&#10;Jane Smith, Teacher&#10;Bob Johnson"
              />
              <div className="mt-2 text-xs text-white/50">
                Format: <span className="text-white/70 font-mono">Name, Role</span> (one per line, role is optional)
              </div>
            </div>

            {/* Bulk Results */}
            {bulkResults && (
              <div className={`rounded-xl border p-3 ${
                bulkResults.failed === 0 
                  ? 'border-emerald-500/40 bg-emerald-500/10' 
                  : 'border-yellow-500/40 bg-yellow-500/10'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold">
                    {bulkResults.failed === 0 ? '✓ Success!' : '⚠ Partial Success'}
                  </span>
                  <span className="text-xs">
                    {bulkResults.success} added, {bulkResults.failed} failed
                  </span>
                </div>
                {bulkResults.errors.length > 0 && (
                  <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
                    {bulkResults.errors.map((err, idx) => (
                      <div key={idx} className="text-xs text-red-200 bg-red-500/10 rounded px-2 py-1">
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
          <button
            onClick={() => {
              resetForm();
              onClose();
            }}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 transition-colors text-sm"
          >
            Cancel
          </button>
          {!isBulkMode ? (
            <button
              onClick={handleAddMember}
              disabled={!newMemberName.trim() || loading}
              className="px-4 py-2 rounded-xl bg-green-500/20 border border-green-400/40 text-green-100 hover:bg-green-500/30 transition-colors text-sm disabled:opacity-50"
            >
              {loading ? 'Adding…' : 'Add Member'}
            </button>
          ) : (
            <button
              onClick={() => void handleBulkAddMembers()}
              disabled={!bulkMembersText.trim() || isProcessingBulk}
              className="px-4 py-2 rounded-xl bg-green-500/20 border border-green-400/40 text-green-100 hover:bg-green-500/30 transition-colors text-sm disabled:opacity-50"
            >
              {isProcessingBulk ? 'Processing…' : `Add Members`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

