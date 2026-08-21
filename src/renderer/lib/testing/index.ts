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
    TestBooleanParameterDefinition,
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
    TestParameterDefinition,
    TestParameterOption,
    TestParameterValue,
    TestParameterValues,
    TestPresentation,
    TestProgress,
    TestProjectHandle,
    TestRunContext,
    TestRunCounts,
    TestRunRecord,
    TestRunStatus,
    TestSceneRef,
    TestSelectParameterDefinition,
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
export {
    findEmptyTestSelect,
    resolveTestParameters,
    resolveTestParameterValue,
    resolveTestParameterValues,
    testParameterId,
} from "./parameters";
export type { ResolvedTestParameter } from "./parameters";
export {
    EMPTY_TEST_PARAMETER_MEMORY,
    parseTestParameterMemory,
    rememberTestParameters,
    serializeTestParameterMemory,
} from "./parameterCache";
export type { TestParameterMemory } from "./parameterCache";
export { formatTestText, testTextSortKey } from "./testText";
export { TEST_CONSOLE_CHANNEL, TEST_CONSOLE_SOURCE, TestRunService } from "./TestRunService";
export { PROJECT_DIAGNOSTICS_SLUG, PROJECT_DIAGNOSTICS_TEST_ID } from "./builtin";
export type { BuiltInTestHost } from "./builtin";
