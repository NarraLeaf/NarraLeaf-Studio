#!/usr/bin/env node
/**
 * Everything CI's verify gate checks, run on this machine with one command.
 *
 *   node scripts/verify.mjs                  the checks, then the whole vitest suite
 *   node scripts/verify.mjs --checks         only the checks
 *   node scripts/verify.mjs --tests          only the vitest suite
 *   node scripts/verify.mjs --checks --ci    what .github/workflows/ci.yml runs: folded log groups
 *
 * `yarn verify` is the same from the main checkout. Yarn will not run scripts from a git worktree of
 * this repository, so call node there; every tool below is resolved by path from this checkout's own
 * node_modules, never through yarn or npx, which from a worktree can quietly run the main checkout's
 * copy - or a global one of another major version - and pass.
 *
 * Why one script: the list a developer ran before pushing and the list CI ran were two lists, and
 * they drifted. CI also checked the script API declarations, the plugin API types and oxlint, nothing
 * local asked for them, and develop went red eleven times running on a declaration file that takes
 * forty seconds to check here. CI now runs its checks through this file, so the lists are one list.
 *
 * The checks run side by side: they are independent, single-threaded and mostly TypeScript. The test
 * suite runs after them and alone, because a full vitest run takes every core there is, and the tests
 * that sit near vitest's 5-second timeout go red when something else is competing for them.
 *
 * Even alone, a few of those can time out under the suite's own load - the ones that walk the whole
 * source tree, frame-by-frame weather rendering, flag reachability. So a file that fails in the full
 * run is run once more by itself before it counts: failing in the full run and passing alone is the
 * mark of that, and is reported as load-sensitive rather than as a failure. A test that fails alone
 * too fails the run, and so does any error vitest could not pin to a test. CI does not do this; there
 * a red test stays red.
 *
 * What this machine cannot tell you, and CI still will: anything Linux decides differently (path
 * spelling, file watching), and the Android SDK oracle unless ANDROID_HOME names an SDK.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FLAGS = new Set(["--checks", "--tests", "--ci"]);
const argv = process.argv.slice(2);
const unknown = argv.filter(arg => !FLAGS.has(arg));
if (unknown.length > 0) {
    console.error(`verify: unknown argument ${unknown.join(" ")}; expected any of ${[...FLAGS].join(" ")}`);
    process.exit(2);
}
const CI = argv.includes("--ci");
const RUN_CHECKS = argv.includes("--checks") || !argv.includes("--tests");
const RUN_TESTS = argv.includes("--tests") || !argv.includes("--checks");

const TOOLS = {
    tsc: "node_modules/typescript/bin/tsc",
    oxlint: "node_modules/oxlint/bin/oxlint",
    vitest: "node_modules/vitest/vitest.mjs",
};
for (const tool of Object.values(TOOLS)) {
    if (!fs.existsSync(path.join(ROOT, tool))) {
        console.error(
            `verify: ${tool} is missing. Install dependencies - or, in a git worktree, link the main ` +
            "checkout's node_modules in (see CLAUDE.md).",
        );
        process.exit(2);
    }
}

/** Runs `node <args>` in the checkout, capturing its output unless told to pass it through. */
function run(args, { env = {}, capture = true } = {}) {
    return new Promise(resolve => {
        const started = performance.now();
        const child = spawn(process.execPath, args, {
            cwd: ROOT,
            env: { ...process.env, ...env },
            stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
        });
        const chunks = [];
        if (capture) {
            child.stdout.on("data", chunk => chunks.push(chunk));
            child.stderr.on("data", chunk => chunks.push(chunk));
        }
        child.on("error", error => chunks.push(Buffer.from(String(error?.stack ?? error))));
        child.on("close", code => resolve({
            code: code ?? 1,
            output: Buffer.concat(chunks).toString("utf8"),
            seconds: (performance.now() - started) / 1000,
        }));
    });
}

/** Heap a typecheck may grow to, and the memory one check is budgeted when deciding how many run at once. */
const TSC_HEAP_MB = 6144;
const CHECK_MEMORY_MB = 3072;

const indent = text => text.replace(/^/gm, "    ");
const seconds = value => `${value.toFixed(1)}s`;
const toPosix = file => path.relative(ROOT, file).split(path.sep).join("/");

/* ----------------------------------------------------------------------------------- checks */

