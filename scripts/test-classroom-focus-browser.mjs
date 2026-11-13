// Reuse disposable roster/API fixtures for the one-student attendance workflow.
process.env.CLASSROOM_FOCUS_BROWSER = 'true';
await import('./test-classroom-attendance-browser.mjs');
