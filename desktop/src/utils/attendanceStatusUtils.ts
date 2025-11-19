import type { AttendanceSession } from "../types/recognition.js";

/**
 * Centralized attendance status labels and utilities
 * This ensures consistent status display across the entire application
 */

export type AttendanceStatusDisplay =
  | "present"
  | "absent"
  | "late"
  | "no_records";

export interface StatusConfig {
  label: string;
  shortLabel?: string; // For compact displays
  className: string;
  color: string;
}

/**
 * Get status display configuration
 * Centralizes all status label logic in one place
 */
export function getStatusConfig(
  session: AttendanceSession | null | undefined,
  statusOverride?: "present" | "absent" | "no_records",
): StatusConfig {
  // If status override is provided (e.g., from frontend logic), use it
  // This handles the case where we know the status but session is null
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

  // No session = check if it's "no records" or "absent"
  // Default to "Absent" if no session exists (member was enrolled but didn't track)
  // This is a fallback - frontend should provide statusOverride for accuracy
  if (!session) {
    // Default to "Absent" for missing sessions (enrolled but didn't track)
    // Frontend should explicitly pass "no_records" for pre-enrollment dates
    return {
      label: "Absent",
      shortLabel: "absent",
      className: "bg-rose-500/15 text-rose-200 border border-rose-400/30",
      color: "text-rose-200",
    };
  }

  // Present but late
  if (session.status === "present" && session.is_late) {
    return {
      label: "Late",
      shortLabel: "late",
      className: "bg-amber-500/15 text-amber-200 border border-amber-400/30",
      color: "text-amber-200",
    };
  }

  // Present
  if (session.status === "present") {
    return {
      label: "Present",
      shortLabel: "present",
      className: "bg-cyan-500/15 text-cyan-200 border border-cyan-400/30",
      color: "text-cyan-200",
    };
  }

  // Absent
  return {
    label: "Absent",
    shortLabel: "absent",
    className: "bg-rose-500/15 text-rose-200 border border-rose-400/30",
    color: "text-rose-200",
  };
}

/**
 * Get status label for display
 */
export function getStatusLabel(
  session: AttendanceSession | null | undefined,
): string {
  return getStatusConfig(session).label;
}

/**
 * Get status short label for compact displays
 */
export function getStatusShortLabel(
  session: AttendanceSession | null | undefined,
): string {
  return getStatusConfig(session).shortLabel || getStatusLabel(session);
}

/**
 * Get status CSS classes for styling
 */
export function getStatusClassName(
  session: AttendanceSession | null | undefined,
): string {
  return getStatusConfig(session).className;
}

/**
 * Get status color class
 */
export function getStatusColor(
  session: AttendanceSession | null | undefined,
): string {
  return getStatusConfig(session).color;
}
