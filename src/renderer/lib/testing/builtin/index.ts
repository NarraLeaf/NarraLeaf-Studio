import type { ServiceRegistry } from "@/lib/workspace/services/serviceRegistry";
import type { TestDefinition } from "../types";
import { createProjectDiagnosticsTest } from "./projectDiagnostics";
import { createReachableEndingsTest } from "./reachableEndings";
import { createRouteCoverageTest } from "./routeCoverage";
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

/**
 * Every test Studio ships.
 *
 * Four. Three are `integrity` and headless - one runs the project's own lint rules, one asks whether
 * every way through the story reaches an ending, and one asks what a player can reach once the
 * conditions are read - so all three are runnable while the workspace is frozen. The fourth plays
 * the game to an ending the author names, and therefore opens a window.
 *
 * The two story checks are deliberately separate rather than one deeper check. `reachable-endings`
 * is a claim about the script's shape and holds whatever the variables do; `route-coverage` is a
 * claim about the state and is only ever as good as what it could derive. Folding them together
 * would make the first answer as conditional as the second.
 */
export function createBuiltInTests(host: BuiltInTestHost): TestDefinition[] {
    return [
        createProjectDiagnosticsTest(host),
        createReachableEndingsTest(host),
        createRouteCoverageTest(host),
        createWalkthroughTest(host),
    ];
}

export { PROJECT_DIAGNOSTICS_SLUG, PROJECT_DIAGNOSTICS_TEST_ID, createProjectDiagnosticsTest } from "./projectDiagnostics";
export { REACHABLE_ENDINGS_SLUG, REACHABLE_ENDINGS_TEST_ID, createReachableEndingsTest } from "./reachableEndings";
export { ROUTE_COVERAGE_SLUG, ROUTE_COVERAGE_TEST_ID, createRouteCoverageTest } from "./routeCoverage";
export {
    WALKTHROUGH_ENDING_PARAMETER,
    WALKTHROUGH_SLUG,
    WALKTHROUGH_TEST_ID,
    createWalkthroughTest,
    decodeWalkthroughEnding,
    encodeWalkthroughEnding,
} from "./walkthrough";
