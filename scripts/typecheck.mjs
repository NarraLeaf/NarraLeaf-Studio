#!/usr/bin/env node
/**
 * Type-checks the five TypeScript projects, one after another.
 *
 *   node scripts/typecheck.mjs                    all five (what `yarn lint` runs)
 *   node scripts/typecheck.mjs renderer runtime   only those
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
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSC = path.join(ROOT, "node_modules/typescript/bin/tsc");
const PROJECTS = ["shared", "main", "renderer", "runtime", "builtin-plugins"];
const HEAP_MB = 6144;

const asked = process.argv.slice(2);
const unknown = asked.filter(name => !PROJECTS.includes(name));
if (unknown.length > 0) {
    console.error(`typecheck: unknown project ${unknown.join(" ")}; expected any of ${PROJECTS.join(" ")}`);
    process.exit(2);
}
if (!fs.existsSync(TSC)) {
    console.error("typecheck: node_modules/typescript is missing. Install dependencies - or, in a git worktree, link the main checkout's node_modules in.");
    process.exit(2);
}

const failed = [];
for (const project of asked.length > 0 ? PROJECTS.filter(name => asked.includes(name)) : PROJECTS) {
    const started = performance.now();
    const { status } = spawnSync(
        process.execPath,
        [`--max-old-space-size=${HEAP_MB}`, TSC, "--project", `src/${project}/tsconfig.json`],
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