async function runChecks() {
    // Built somewhere of its own: dist/runtime is what a running `yarn dev` previews games from.
    const runtimeOutDir = fs.mkdtempSync(path.join(os.tmpdir(), "nls-verify-runtime-"));
    // The renderer-sized programs outgrow node's default heap on a machine with little memory and
    // die with "Reached heap limit" after a minute or more, which looks like a hang.
    const typecheck = project => ({
        name: `Typecheck ${project}`,
        args: [`--max-old-space-size=${TSC_HEAP_MB}`, TOOLS.tsc, "--project", `src/${project}/tsconfig.json`],
    });
    // Slowest first, so the last free slot is not the one left holding the longest check.
    const checks = [
        typecheck("renderer"),
        // Regenerates the published plugin API declarations and fails if they no longer compile on
        // their own; otherwise a refactor that leaks an internal type into the plugin surface is
        // caught at publish time, after the API has shipped.
        { name: "Plugin API types", args: ["packages/plugin-types/build.mjs"] },
        // The declarations a script's author imports are generated from Studio's source and checked
        // in. Stale, they let an author complete against members the runtime does not have.
        { name: "Script API declarations", args: ["scripts/gen-script-api-dts.mjs", "--check"] },
        typecheck("runtime"),
        typecheck("builtin-plugins"),
        // Type-aware (oxlint-tsgolint) over the same five projects, plus the lint rules in
        // .oxlintrc.json. Advisory for now: the correctness category is at `warn`, which does not
        // fail, and the backlog is several hundred, mostly React effect/ref rules - so a failure
        // shows only its errors. It still fails on a TypeScript error. Raise the category to `error`
        // once the backlog is worked down.
        { name: "Oxlint", args: [TOOLS.oxlint], hide: line => /: warning /.test(line) },
        typecheck("main"),
        // The game runtime bundles part of the Studio renderer and refuses the rest in an esbuild
        // plugin, so an import it may not have passes tsc and vitest and breaks every game build.
        { name: "Runtime bundle", args: ["project/build/build-runtime.js", `--out-dir=${runtimeOutDir}`] },
        typecheck("shared"),
        // Counts the hard-coded styling patterns docs/design-system.md is retiring and fails if any
        // count rises above scripts/style-ratchet.baseline.json. A rise is argued for in the change
        // that causes it, with `--save`, not discovered months later.
        { name: "Style ratchet", args: ["scripts/style-ratchet.mjs"] },
        // The Chinese and Japanese starter projects are generated from the English one and checked
        // in; this regenerates them in memory and fails on any file that differs, or on an English
        // string the translation tables have no entry for.
        { name: "Starter template translations", args: ["scripts/gen-skeleton-locale.mjs", "--check"] },
    ];

    // Cores alone overcommit memory: the renderer, runtime and builtin-plugins programs and the
    // plugin API build each hold most of the renderer tree, a few gigabytes apiece, and eight of
    // them side by side on an 8 GB machine spend the run swapping. A CI runner (16 GB, 4 cores)
    // is still limited by its cores.
    const cores = os.availableParallelism?.() ?? os.cpus().length;
    const byMemory = Math.max(1, Math.floor(os.totalmem() / (CHECK_MEMORY_MB * 1024 * 1024)));
    const lanes = Math.min(checks.length, cores, byMemory);
    console.log(`verify: ${checks.length} checks, ${lanes} at a time`);
    const failed = [];
    const started = performance.now();
    let next = 0;
    try {
        await Promise.all(Array.from({ length: lanes }, async () => {
            while (next < checks.length) {
                const check = checks[next++];
                const result = await run(check.args);
                reportCheck(check, result);
                if (result.code !== 0) {
                    failed.push(check.name);
                }
            }
        }));
    } finally {
        fs.rmSync(runtimeOutDir, { recursive: true, force: true });
    }
    return { failed, seconds: (performance.now() - started) / 1000 };
}

function reportCheck(check, result) {
    const ok = result.code === 0;
    const line = `${ok ? "✓" : "✗"} ${check.name.padEnd(30)} ${seconds(result.seconds).padStart(7)}`;
    if (CI) {
        // A passing check's log is folded away; a failing one is annotated and left open.
        if (ok) {
            console.log(`::group::${line}`);
            process.stdout.write(result.output);
            console.log("::endgroup::");
        } else {
            console.log(`::error title=${check.name}::${check.name} failed`);
            console.log(line);
            console.log(failureOutput(check, result.output));
        }
        return;
    }
    console.log(`  ${line}`);
    if (!ok) {
        console.log(indent(failureOutput(check, result.output)));
    }
}

/** What a failed check printed, less the lines it says do not explain a failure. */
function failureOutput(check, output) {
    const lines = output.trimEnd().split(/\r?\n/);
    const kept = check.hide ? lines.filter(line => !check.hide(line)) : lines;
    const hidden = lines.length - kept.length;
    return (hidden > 0 ? [...kept, `(${hidden} advisory line(s) not shown)`] : kept).join("\n");
}

/* ------------------------------------------------------------------------------------ tests */

