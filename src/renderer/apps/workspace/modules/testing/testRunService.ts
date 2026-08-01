import type { Service } from "@/lib/workspace/services/Service";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type {
    RegisteredTest,
    TestAvailability,
    TestId,
    TestRunRecord,
} from "@/lib/testing/types";

/**
 * The face of `Services.TestRun` this feature's interface uses.
 *
 * Written as an intersection with `Service` rather than imported from the run controller's own
 * module: `ServiceRegistry.get` is constrained to `T extends Service`, and the UI genuinely only
 * needs these eight members. Everything the run controller owns beyond them (the registry's write
 * half, the console channel, the capability handles) is deliberately out of reach from here - the
 * interface starts runs and reads records, it does not register tests.
 */
export type TestRunServiceHandle = Service & {
    listTests(): RegisteredTest[];
    getAvailability(id: TestId): TestAvailability;
    /** Resolves the new run's id. */
    start(testId: TestId): Promise<string>;
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
