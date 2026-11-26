export type OnboardingStep = 'WELCOME' | 'CLASS' | 'ROSTER' | 'SETTINGS' | 'TUTORIAL' | 'READY' | 'COMPLETED';
export function nextOnboardingStep(state: {
  completed: boolean; welcomeSeen: boolean; classAvailable: boolean; rosterCount: number;
  rosterReviewed: boolean; settingsReviewed: boolean; tutorialDone: boolean;
}): OnboardingStep {
  if (state.completed) return 'COMPLETED';
  if (!state.welcomeSeen) return 'WELCOME';
  if (!state.classAvailable) return 'CLASS';
  if (!state.rosterCount || !state.rosterReviewed) return 'ROSTER';
  if (!state.settingsReviewed) return 'SETTINGS';
  if (!state.tutorialDone) return 'TUTORIAL';
  return 'READY';
}