async function runTests() {
    const started = performance.now();
    await stageCodesignTools();

    const reportPath = path.join(os.tmpdir(), `nls-verify-${process.pid}.json`);
    try {
        console.log("verify: running the whole vitest suite");
        const full = await runVitest([], reportPath);
        if (full.code === 0) {
            return outcome(started, []);
        }
        if (!full.report) {
            return outcome(started, [{ file: "vitest", tests: [`exited ${full.code} without finishing the run`] }]);
        }

        const failures = [];
        if (full.report.unhandledErrors > 0) {
            failures.push({ file: "vitest", tests: [`${full.report.unhandledErrors} error(s) outside any test - see "Unhandled Errors" above`] });
        }
        if (full.report.failed.length === 0) {
            if (failures.length === 0) {
                failures.push({ file: "vitest", tests: [`exited ${full.code} with no failing test`] });
            }
            return outcome(started, failures);
        }

        const files = full.report.failed.map(entry => toPosix(entry.file));
        console.log(`\nverify: ${files.length} file(s) failed in the full run; running them again on their own`);
        const again = await runVitest(files, reportPath);
        if (!again.report) {
            return outcome(started, [...failures, ...full.report.failed]);
        }
        if (again.report.unhandledErrors > 0) {
            failures.push({ file: "vitest", tests: [`${again.report.unhandledErrors} error(s) outside any test when run alone`] });
        }
        const failingAlone = new Set(again.report.failed.map(entry => toPosix(entry.file)));
        const loadSensitive = [];
        for (const entry of full.report.failed) {
            (failingAlone.has(toPosix(entry.file)) ? failures : loadSensitive).push(entry);
        }
        return outcome(started, failures, loadSensitive);
    } finally {
        fs.rmSync(reportPath, { force: true });
    }
}

function outcome(started, failures, loadSensitive = []) {
    return { failures, loadSensitive, seconds: (performance.now() - started) / 1000 };
}

async function runVitest(filters, reportPath) {
    fs.rmSync(reportPath, { force: true });
    const result = await run(
        [TOOLS.vitest, "run", "--reporter=default", "--reporter=./scripts/verify-reporter.mjs", ...filters],
        { env: { NLS_VERIFY_REPORT: reportPath }, capture: false },
    );
    let report = null;
    try {
        report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    } catch {
        // No report means vitest stopped before the run ended; the caller says so.
    }
    return { ...result, report };
}

/**
 * The iOS signing oracle signs with the real zsign, which a fresh checkout or worktree has not
 * staged, and without it the oracle skips - which reads exactly like a pass. Staging is pinned and
 * checksummed, and a no-op once done.
 */
async function stageCodesignTools() {
    const result = await run(["project/build/prepare-codesign-tools.js"]);
    if (result.code !== 0) {
        console.log(`verify: could not stage zsign, so the iOS signing oracle will skip:\n${indent(result.output.trimEnd())}`);
    } else if (result.output.includes("fetching")) {
        console.log("verify: staged zsign for the iOS signing oracle");
    }
}

/* ---------------------------------------------------------------------------------- summary */

const checks = RUN_CHECKS ? await runChecks() : null;
const tests = RUN_TESTS ? await runTests() : null;

console.log("\n──────── verify ────────");
if (checks) {
    console.log(checks.failed.length === 0
        ? `✓ checks passed (${seconds(checks.seconds)})`
        : `✗ checks failed: ${checks.failed.join(", ")} (${seconds(checks.seconds)})`);
}
if (tests) {
    if (tests.failures.length === 0) {
        console.log(`✓ tests passed (${seconds(tests.seconds)})`);
    } else {
        console.log(`✗ tests failed (${seconds(tests.seconds)}):`);
        for (const entry of tests.failures) {
            console.log(`    ${entry.file === "vitest" ? "vitest" : toPosix(entry.file)}`);
            for (const name of entry.tests) {
                console.log(`      ${name}`);
            }
        }
    }
    if (tests.loadSensitive.length > 0) {
        console.log("! failed in the full run but passed alone - load, not the change; CI may still hit it:");
        for (const entry of tests.loadSensitive) {
            console.log(`    ${toPosix(entry.file)}`);
            for (const name of entry.tests) {
                console.log(`      ${name}`);
            }
        }
    }
    const notCovered = [];
    if (process.platform !== "linux") {
        notCovered.push("Linux-only behaviour (path spelling, file watching)");
    }
    if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) {
        notCovered.push("the Android SDK oracle (no ANDROID_HOME)");
    }
    if (notCovered.length > 0 && !CI) {
        console.log(`  Only CI covers: ${notCovered.join("; ")}.`);
    }
}

const failed = (checks?.failed.length ?? 0) > 0 || (tests?.failures.length ?? 0) > 0;
process.exit(failed ? 1 : 0);
