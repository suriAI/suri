import { useEffect, useRef, useCallback, memo } from "react";

export type { GroupSection } from "@/components/group/types";
import type { GroupPanelProps } from "@/components/group/types";
import type { AttendanceGroup } from "@/types/recognition";

import { useGroupStore, useGroupUIStore } from "@/components/group/stores";
import { useGroupData } from "@/components/group/hooks";
import {
  ErrorBanner,
  GroupContent,
  GroupModals,
  GroupSidebar,
  MobileDrawer,
} from "@/components/group/components";

function GroupPanelComponent({
  onBack,
  initialSection,
  initialGroup,
  onGroupsChanged,
  isEmbedded = false,
  triggerCreateGroup = 0,
  onRegistrationSourceChange,
  registrationSource,
  onRegistrationModeChange,
  registrationMode,
  deselectMemberTrigger,
  onHasSelectedMemberChange,
  onDaysTrackedChange,
  onExportHandlersReady,
  onAddMemberHandlerReady,
  onSectionChange,
}: GroupPanelProps) {
  const selectedGroup = useGroupStore((state) => state.selectedGroup);
  const error = useGroupStore((state) => state.error);
  const setSelectedGroup = useGroupStore((state) => state.setSelectedGroup);
  const setError = useGroupStore((state) => state.setError);
  const fetchGroups = useGroupStore((state) => state.fetchGroups);
  const fetchGroupDetails = useGroupStore((state) => state.fetchGroupDetails);
  const setActiveSection = useGroupUIStore((state) => state.setActiveSection);
  const setIsMobileDrawerOpen = useGroupUIStore(
    (state) => state.setIsMobileDrawerOpen,
  );
  const openCreateGroup = useGroupUIStore((state) => state.openCreateGroup);
  const openAddMember = useGroupUIStore((state) => state.openAddMember);

  useGroupData(initialGroup);

  const handleMemberSuccess = useCallback(() => {
    const currentGroup = useGroupStore.getState().selectedGroup;
    if (currentGroup) {
      fetchGroupDetails(currentGroup.id);
    }
  }, [fetchGroupDetails]);

  const handleGroupSuccess = useCallback(
    (newGroup?: AttendanceGroup) => {
      fetchGroups();
      if (newGroup) {
        setSelectedGroup(newGroup);
      }

      if (onGroupsChanged) {
        onGroupsChanged(newGroup);
      }
    },
    [fetchGroups, setSelectedGroup, onGroupsChanged],
  );

  const handleMembersChange = useCallback(() => {
    if (selectedGroup) {
      fetchGroupDetails(selectedGroup.id);
    }
  }, [selectedGroup, fetchGroupDetails]);

  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection);
    }
  }, [initialSection, setActiveSection]);

  const prevTriggerRef = useRef(0);
  useEffect(() => {
    if (
      triggerCreateGroup > 0 &&
      triggerCreateGroup !== prevTriggerRef.current
    ) {
      openCreateGroup();
      prevTriggerRef.current = triggerCreateGroup;
    }
  }, [triggerCreateGroup, openCreateGroup]);

  useEffect(() => {
    if (onAddMemberHandlerReady) {
      onAddMemberHandlerReady(openAddMember);
    }
  }, [onAddMemberHandlerReady, openAddMember]);

  const prevActiveSectionRef = useRef(useGroupUIStore.getState().activeSection);

  useEffect(() => {
    const unsubscribe = useGroupUIStore.subscribe((state) => {
      if (state.activeSection !== prevActiveSectionRef.current) {
        prevActiveSectionRef.current = state.activeSection;
        onSectionChange?.(state.activeSection);
      }
    });

    return unsubscribe;
  }, [onSectionChange]);

  if (isEmbedded) {
    return (
      <>
        {error && (
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
        )}

        <div className="h-full overflow-hidden">
          <GroupContent
            onMembersChange={handleMembersChange}
            onRegistrationSourceChange={onRegistrationSourceChange}
            registrationSource={registrationSource}
            onRegistrationModeChange={onRegistrationModeChange}
            registrationMode={registrationMode}
            deselectMemberTrigger={deselectMemberTrigger}
            onHasSelectedMemberChange={onHasSelectedMemberChange}
            onDaysTrackedChange={onDaysTrackedChange}
            onExportHandlersReady={onExportHandlersReady}
          />
        </div>

        <GroupModals
          onMemberSuccess={handleMemberSuccess}
          onGroupSuccess={handleGroupSuccess}
        />
      </>
    );
  }

  return (
    <div className="h-full bg-black text-white flex overflow-hidden">
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <div className="fixed inset-x-0 top-9 lg:hidden z-30">
        <div className="h-12 px-3 flex items-center justify-between bg-white/5 border-b border-white/10">
          <button
            onClick={() => setIsMobileDrawerOpen(true)}
            className="px-3 py-1.5 rounded-lg text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Open menu"
            title="Open menu"
          >
            Menu
          </button>
          <div className="flex-1 min-w-0 text-right">
            <div className="text-xs text-white/50 truncate">
              {selectedGroup ? selectedGroup.name : "No group selected"}
            </div>
          </div>
        </div>
      </div>

      <div className="hidden lg:block">
        <GroupSidebar onBack={onBack} />
      </div>

      <MobileDrawer />

      <main className="flex-1 flex flex-col overflow-hidden bg-black h-full relative">
        <GroupContent
          onMembersChange={handleMembersChange}
          onRegistrationSourceChange={onRegistrationSourceChange}
          registrationSource={registrationSource}
          onRegistrationModeChange={onRegistrationModeChange}
          registrationMode={registrationMode}
          deselectMemberTrigger={deselectMemberTrigger}
          onHasSelectedMemberChange={onHasSelectedMemberChange}
          onDaysTrackedChange={onDaysTrackedChange}
          onExportHandlersReady={onExportHandlersReady}
        />
      </main>

      <GroupModals
        onMemberSuccess={handleMemberSuccess}
        onGroupSuccess={handleGroupSuccess}
      />
    </div>
  );
}

export const GroupPanel = memo(GroupPanelComponent);
