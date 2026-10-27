#!/usr/bin/env node
/**
 * Type-checks the five TypeScript projects, one after another.
 *
 *   node scripts/typecheck.mjs                    all five (what `yarn lint` runs)
 *   node scripts/typecheck.mjs renderer runtime   only those
 *   node scripts/typecheck.mjs --fast renderer    only those, fast local mode (see below)
 *
 * The compiler is this checkout's own node_modules/typescript, never `npx tsc`, which can resolve to
 * a cached TypeScript of another major version that reports rootDir and baseUrl errors 5.x does not.
 *
 * One at a time on purpose: renderer, runtime and builtin-plugins each load most of the renderer
 * tree, a few gigabytes apiece, and side by side they push a small machine into swap. For the same
 * reason each gets a larger heap than node's default, under which the renderer program dies with
 * "Reached heap limit" after a minute or more.
 *
 * Each project keeps an incremental cache in .cache/tsc (see `tsBuildInfoFile` in its tsconfig), so
 * the first run is the slow one. Delete that directory for a cold check.
 *
 * That cache only helps a run with nothing to recheck. Invalidation walks the referenced-by graph
 * transitively, and on this tree that graph reaches nearly every file, so one edit costs what a cold
 * check costs: measured on the renderer project, editing one leaf component took 74s and 3.2 GB, and
 * editing one `src/shared` type module took 68s and 3.2 GB, against 61s and 3.3 GB from cold.
 *
 * `--fast` adds --assumeChangesOnlyAffectDirectDependencies, which stops invalidation at the files
 * that import a changed one directly. The same two edits then took 50s and 2.8 GB, and 25s and
 * 2.4 GB. The flag is deliberately unsound: an error that only surfaces through an indirect importer
 * waits for the next full run. So it is a local feedback loop and never the gate - `yarn verify` and
 * CI run the full check, and so does `yarn lint` without the flag.
 *
 * Fast mode keeps a cache file of its own per project. The compiler records the options it ran under
 * in the build info, so a fast run and a full run sharing one file would each discard the other's.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSC = path.join(ROOT, "node_modules/typescript/bin/tsc");
const PROJECTS = ["shared", "main", "renderer", "runtime", "builtin-plugins"];
const HEAP_MB = 6144;

const argv = process.argv.slice(2);
const fast = argv.includes("--fast");
const asked = argv.filter(name => name !== "--fast");
const unknown = asked.filter(name => !PROJECTS.includes(name));
if (unknown.length > 0) {
    console.error(`typecheck: unknown project ${unknown.join(" ")}; expected any of ${PROJECTS.join(" ")}`);
    process.exit(2);
}
if (!fs.existsSync(TSC)) {
    console.error("typecheck: node_modules/typescript is missing. Install dependencies - or, in a git worktree, link the main checkout's node_modules in.");
    process.exit(2);
}

if (fast) {
    console.log("typecheck: fast mode - invalidation stops at direct importers, so an error reached only indirectly waits for a full run");
}

const failed = [];
for (const project of asked.length > 0 ? PROJECTS.filter(name => asked.includes(name)) : PROJECTS) {
    const started = performance.now();
    const { status } = spawnSync(
        process.execPath,
        [
            `--max-old-space-size=${HEAP_MB}`,
            TSC,
            "--project",
            `src/${project}/tsconfig.json`,
            ...(fast
                ? [
                    "--assumeChangesOnlyAffectDirectDependencies",
                    "--tsBuildInfoFile",
                    `.cache/tsc/${project}.fast.tsbuildinfo`,
                ]
                : []),
        ],
        { cwd: ROOT, stdio: "inherit" },
    );
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    console.log(`${status === 0 ? "✓" : "✗"} ${project} (${seconds}s)`);
    if (status !== 0) {
        failed.push(project);
    }
}
if (failed.length > 0) {
    console.error(`typecheck: ${failed.join(", ")} failed`);
    process.exit(1);
}
