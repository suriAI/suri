import { Tooltip } from "./Tooltip";
import type { AttendanceMember } from "@/types/recognition";

interface MemberTooltipProps {
    member?: AttendanceMember | null;
    displayName: string;
    children: React.ReactElement;
    position?: "top" | "bottom" | "left" | "right";
    role?: string;
}

export function MemberTooltip({
    member,
    displayName,
    children,
    position = "right",
    role,
}: MemberTooltipProps) {
    const isRegistered = member?.has_face_data ?? false;
    const memberRole = role || member?.role || "Member";

    const content = (
        <div className="flex flex-col gap-2 p-1 min-w-[180px]">
            <div className="flex flex-col">
                <span className="text-[13px] font-bold text-white tracking-tight">
                    {displayName}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                    {memberRole}
                </span>
            </div>

            <div className="h-px bg-white/10 w-full" />

            <div className="flex items-center gap-2">
                <div
                    className={`w-1.5 h-1.5 rounded-full ${isRegistered ? "bg-cyan-500 shadow-[0_0_8px_rgba(34,211,238,0.5)]" : "bg-white/20"
                        }`}
                />
                <span
                    className={`text-[10px] font-black uppercase tracking-widest ${isRegistered ? "text-cyan-400" : "text-white/30"
                        }`}
                >
                    {isRegistered ? "Face Registered" : "Not Registered"}
                </span>
            </div>

            {member?.email && (
                <div className="flex items-center gap-2 mt-0.5">
                    <i className="fa-solid fa-envelope text-[9px] text-white/20"></i>
                    <span className="text-[10px] text-white/50 truncate">
                        {member.email}
                    </span>
                </div>
            )}
        </div>
    );

    return (
        <Tooltip content={content} position={position} delay={300}>
            {children}
        </Tooltip>
    );
}
