/**
 * The test pipeline - the public surface.
 *
 * `types.ts` is the contract (read it first); everything outside `lib/testing` should come through
 * here rather than reaching into a file.
 */
export type {
    RegisteredTest,
    TestAvailability,
    TestAvailabilityContext,
    TestCapability,
    TestCategory,
    TestDefinition,
    TestFinding,
    TestFindingSeverity,
    TestGameEvent,
    TestGameExit,
    TestGameExitReason,
    TestGameHandle,
    TestGameLaunchOptions,
    TestGameSession,
    TestId,
    TestLogEntry,
    TestLogLevel,
    TestPresentation,
    TestProgress,
    TestProjectHandle,
    TestRunContext,
    TestRunCounts,
    TestRunRecord,
    TestRunStatus,
    TestSceneRef,
    TestStoryRef,
    TestText,
    TestVerdict,
} from "./types";
export {
    TEST_CAPABILITIES,
    TEST_CATEGORY_ORDER,
    TEST_FINDING_SEVERITY_ORDER,
    TEST_PROTOCOL_VERSION,
    TEST_TERMINAL_STATUSES,
    countTestFindings,
    deriveBuiltInTestSlug,
} from "./types";
export { TestRegistry, testRegistry } from "./registry";
export type { TestRegisterOptions } from "./registry";
export { formatTestText, testTextSortKey } from "./testText";
export { TEST_CONSOLE_CHANNEL, TEST_CONSOLE_SOURCE, TestRunService } from "./TestRunService";
export { PROJECT_DIAGNOSTICS_SLUG, PROJECT_DIAGNOSTICS_TEST_ID } from "./builtin";
export type { BuiltInTestHost } from "./builtin";
