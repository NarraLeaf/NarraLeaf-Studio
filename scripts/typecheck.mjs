#!/usr/bin/env node
/**
 * Type-checks the five TypeScript projects, one after another.
 *
 *   node scripts/typecheck.mjs                    all five (what `yarn lint` runs)
 *   node scripts/typecheck.mjs renderer runtime   only those
 *   node scripts/typecheck.mjs --fast renderer    only those, fast local mode (see below)
 *   node scripts/typecheck.mjs --tsc              all five with TypeScript 5.x instead of tsrs
 *
 * The compiler, its flags and its caches are decided in scripts/typecheck-command.mjs, which
 * scripts/verify.mjs uses too, so `yarn lint` and CI check with the same one. It is tsrs, and
 * `--tsc` (or NLS_TYPECHECKER=tsc) runs this checkout's own node_modules/typescript instead - never
 * `npx tsc`, which can resolve to a cached TypeScript of another major version that reports rootDir
 * and baseUrl errors 5.x does not.
 *
 * One at a time on purpose. Under tsrs that costs little: all five take about fifteen seconds from
 * cold. Under tsc the renderer, runtime and builtin-plugins programs each hold a few gigabytes, and
 * side by side they push a small machine into swap.
 *
 * Each project keeps an incremental cache in .cache/tsrs (or .cache/tsc), so a run with nothing
 * changed is the fast one. Delete the directory for a cold check. One edit to a widely imported
 * file costs about what a cold check costs, because invalidation reaches nearly every file.
 *
 * `--fast` is a local feedback loop and never the gate - `yarn verify` and CI run the full check, and
 * so does `yarn lint` without the flag. What it does under each compiler is described beside
 * `typecheckArgs`.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECTS, typecheckArgs, typecheckCompiler, typecheckEntry } from "./typecheck-command.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FLAGS = new Set(["--fast", "--tsc"]);

const argv = process.argv.slice(2);
const fast = argv.includes("--fast");
const asked = argv.filter(name => !FLAGS.has(name));
const unknown = asked.filter(name => !PROJECTS.includes(name));
if (unknown.length > 0) {
    console.error(`typecheck: unknown argument ${unknown.join(" ")}; expected any of ${[...FLAGS, ...PROJECTS].join(" ")}`);
    process.exit(2);
}

let compiler;
try {
    compiler = argv.includes("--tsc") ? "tsc" : typecheckCompiler();
} catch (error) {
    console.error(`typecheck: ${error.message}`);
    process.exit(2);
}
if (!typecheckEntry(ROOT, compiler)) {
    const pkg = compiler === "tsc" ? "typescript" : "tsrs";
    console.error(`typecheck: node_modules/${pkg} is missing. Install dependencies - or, in a git worktree, link the main checkout's node_modules in.`);
    process.exit(2);
}

if (fast) {
    console.log(`typecheck: fast mode (${compiler}) - a local check, not the gate`);
}

const failed = [];
for (const project of asked.length > 0 ? PROJECTS.filter(name => asked.includes(name)) : PROJECTS) {
    const started = performance.now();
    const { status } = spawnSync(process.execPath, typecheckArgs(project, { compiler, fast }), {
        cwd: ROOT,
        stdio: "inherit",
    });
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
