import { WorkspaceRunCommand } from "@shared/types/menu";

/**
 * The names the test surfaces address each other by, kept apart from all of them.
 *
 * Same reason lint keeps `lintIds.ts`: the Run control opens the picker and the report tab by name,
 * the report tab is opened by the control that watches the run, and putting either constant in the
 * file that owns the other would make the two import each other. Neither of these drags in the
 * dialog, the virtualiser or the registry.
 */

/**
 * The report's tab id - one constant, deliberately not parameterised by run.
 *
 * A project has one test report the way it has one lint report: a finished run replaces what the tab
 * shows rather than opening a second tab, so running five tests in a row leaves one tab and not
 * five. The run being reported on travels in the tab's payload.
 */
export const TEST_REPORT_TAB_ID = "narraleaf-studio:test-report";

/**
 * The palette command that opens the picker. Named like the other `run:*` commands - and taken from
 * the same table they are, because the macOS Develop menu names it too and a copy of the literal
 * here would be one the menu could drift away from without anything failing to compile.
 */
export const TEST_RUN_COMMAND_ID = WorkspaceRunCommand.RunTest;
