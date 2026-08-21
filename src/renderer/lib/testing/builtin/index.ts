import type { ServiceRegistry } from "@/lib/workspace/services/serviceRegistry";
import type { TestDefinition } from "../types";
import { createProjectDiagnosticsTest } from "./projectDiagnostics";
import { createReachableEndingsTest } from "./reachableEndings";

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

/**
 * Every test Studio ships.
 *
 * Two, both `integrity` and both headless: one runs the project's own lint rules, the other asks
 * whether every way through the story reaches an ending. Neither opens a window, so both are
 * runnable while the workspace is frozen.
 */
export function createBuiltInTests(host: BuiltInTestHost): TestDefinition[] {
    return [createProjectDiagnosticsTest(host), createReachableEndingsTest(host)];
}

export { PROJECT_DIAGNOSTICS_SLUG, PROJECT_DIAGNOSTICS_TEST_ID, createProjectDiagnosticsTest } from "./projectDiagnostics";
export { REACHABLE_ENDINGS_SLUG, REACHABLE_ENDINGS_TEST_ID, createReachableEndingsTest } from "./reachableEndings";
