import type {
  AttendanceGroup,
  AttendanceMember,
} from "../../../types/recognition";

export interface GroupWithMembers extends AttendanceGroup {
  members: AttendanceMember[];
  isLoading?: boolean;
}

export type MemberField = "name" | "email" | "role";
export type GroupField = "name" | "description";

export interface EditingMember {
  personId: string;
  field: MemberField;
}

export interface EditingGroup {
  groupId: string;
  field: GroupField;
}
