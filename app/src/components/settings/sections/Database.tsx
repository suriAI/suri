import { useState } from "react";
import type { SettingsOverview } from "@/components/settings/types";
import type { AttendanceGroup } from "@/types/recognition";
import { useDatabaseManagement } from "@/components/settings/sections/hooks/useDatabaseManagement";
import { DatabaseStats } from "@/components/settings/sections/components/DatabaseStats";
import { GroupEntry } from "@/components/settings/sections/components/GroupEntry";
import { useDialog } from "@/components/shared";

type BackupStatus =
  | { type: "idle" }
  | { type: "loading"; action: "export" | "import" }
  | { type: "success"; message: string }
  | { type: "error"; message: string };

interface DatabaseProps {
  systemData: SettingsOverview;
  groups: AttendanceGroup[];
  isLoading: boolean;
  onClearDatabase: () => void;
  onGroupsChanged?: () => void;
}

export function Database({
  systemData,
  groups,
  isLoading,
  onClearDatabase,
  onGroupsChanged,
}: DatabaseProps) {
  const dialog = useDialog();
  const {
    expandedGroups,
    searchQuery,
    setSearchQuery,
    editingMember,
    editingGroup,
    editValue,
    setEditValue,
    savingMember,
    savingGroup,
    deletingGroup,
    deletingMember,
    filteredData,
    toggleGroup,
    startEditing,
    startEditingGroup,
    cancelEditing,
    saveEdit,
    saveGroupEdit,
    handleDeleteGroup,
    handleDeleteMember,
    handleClearAllGroups,
    totalMembers,
  } = useDatabaseManagement(groups, onGroupsChanged, dialog);

  const [status, setStatus] = useState<BackupStatus>({ type: "idle" });

  const handleExport = async () => {
    setStatus({ type: "loading", action: "export" });
    try {
      const result = await window.electronAPI.sync.exportData();
      if (result.canceled) {
        setStatus({ type: "idle" });
        return;
      }
      if (result.success) {
        setStatus({
          type: "success",
          message: `Backup saved to: ${result.filePath}`,
        });
      } else {
        setStatus({
          type: "error",
          message: result.error ?? "Failed to create backup.",
        });
      }
    } catch (err) {
      setStatus({
        type: "error",
        message: err instanceof Error ? err.message : "Backup failed.",
      });
    }
  };

  const handleImport = async (overwriteAttr = false) => {
    setStatus({ type: "loading", action: "import" });
    try {
      const result = await window.electronAPI.sync.importData(overwriteAttr);
      if (result.canceled) {
        setStatus({ type: "idle" });
        return;
      }
      if (result.success) {
        setStatus({
          type: "success",
          message: result.message ?? "Restore complete.",
        });
        if (onGroupsChanged) onGroupsChanged();
      } else {
        setStatus({
          type: "error",
          message: result.error ?? "Failed to restore data.",
        });
      }
    } catch (err) {
      setStatus({
        type: "error",
        message: err instanceof Error ? err.message : "Restore failed.",
      });
    }
  };

  const isBackingUp = status.type === "loading";

  return (
    <div className="space-y-6 max-w-auto p-10">
      {/* Statistics Overview */}
      <DatabaseStats
        groupsCount={groups.length}
        totalMembers={totalMembers}
        totalPersons={systemData.totalPersons}
      />

      {/* Backup & Restore Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Create Backup */}
        <div className="rounded-lg border border-white/10 bg-white/5 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06]">
            <div className="flex items-center gap-2 mb-1">
              <i className="fa-solid fa-download text-cyan-400 text-xs" />
              <h4 className="text-xs font-semibold text-white">
                Create Backup
              </h4>
            </div>
            <p className="text-[10px] text-white/40">
              Exports an encrypted{" "}
              <code className="font-mono text-white/30">.suri</code> file —
              members, history, and biometric profiles.
            </p>
          </div>
          <div className="px-5 py-4">
            <button
              onClick={handleExport}
              disabled={isBackingUp}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-400 text-[10px] font-semibold transition-all disabled:opacity-40"
            >
              {isBackingUp && status.action === "export" ? (
                <i className="fa-solid fa-circle-notch fa-spin" />
              ) : (
                <i className="fa-solid fa-file-export" />
              )}
              Export (.suri)
            </button>
          </div>
        </div>

        {/* Restore Backup */}
        <div className="rounded-lg border border-white/10 bg-white/5 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06]">
            <div className="flex items-center gap-2 mb-1">
              <i className="fa-solid fa-upload text-cyan-400 text-xs" />
              <h4 className="text-xs font-semibold text-white">
                Restore Backup
              </h4>
            </div>
            <p className="text-[10px] text-white/40">
              Restores from a{" "}
              <code className="font-mono text-white/30">.suri</code> file.
              Requires the original password.
            </p>
          </div>
          <div className="px-5 py-4">
            <button
              onClick={() => handleImport(false)}
              disabled={isBackingUp}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-400 text-[10px] font-semibold transition-all disabled:opacity-40"
            >
              {isBackingUp && status.action === "import" ? (
                <i className="fa-solid fa-circle-notch fa-spin" />
              ) : (
                <i className="fa-solid fa-file-import" />
              )}
              Restore (.suri)
            </button>
          </div>
        </div>
      </div>

      {/* Backup Status Message */}
      {status.type !== "idle" && (
        <div
          className={`flex items-start gap-3 px-4 py-3 rounded-lg border text-[10px] ${
            status.type === "loading"
              ? "bg-white/5 border-white/10 text-white/60"
              : status.type === "success"
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                : "bg-rose-500/10 border-rose-500/20 text-rose-400"
          }`}
        >
          {status.type === "loading" ? (
            <i className="fa-solid fa-circle-notch fa-spin mt-0.5" />
          ) : status.type === "success" ? (
            <i className="fa-solid fa-circle-check mt-0.5" />
          ) : (
            <i className="fa-solid fa-circle-exclamation mt-0.5" />
          )}
          <span>{"message" in status ? status.message : ""}</span>
          {status.type !== "loading" && (
            <button
              onClick={() => setStatus({ type: "idle" })}
              className="ml-auto hover:text-white transition-colors"
            >
              <i className="fa-solid fa-xmark" />
            </button>
          )}
        </div>
      )}

      {/* Search */}
      <div className="relative group/search max-w-sm mx-auto">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 group-focus-within/search:text-cyan-400 transition-colors pointer-events-none">
          <i className="fa-solid fa-magnifying-glass text-[10px]"></i>
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search members or groups…"
          className="w-full pl-8 pr-8 py-1.5 bg-white/5 border border-white/10 rounded-full text-xs text-white placeholder-white/40 focus:outline-none focus:border-cyan-400/30 focus:bg-white/[0.06] transition-all"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-white/30 hover:text-white/70 hover:bg-white/10 transition-all border-none bg-transparent p-0"
          >
            <i className="fa-solid fa-xmark text-[9px]"></i>
          </button>
        )}
      </div>

      {/* Groups with Members */}
      <div
        className={`space-y-1 ${filteredData.length === 0 ? "h-24" : "h-auto"}`}
      >
        {filteredData.length === 0 ? (
          <div className="text-center py-8 text-white/40">
            <div className="text-xs">No results found</div>
            {groups.length === 0 && (
              <div className="text-[10px] mt-1 italic text-white/20">
                Create a group to begin managing members.
              </div>
            )}
          </div>
        ) : (
          filteredData.map((group) => (
            <GroupEntry
              key={group.id}
              group={group}
              isExpanded={expandedGroups.has(group.id)}
              editingGroup={editingGroup}
              editingMember={editingMember}
              editValue={editValue}
              savingGroup={savingGroup}
              savingMember={savingMember}
              deletingGroup={deletingGroup}
              deletingMember={deletingMember}
              onToggle={toggleGroup}
              onStartEditingGroup={startEditingGroup}
              onStartEditingMember={startEditing}
              onEditValueChange={setEditValue}
              onSaveGroupEdit={saveGroupEdit}
              onSaveMemberEdit={saveEdit}
              onCancelEditing={cancelEditing}
              onDeleteGroup={handleDeleteGroup}
              onDeleteMember={handleDeleteMember}
            />
          ))
        )}
      </div>

      {/* Clear Actions */}
      <div className="pt-6 border-t border-white/5 flex items-center justify-between gap-4 px-2">
        <div className="flex-1">
          <p className="text-[9px] text-white/30 leading-relaxed font-sans">
            Deleting groups is permanent. Face data is managed separately from
            records.
          </p>
        </div>

        <div className="flex gap-2 shrink-0">
          <button
            onClick={handleClearAllGroups}
            disabled={
              isLoading || deletingGroup === "all" || groups.length === 0
            }
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-[10px] font-bold text-red-400 hover:text-red-300 transition-all disabled:opacity-20"
          >
            {deletingGroup === "all" ? (
              <i className="fa-solid fa-spinner fa-spin"></i>
            ) : (
              <i className="fa-solid fa-layer-group"></i>
            )}
            Clear Groups
          </button>

          <button
            onClick={onClearDatabase}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-[10px] font-bold text-amber-400 hover:text-amber-300 transition-all disabled:opacity-20"
          >
            Clear Face Data
          </button>
        </div>
      </div>
    </div>
  );
}
