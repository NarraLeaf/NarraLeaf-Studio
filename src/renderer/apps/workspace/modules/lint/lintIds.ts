/**
 * The two names the lint surfaces address each other by, kept apart from both of them.
 *
 * The report tab consults the freeze exemption table by command id, and the command opens the tab by
 * tab id; putting either constant in the file that owns the other would make the two import each
 * other. Neither drags in the rule modules or the virtualiser, which is why the command component
 * can name the tab without loading it.
 */

/**
 * The report's tab id - one constant, deliberately not parameterised.
 *
 * A project has one lint report, so re-running from the palette must land back in the tab already
 * open rather than opening a second one: `openEditorTabInGroup` matches on id, so a stable id is
 * what makes "run again" focus instead of accumulate.
 */
export const LINT_REPORT_TAB_ID = "narraleaf-studio:lint-report";

/** The palette command that sweeps the project; exempt from the freeze (ruling R3). */
export const LINT_PROJECT_COMMAND_ID = "lint:project";
