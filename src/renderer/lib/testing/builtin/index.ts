import type { ServiceRegistry } from "@/lib/workspace/services/serviceRegistry";
import type { TestDefinition } from "../types";
import { createProjectDiagnosticsTest } from "./projectDiagnostics";
import { createWalkthroughTest } from "./walkthrough";

/**
 * What a built-in test is handed instead of a `TestRunContext` capability.
 *
 * Studio's own tests do not go through `TestProjectHandle` at all - that handle is the bounded way
 * *a plugin* gets in, and it is thin on purpose. A built-in is workspace code, so it reads the
 * workspace the way workspace code does: off the service registry.
 *
 * A function rather than the registry itself, and read on every `run()` rather than captured at
 * registration: the registry is seeded once per window while a service singleton is re-initialised
 * across a project switch, so a captured handle would eventually answer for a project the author
 * closed.
 */
export type BuiltInTestHost = {
    services(): ServiceRegistry;
};

/** Every test Studio ships. */
export function createBuiltInTests(host: BuiltInTestHost): TestDefinition[] {
    return [createProjectDiagnosticsTest(host), createWalkthroughTest(host)];
}

export { PROJECT_DIAGNOSTICS_SLUG, PROJECT_DIAGNOSTICS_TEST_ID, createProjectDiagnosticsTest } from "./projectDiagnostics";
export {
    WALKTHROUGH_ENDING_PARAMETER,
    WALKTHROUGH_SLUG,
    WALKTHROUGH_TEST_ID,
    createWalkthroughTest,
    decodeWalkthroughEnding,
    encodeWalkthroughEnding,
} from "./walkthrough";
