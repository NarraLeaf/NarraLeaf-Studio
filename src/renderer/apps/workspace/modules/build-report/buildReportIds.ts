/**
 * The report's tab id, kept apart from the component so the notification that opens the tab does not
 * have to load the page to name it.
 *
 * One constant, deliberately not parameterised: a project has one build report, and running two
 * builds in a row must leave one tab rather than two.
 */
export const BUILD_REPORT_TAB_ID = "narraleaf-studio:build-report";
