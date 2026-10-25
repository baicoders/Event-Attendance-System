/** A partial/crashed run or failed cleanup must never look successful. */
export function recordInfrastructureFailure(report, message) {
  return {
    ...report,
    status: "infrastructure_failure",
    infrastructureErrors: [...(report.infrastructureErrors || []), message],
  };
}
