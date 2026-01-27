import type { AttendanceSession } from "../types/recognition.js";

export type AttendanceStatusDisplay =
  | "present"
  | "absent"
  | "late"
  | "no_records";

export interface StatusConfig {
  label: string;
  shortLabel?: string;
  className: string;
  color: string;
}

export function getStatusConfig(
  session: AttendanceSession | null | undefined,
  statusOverride?: "present" | "absent" | "no_records",
): StatusConfig {
  if (statusOverride === "no_records") {
    return {
      label: "No records",
      shortLabel: "No records",
      className: "bg-white/5 text-white/40 border border-white/10",
      color: "text-white/40",
    };
  }

  if (statusOverride === "absent") {
    return {
      label: "Absent",
      shortLabel: "absent",
      className: "bg-rose-500/15 text-rose-200 border border-rose-400/30",
      color: "text-rose-200",
    };
  }

  if (!session) {
    return {
      label: "Absent",
      shortLabel: "absent",
      className: "bg-rose-500/15 text-rose-200 border border-rose-400/30",
      color: "text-rose-200",
    };
  }

  if (session.status === "present" && session.is_late) {
    return {
      label: "Late",
      shortLabel: "late",
      className: "bg-amber-500/15 text-amber-200 border border-amber-400/30",
      color: "text-amber-200",
    };
  }

  if (session.status === "present") {
    return {
      label: "Present",
      shortLabel: "present",
      className: "bg-cyan-500/15 text-cyan-200 border border-cyan-400/30",
      color: "text-cyan-200",
    };
  }

  return {
    label: "Absent",
    shortLabel: "absent",
    className: "bg-rose-500/15 text-rose-200 border border-rose-400/30",
    color: "text-rose-200",
  };
}

export function getStatusLabel(
  session: AttendanceSession | null | undefined,
): string {
  return getStatusConfig(session).label;
}

export function getStatusShortLabel(
  session: AttendanceSession | null | undefined,
): string {
  return getStatusConfig(session).shortLabel || getStatusLabel(session);
}

export function getStatusClassName(
  session: AttendanceSession | null | undefined,
): string {
  return getStatusConfig(session).className;
}

export function getStatusColor(
  session: AttendanceSession | null | undefined,
): string {
  return getStatusConfig(session).color;
}
