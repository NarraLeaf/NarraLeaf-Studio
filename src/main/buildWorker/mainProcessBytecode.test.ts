import vm from "vm";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import path from "path";
import { describe, expect, it } from "vitest";
import { buildGuardMaskTable, parseGuardMaskTable } from "@shared/utils/runtimeStartupArguments";
import { BYTECODE_V8_FLAGS, bytecodeEngineTag, compileMainToBytecode, MAIN_BYTECODE_FILENAME, renderMainBytecodeBootstrap, reseedGuardMaskTable } from "./mainProcessBytecode";

/**
 * The compile half runs under the game's own engine in a real build; here it runs under the test's
 * Node, which is enough to pin the image format and prove a compiled module runs with its exports
 * intact. Loading it back mirrors the shipped bootstrap exactly - the same header parse, the same
 * placeholder source, the same `runInThisContext` - so a change to either side that breaks the other
 * fails here. The engine-match across a real build worker and a real game is what the packaged
 * acceptance covers; it cannot be reached from Node.
 */
const BYTECODE_MAGIC = 0x4e4c4243;

/** A stand-in main.js: a require, a closure and a nested (lazily compiled) function. */
const SAMPLE_SOURCE = [
    "const os = require('os');",
    "function outer(n) { const inner = () => n * 2 + (os.platform() ? 1 : 0); return inner(); }",
    "module.exports = { doublePlus: outer, marker: 'runs' };",
].join("\n");

/** Load an image the way the shipped bootstrap does, for the round-trip. */
function loadImage(blob: Buffer, filename: string): Record<string, unknown> {
    expect(blob.readUInt32LE(0)).toBe(BYTECODE_MAGIC);
    const len = blob.readUInt32LE(4);
    const tagLength = blob.readUInt16LE(8);
    const cachedData = blob.subarray(10 + tagLength);
    const dummy = "\"" + "​".repeat(Math.max(0, len - 2)) + "\"";
    const script = new vm.Script(dummy, { filename, cachedData });
    expect(script.cachedDataRejected).toBe(false);
    const mod = { exports: {} as Record<string, unknown> };
    script.runInThisContext()(mod.exports, createRequire(filename), mod, filename, path.dirname(filename));
    return mod.exports;
}

/**
 * Compile and load an image under `flags`, force V8 to flush the loaded module's bytecode, and call
 * a function that has not run since. Returns what that call returned, or throws what it threw.
 *
 * It runs in a child Node because forcing a flush needs `--expose-gc`, and that flag is itself part
 * of the cache's flags hash - compiling here and loading there would be rejected before reaching the
 * behaviour under test. Both halves therefore happen in the child, mirroring what the compiler and
 * the bootstrap do rather than calling them.
 */
