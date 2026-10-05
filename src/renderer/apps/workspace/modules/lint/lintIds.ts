/**
 * The names the lint surfaces address each other by, kept apart from all of them.
 *
 * The panel consults the freeze exemption table by command id, and the command opens the panel by
 * panel id; putting either constant in the file that owns the other would make the two import each
 * other. Neither drags in the rule modules or the virtualiser, which is why the command component
 * and the status bar cell can name the panel without loading it.
 */

/** The Problems panel, in the bottom dock beside the Console. */
export const PROBLEMS_PANEL_ID = "narraleaf-studio:problems";

/** The palette command that checks the project afresh; exempt from the freeze (ruling R3). */
export const LINT_PROJECT_COMMAND_ID = "lint:project";
