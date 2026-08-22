import type { Service } from "@/lib/workspace/services/Service";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { TestParameterMemory } from "@/lib/testing/parameterCache";
import type { ResolvedTestParameter } from "@/lib/testing/parameters";
import type {
    RegisteredTest,
    TestAvailability,
    TestId,
    TestParameterValues,
    TestRunRecord,
} from "@/lib/testing/types";

/**
 * The face of `Services.TestRun` this feature's interface uses.
 *
 * Written as an intersection with `Service` rather than imported from the run controller's own
 * module: `ServiceRegistry.get` is constrained to `T extends Service`, and the UI genuinely only
 * needs these members. Everything the run controller owns beyond them (the registry's write half,
 * the console channel, the capability handles) is deliberately out of reach from here - the
 * interface starts runs and reads records, it does not register tests.
 */
export type TestRunServiceHandle = Service & {
    listTests(): RegisteredTest[];
    getAvailability(id: TestId): TestAvailability;
    /** What a test asks the author for, with every `select`'s option list already evaluated. */
    listParameters(id: TestId): ResolvedTestParameter[];
    /** Load what those lists read. Awaited before the picker opens; never rejects. */
    prepareParameterSources(): Promise<void>;
    /** The values each test was last run with. Never rejects: a missing cache is the ordinary state. */
    readRememberedParameters(): Promise<TestParameterMemory>;
    /** Keep what a test was just started with, for the next time the picker opens. */
    rememberParameters(testId: TestId, values: TestParameterValues): Promise<void>;
    /** Resolves the new run's id. */
    start(testId: TestId, parameters?: TestParameterValues): Promise<string>;
    cancel(runId: string): void;
    getActiveRun(): TestRunRecord | null;
    getRun(runId: string): TestRunRecord | null;
    /** Newest first. */
    listRuns(): TestRunRecord[];
    onChanged(listener: () => void): () => void;
};

export function getTestRunService(context: WorkspaceContext): TestRunServiceHandle {
    return context.services.get<TestRunServiceHandle>(Services.TestRun);
}
