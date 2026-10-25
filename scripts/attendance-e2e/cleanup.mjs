/** Release every owned resource even if an earlier release fails. */
export async function cleanupAll(tasks) {
  const errors = [];
  for (const task of tasks) {
    try { await task(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, errors.map((error) => error.message).join("; "));
}
