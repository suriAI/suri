/**
 * Member cache helper functions to eliminate code duplication
 */

import { attendanceManager } from "../../../services";
import type {
  AttendanceGroup,
  AttendanceMember,
} from "../../../types/recognition";

/**
 * Gets a member from cache or fetches it if not cached
 * Returns null if member doesn't exist or doesn't belong to the group (when group is specified)
 * When no group is specified, returns member name if available, otherwise uses personId
 */
export async function getMemberFromCache(
  personId: string,
  currentGroup: AttendanceGroup | null,
  memberCacheRef: React.RefObject<Map<string, AttendanceMember | null>>,
): Promise<{ member: AttendanceMember | null; memberName: string } | null> {
  try {
    if (!memberCacheRef.current) return null;
    let member = memberCacheRef.current.get(personId);
    if (!member && member !== null) {
      member = await attendanceManager.getMember(personId);
      (
        memberCacheRef as React.RefObject<Map<string, AttendanceMember | null>>
      ).current.set(personId, member || null);
    }

    // If we have a current group, validate that the member exists and belongs to it
    if (currentGroup) {
      if (!member) {
        return null;
      }
      const memberName = member.name || personId;
      if (member.group_id !== currentGroup.id) {
        return null;
      }
      return { member, memberName };
    } else {
      // No current group - just get the member name if available (matches original behavior)
      // Note: This branch should never execute in practice due to early return in performFaceRecognition
      // but kept for defensive programming and to match original code structure
      const memberName = member?.name || personId;
      return { member: member || null, memberName };
    }
  } catch {
    if (memberCacheRef.current) {
      (
        memberCacheRef as React.RefObject<Map<string, AttendanceMember | null>>
      ).current.set(personId, null);
    }
    // In original, when no group, catch doesn't return null - it just sets cache to null
    // But since we're in a try-catch, we need to return something
    // Match original: if no group, return with personId as name; if group, return null
    if (currentGroup) {
      return null;
    } else {
      return { member: null, memberName: personId };
    }
  }
}
