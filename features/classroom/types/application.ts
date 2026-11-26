import type { ClassroomAccessStatus } from '@/features/auth/utils/accessPolicy';
export type TeacherApplicationDto = {
  userId: string; status: ClassroomAccessStatus; departmentOrDesignation: string;
  staffReference: string | null; applicationText: string; decisionReason: string | null;
  revision: number; appliedAt: string; reviewedAt: string | null;
};
