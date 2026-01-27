import { useMemo } from "react";
import type { AttendanceMember } from "../../../../../types/recognition";
import { generateDisplayNames } from "../../../../../utils";

interface MemberSidebarProps {
  members: AttendanceMember[];
  selectedMemberId: string;
  onSelectMember: (id: string) => void;
  memberSearch: string;
  setMemberSearch: (val: string) => void;
  registrationFilter: "all" | "registered" | "non-registered";
  setRegistrationFilter: (val: "all" | "registered" | "non-registered") => void;
  memberStatus: Map<string, boolean>;
  onRemoveFaceData: (
    member: AttendanceMember & { displayName: string },
  ) => void;
}

export function MemberSidebar({
  members,
  selectedMemberId,
  onSelectMember,
  memberSearch,
  setMemberSearch,
  registrationFilter,
  setRegistrationFilter,
  memberStatus,
  onRemoveFaceData,
}: MemberSidebarProps) {
  const membersWithDisplayNames = useMemo(() => {
    return generateDisplayNames(members);
  }, [members]);

  const filteredMembers = useMemo(() => {
    let result = membersWithDisplayNames;

    if (memberSearch.trim()) {
      const query = memberSearch.toLowerCase();
      result = result.filter(
        (member) =>
          member.name.toLowerCase().includes(query) ||
          member.displayName.toLowerCase().includes(query) ||
          member.person_id.toLowerCase().includes(query),
      );
    }

    if (registrationFilter !== "all") {
      result = result.filter((member) => {
        const isRegistered = memberStatus.get(member.person_id) ?? false;
        return registrationFilter === "registered"
          ? isRegistered
          : !isRegistered;
      });
    }

    result = [...result].sort((a, b) => {
      const aRegistered = memberStatus.get(a.person_id) ?? false;
      const bRegistered = memberStatus.get(b.person_id) ?? false;

      if (aRegistered && !bRegistered) return -1;
      if (!aRegistered && bRegistered) return 1;
      return 0;
    });

    return result;
  }, [memberSearch, membersWithDisplayNames, registrationFilter, memberStatus]);

  return (
    <div className="space-y-3 flex flex-col overflow-hidden min-h-0 h-full p-6">
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="search"
            value={memberSearch}
            onChange={(e) => setMemberSearch(e.target.value)}
            placeholder="Search members..."
            className="w-full rounded-xl border border-white/10 bg-white/5 pl-10 pr-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-cyan-400/50 focus:bg-white/10 focus:outline-none transition-all"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 flex-shrink-0">
        {members.length > 0 && filteredMembers.length > 0 && (
          <div className="text-xs text-white/30">
            Showing {filteredMembers.length} of {members.length} member
            {members.length !== 1 ? "s" : ""}
            {registrationFilter !== "all" && (
              <span className="ml-1">
                (
                {registrationFilter === "registered"
                  ? "registered"
                  : "needs registration"}
                )
              </span>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => setRegistrationFilter("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              registrationFilter === "all"
                ? "bg-white/10 text-white border border-white/20"
                : "bg-white/5 text-white/60 border border-white/10 hover:bg-white/8 hover:text-white/80"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setRegistrationFilter("non-registered")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              registrationFilter === "non-registered"
                ? "bg-amber-500/20 text-amber-200 border border-amber-500/30"
                : "bg-white/5 text-white/60 border border-white/10 hover:bg-white/88 hover:text-white/80"
            }`}
          >
            Unregistered
          </button>
          <button
            onClick={() => setRegistrationFilter("registered")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              registrationFilter === "registered"
                ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/30"
                : "bg-white/5 text-white/60 border border-white/10 hover:bg-white/8 hover:text-white/80"
            }`}
          >
            Registered
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto custom-scroll overflow-x-hidden min-h-0">
        {members.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/5 bg-white/[0.02] px-3 py-12 text-center w-full">
            <div className="text-xs text-white/40">No members yet</div>
          </div>
        )}

        {members.length > 0 && filteredMembers.length === 0 && (
          <div className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-6 text-center w-full">
            <div className="text-xs text-white/40">
              {memberSearch.trim()
                ? `No results for "${memberSearch}"`
                : registrationFilter === "registered"
                  ? "No registered members"
                  : registrationFilter === "non-registered"
                    ? "All members are registered"
                    : "No members found"}
            </div>
          </div>
        )}

        {filteredMembers.map((member) => {
          const isSelected = selectedMemberId === member.person_id;
          const hasEmbeddings = memberStatus.get(member.person_id) ?? false;
          return (
            <button
              key={member.person_id}
              onClick={() => onSelectMember(member.person_id)}
              className={`group relative w-full rounded-2xl border transition-all px-4 py-4 flex flex-col gap-3 ${
                isSelected
                  ? "border-cyan-500/50 bg-cyan-500/10 shadow-[0_0_20px_rgba(34,211,238,0.1)]"
                  : "border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/5"
              }`}
            >
              <div className="flex items-center justify-between gap-4 w-full relative z-10">
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-[15px] font-bold tracking-tight mb-1 transition-colors ${
                      isSelected ? "text-cyan-100" : "text-white"
                    }`}
                  >
                    {member.displayName}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {member.role ? (
                      <div
                        className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider ${
                          isSelected ? "text-cyan-300/50" : "text-white/40"
                        }`}
                      >
                        <i className="fa-solid fa-briefcase text-[9px]"></i>
                        {member.role}
                      </div>
                    ) : (
                      <div
                        className={`text-[11px] font-bold uppercase tracking-wider italic ${
                          isSelected ? "text-cyan-300/20" : "text-white/20"
                        }`}
                      >
                        Member
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {hasEmbeddings && (
                    <div className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 text-[10px] font-black uppercase tracking-widest text-white/30 flex items-center gap-1.5">
                      Registered
                    </div>
                  )}
                </div>
              </div>

              {hasEmbeddings && isSelected && (
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveFaceData(member);
                  }}
                  className="w-full rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-all text-center relative z-20"
                >
                  Remove Face Data
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
