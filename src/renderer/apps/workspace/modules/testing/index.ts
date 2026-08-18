/**
 * The test pipeline's interface: the Run > Test picker, the report tab, and the shared model both
 * of them and the Run control read.
 *
 * The registry (what tests exist) and the run controller (what happens when one starts) live in
 * `@/lib/testing`; nothing here registers or runs anything itself.
 */
export { openTestDialog, TestPickerContent } from "./TestPickerDialog";
export { createTestReportTab, openTestReportTab, testReportModule } from "./openTestReportTab";
export { TestReportTab, type TestReportPayload } from "./TestReportTab";
export { TEST_REPORT_TAB_ID, TEST_RUN_COMMAND_ID } from "./testIds";
export { getTestRunService, type TestRunServiceHandle } from "./testRunService";
export {
  formatTestDuration,
  groupTestsByCategory,
  isTerminalTestStatus,
  resolveTestText,
  sortTestFindings,
  TEST_CATEGORY_LABEL_KEYS,
  TEST_PRESENTATION_LABEL_KEYS,
  TEST_SEVERITY_LABEL_KEYS,
  TEST_SEVERITY_TEXT_CLASS,
  TEST_STATUS_LABEL_KEYS,
  TEST_TOAST_KEYS,
  TEST_TOAST_TONE,
  type TerminalTestStatus,
  type TestCategoryGroup
} from "./testModel";