function probeFlushed(flags: string): string {
    const body = "module.exports.idle = function idle() { return 'ran'; };";
    const probe = [
        "const vm = require('vm'), v8 = require('v8');",
        `const flags = ${JSON.stringify(flags)};`,
        `const wrapped = ${JSON.stringify("(function (exports, require, module, __filename, __dirname) { ")} + ${JSON.stringify(body)} + ${JSON.stringify("\n});")};`,
        "v8.setFlagsFromString(flags);",
        "const cachedData = new vm.Script(wrapped, { produceCachedData: true }).cachedData;",
        "v8.setFlagsFromString(flags);",
        // A backslash-escaped \u200b, so what crosses the command line stays ASCII.
        "const dummy = '\\\"' + '\\u200b'.repeat(wrapped.length - 2) + '\\\"';",
        "const script = new vm.Script(dummy, { filename: 'main.js', cachedData });",
        "if (script.cachedDataRejected) throw new Error('image rejected before the probe could run');",
        "const mod = { exports: {} };",
        "script.runInThisContext()(mod.exports, require, mod, 'main.js', '.');",
        "v8.setFlagsFromString('--stress-flush-code');",
        "for (let i = 0; i < 5; i++) global.gc();",
        "process.stdout.write(mod.exports.idle());",
    ].join("\n");
    return execFileSync(process.execPath, ["--expose-gc", "-e", probe], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

describe("main process bytecode", () => {
    it("compiles a module whose code runs with its exports intact", () => {
        const blob = compileMainToBytecode(SAMPLE_SOURCE);
        const exports = loadImage(blob, path.join(process.cwd(), "main.js"));
        expect(exports.marker).toBe("runs");
        expect((exports.doublePlus as (n: number) => number)(21)).toBe(43); // 21*2 + 1
    });

    it("stamps the image with the engine that built it", () => {
        const blob = compileMainToBytecode(SAMPLE_SOURCE);
        const tagLength = blob.readUInt16LE(8);
        expect(blob.toString("utf8", 10, 10 + tagLength)).toBe(bytecodeEngineTag());
        expect(bytecodeEngineTag()).toContain(`v8-${process.versions.v8}`);
    });

    it("refuses a corrupted image rather than running it", () => {
        const blob = compileMainToBytecode(SAMPLE_SOURCE);
        blob.writeUInt32LE(0xdeadbeef, 0); // wrong magic
        expect(() => loadImage(blob, "main.js")).toThrow();
    });

    it("computes the same engine tag in the loader as the compiler stamps into the image", () => {
        // Drift here ships a game that refuses its own bytecode: the compiler stamps one tag, the
        // loader demands another, and V8 never gets a chance to run. Pin them to the same value by
        // evaluating the loader's own tag expression against this process.
        const bootstrap = renderMainBytecodeBootstrap();
        const match = bootstrap.match(/const want=([^;]+);/);
        expect(match).not.toBeNull();
        // eslint-disable-next-line no-eval
        const loaderTag = eval(match![1]) as string;
        expect(loaderTag).toBe(bytecodeEngineTag());
        // And the tag distinguishes architecture, or a cross-arch image would pass the tag check
        // and then be rejected by V8 with no stated reason.
        expect(bytecodeEngineTag()).toContain(`-${process.platform}-${process.arch}`);
    });

    it("keeps running after V8 discards an idle function's bytecode", () => {
        // V8 throws away the bytecode of functions nobody has called for a while and recompiles them
        // from source next time. An image has no source - the loader hands V8 a placeholder of the
        // right length made of zero-width spaces - so a flush turns the next call into a syntax error
        // against a line of invisible characters, minutes into a player's session. `probeFlushed`
        // compiles an image, loads it the way the bootstrap does, forces the flush, and calls in.
        expect(probeFlushed(BYTECODE_V8_FLAGS)).toBe("ran");
        // ...and the probe has teeth: without the flag that keeps the bytecode, the same call dies
        // exactly the way a shipped game did.
        expect(() => probeFlushed("--no-lazy")).toThrow(/Invalid or unexpected token/);
    });

    it("hands the game a loader that names no guard and loads the image beside it", () => {
        const bootstrap = renderMainBytecodeBootstrap();
        // Sets the same V8 flags the image was compiled under, or the cache is rejected.
        expect(bootstrap).toContain(`setFlagsFromString(${JSON.stringify(BYTECODE_V8_FLAGS)})`);
        // Reads the image by name and checks the engine tag before running anything.
        expect(bootstrap).toContain(MAIN_BYTECODE_FILENAME);
        expect(bootstrap).toContain("cachedDataRejected");
        expect(bootstrap).toContain("createRequire");
        // Says nothing about the guard it is loading - no switch names, no refusal wording.
        for (const beacon of ["remote-debugging", "disable-gpu", "refusing to start", "allowlist"]) {
            expect(bootstrap).not.toContain(beacon);
        }
    });
});

describe("guard mask table re-key", () => {
    // A stand-in for the blob the runtime module ships inside main.js, built here so the test does
    // not depend on the committed constant's exact bytes.
    const table = {
        seed: 91,
        step: 31,
        allowed: ["disable-gpu", "use-logs"],
        debugging: ["remote-debugging-port"],
        logs: "use-logs",
        refusalPrefix: "refusing to start: this build does not accept ",
    };

    it("re-keys the blob in place, changing the shipped bytes but not the decoded table", () => {
        const blob = buildGuardMaskTable(table);
        const source = `a();const guard=${JSON.stringify(blob)};b();`;
        const reseeded = reseedGuardMaskTable(source);
        const newBlob = reseeded.match(/NLMT:[A-Za-z0-9_-]+/)?.[0] ?? "";
        const decoded = parseGuardMaskTable(newBlob);
        // The names and text are preserved exactly, while the key changed (that is the point).
        expect(decoded.allowed).toEqual(table.allowed);
        expect(decoded.debugging).toEqual(table.debugging);
        expect(decoded.logs).toBe(table.logs);
        expect(decoded.refusalPrefix).toBe(table.refusalPrefix);
        // ...and still carries no plaintext name a search could match (deterministic byte-difference
        // under a changed key is pinned in runtimeStartupArguments.test.ts).
        for (const name of ["disable-gpu", "remote-debugging-port", "refusing to start"]) {
            expect(newBlob).not.toContain(name);
        }
        // The rest of the source is untouched.
        expect(reseeded.startsWith("a();const guard=")).toBe(true);
        expect(reseeded.endsWith("b();")).toBe(true);
    });

    it("leaves a source with no guard table untouched", () => {
        expect(reseedGuardMaskTable("nothing to see here")).toBe("nothing to see here");
    });
});
