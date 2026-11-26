/** Identity and legacy Events approval are distinct from Classroom membership. */
export type WorkspaceIdentity = {
  role: string;
  status: string;
  accountState?: string;
  mustChangePassword?: boolean;
};
export type ClassroomAccessStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'REVOKED';
export function workspaceCapabilities(user: WorkspaceIdentity, classroomStatus?: ClassroomAccessStatus | null) {
  const usable = user.accountState !== 'DISABLED' && !user.mustChangePassword;
  const admin = usable && user.role === 'ADMIN' && user.status === 'ACTIVE';
  return {
    events: usable && user.status === 'ACTIVE' && (user.role === 'ORGANIZER' || admin),
    classroom: usable && (admin || classroomStatus === 'APPROVED'),
    admin,
  };
}
