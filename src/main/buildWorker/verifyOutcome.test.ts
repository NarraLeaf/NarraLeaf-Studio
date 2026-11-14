import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, "../../..");

async function runVerifyWithRetry(retryExitCode: number, retryPassed: string[] | null = null, emptyFullRun = false) {
    const temp = await mkdtemp(path.join(os.tmpdir(), "nls-verify-outcome-"));
    const preload = path.join(temp, "mock-spawn.cjs");
    try {
        await writeFile(preload, String.raw`
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
let vitestRuns = 0;
cp.spawn = (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    process.nextTick(() => {
        if (!args.includes('node_modules/vitest/vitest.mjs')) {
            child.emit('close', 0);
            return;
        }
        vitestRuns++;
        const file = path.join(process.cwd(), 'src/main/buildWorker/devWatchBuild.test.ts');
        const passed = ${JSON.stringify(retryPassed)};
        const emptyFullRun = ${emptyFullRun};
        const report = vitestRuns === 1 && emptyFullRun
            ? { failed: [], modules: [], unhandledErrors: 0 }
            : vitestRuns === 1
            ? { failed: [{ file, tests: ['a failing test'], testIds: ['failed-test-id'] }], unhandledErrors: 0 }
            : { failed: [], modules: passed === null ? [] : [{ file, state: 'passed', passed }], unhandledErrors: 0 };
        fs.writeFileSync(options.env.NLS_VERIFY_REPORT, JSON.stringify(report));
        child.emit('close', vitestRuns === 1 ? (emptyFullRun ? 0 : 1) : ${retryExitCode});
    });
    return child;
};
`);
        try {
            const result = await execFileAsync(process.execPath, ["--require", preload, "scripts/verify.mjs", "--tests"], { cwd: root, timeout: 5000 });
            return { code: 0, output: result.stdout + result.stderr };
        } catch (error) {
            const failure = error as Error & { code: number; stdout: string; stderr: string };
            return { code: failure.code, output: failure.stdout + failure.stderr };
        }
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
}

it("fails when the retry exits unsuccessfully without reporting a failed test", async () => {
    const result = await runVerifyWithRetry(1);
    expect(result.code, result.output).toBe(1);
    expect(result.output).not.toContain("tests passed");
});

it("fails when the retry does not run the previously failing file", async () => {
    const result = await runVerifyWithRetry(0);
    expect(result.code, result.output).toBe(1);
    expect(result.output).not.toContain("tests passed");
});

it("fails when the file runs but the previously failing test does not pass", async () => {
    const result = await runVerifyWithRetry(0, ["another-test-id"]);
    expect(result.code, result.output).toBe(1);
    expect(result.output).not.toContain("tests passed");
});

it("reports a load-sensitive test only when it passes on retry", async () => {
    const result = await runVerifyWithRetry(0, ["failed-test-id"]);
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain("failed in the full run but passed alone");
});

it("fails when the retry exits unsuccessfully even if its tests passed", async () => {
    const result = await runVerifyWithRetry(1, ["failed-test-id"]);
    expect(result.code, result.output).toBe(1);
    expect(result.output).not.toContain("tests passed");
});

it("fails when the full run completes without running a test", async () => {
    const result = await runVerifyWithRetry(0, null, true);
    expect(result.code, result.output).toBe(1);
    expect(result.output).not.toContain("tests passed");
});
