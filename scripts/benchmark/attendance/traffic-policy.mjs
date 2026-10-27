/** Active query reads: polling refreshes all active queries; a save invalidates only its own student. */
export function statusReadPaths({screen,eventId,manualOpen=false,selectedStudentId,writtenStudentId}) {
  const paths=[`/api/events/${eventId}/stats`];
  if(screen==='regular')paths.push(`/api/events/${eventId}/records`);
  if(screen==='regular' || manualOpen)paths.push(`/api/events/${eventId}/records?includeWithoutTimeIn=true`);
  if((screen==='regular' || manualOpen) && selectedStudentId && (!writtenStudentId || writtenStudentId===selectedStudentId)) {
    paths.push(`/api/records?${new URLSearchParams({eventId,studentId:selectedStudentId})}`);
  }
  return paths;
}

export function shouldPoll(lastCompletedAt,pending,now) {
  return !pending && (lastCompletedAt===undefined || now-lastCompletedAt>=8000);
}
