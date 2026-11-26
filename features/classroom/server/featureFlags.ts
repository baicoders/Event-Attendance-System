import 'server-only';
export function classroomAvailableFor(userId: string, isAdmin = false) {
  if (process.env.CLASSROOM_ENABLED !== 'true') return false;
  const pilot = process.env.CLASSROOM_PILOT_USER_IDS?.split(',').map(v => v.trim()).filter(Boolean) ?? [];
  return !pilot.length || pilot.includes(userId) || isAdmin;
}
