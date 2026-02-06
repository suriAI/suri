import type { SettingsOverview } from "@/components/settings/types";
import type { AttendanceGroup } from "@/types/recognition";
import { useDatabaseManagement } from "@/components/settings/sections/hooks/useDatabaseManagement";
import { DatabaseStats } from "@/components/settings/sections/components/DatabaseStats";
import { GroupEntry } from "@/components/settings/sections/components/GroupEntry";
import { useDialog } from "@/components/shared";

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

  return (
    <div className="space-y-6 max-w-4xl p-6">
      {/* Statistics Overview */}
      <DatabaseStats
        groupsCount={groups.length}
        totalMembers={totalMembers}
        totalPersons={systemData.totalPersons}
      />

      {/* Search */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search members by name, email, or role..."
          className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/40 focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20 transition-colors"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60 transition-colors"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        )}
      </div>

      {/* Groups with Members */}
      <div
        className={`space-y-2 ${filteredData.length === 0 ? "h-24" : "h-auto"}`}
      >
        {filteredData.length === 0 ? (
          <div className="text-center py-12 text-white/50">
            <div className="text-sm">No groups or members found</div>
            {groups.length === 0 && (
              <div className="text-xs mt-1">
                Create a group first to manage members here.
              </div>
            )}
            {groups.length > 0 && (
              <div className="text-xs mt-1">
                Try adjusting the search or expand a group to view members.
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
      <div className="pt-4 border-t border-white/10 space-y-3 pb-8">
        <button
          onClick={handleClearAllGroups}
          disabled={isLoading || deletingGroup === "all" || groups.length === 0}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-sm font-medium text-red-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {deletingGroup === "all" ? (
            <>
              <i className="fa-solid fa-spinner fa-spin"></i>
              <span>Deleting...</span>
            </>
          ) : (
            <>
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                  strokeWidth={2}
                />
              </svg>
              Delete All Groups
            </>
          )}
        </button>
        <p className="text-xs text-white/40">
          Removes all groups and their members. This does not delete face data.
        </p>
        <button
          onClick={onClearDatabase}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-sm font-medium text-red-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
              strokeWidth={2}
            />
          </svg>
          Clear All Face Data
        </button>
        <p className="text-xs text-white/40">
          Clears recognition data for every person. Attendance records remain.
        </p>
      </div>
    </div>
  );
}
