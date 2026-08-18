/**
 * `test` - the test pipeline: the Run > Test picker, the report tab, the status-bar phase, the
 * console channel, and Studio's own built-in tests.
 *
 * "Test" here means a check an author runs against *their game* (does it reach an ending, does it
 * survive with no network). Nothing in this namespace has anything to do with the repo's own unit
 * tests.
 *
 * Two conventions, both load-bearing:
 *
 *  - A built-in test's strings live under `builtin.<slug>`, where the slug is what
 *    `deriveBuiltInTestSlug` produces from its id - so a renamed id cannot leave dead keys behind.
 *  - Titles are short noun phrases and a description is one clause. Nothing here is a sentence
 *    explaining the UI: the interface does not narrate itself.
 */
export const test = {
  action: {
    // The Run dropdown row, beside Production Build. Ellipsis for the same reason: it opens a
    // picker rather than starting anything.
    open: "Test…",
    // The palette entry that opens that same picker.
    run: "Run a test",
    stop: "Stop the test"
  },
  // The mode name in the status bar's run cell, which reads "<mode> | <phase>". The phase itself
  // comes from `workspace.shell.statusBar.phase.*`, shared with the other run kinds.
  statusBar: {
    label: "Test"
  },
  category: {
    integrity: "Integrity",
    runtime: "Runtime",
    compatibility: "Compatibility",
    custom: "Custom"
  },
  // Badged on every picker row: whether a game window is about to appear.
  presentation: {
    headless: "Headless",
    windowed: "Windowed"
  },
  picker: {
    title: "Run a test",
    start: "Start",
    empty: "No tests are registered"
  },
  status: {
    running: "Running",
    passed: "Passed",
    failed: "Failed",
    skipped: "Skipped",
    cancelled: "Cancelled",
    errored: "Errored"
  },
  severity: {
    error: "Error",
    warning: "Warning",
    info: "Info"
  },
  report: {
    title: "Test Report",
    // Two different silences: a finished run that found nothing, and a tab with no run behind it.
    empty: "No findings",
    none: "No run yet",
    rerun: "Run again",
    severityFilter: "Severity",
    filterAll: "All",
    findings: "{errors} errors, {warnings} warnings, {infos} info",
    durationSeconds: "{seconds}s",
    durationMinutes: "{minutes}m {seconds}s"
  },
  // Why a picker row is greyed out. An unavailable test is a normal state, not an error.
  reason: {
    frozen: "Not available while the workspace is frozen",
    alreadyRunning: "Another run is in progress"
  },
  console: {
    channel: "Test",
    started: "{title} started",
    finished: "{title} {status} in {duration}",
    finding: "{severity} {message}"
  },
  toast: {
    passed: "{title} passed",
    failed: "{title} failed",
    skipped: "{title} skipped",
    cancelled: "{title} cancelled",
    errored: "{title} could not run"
  },
  builtin: {
    projectDiagnostics: {
      title: "Project diagnostics",
      description: "Every project lint rule, run as one check",
      summary: {
        passed: "No problems found",
        failed: "{errors} errors, {warnings} warnings"
      }
    }
  }
} as const;
