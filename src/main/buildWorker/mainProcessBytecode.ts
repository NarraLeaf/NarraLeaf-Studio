/**
 * Shipping a game's main process as V8 bytecode instead of readable JavaScript.
 *
 * `main.js` is one of the two files Electron opens itself, before any of the runtime's own code
 * exists, so it cannot be sealed into the store the way the renderer is - it stays a loose file a
 * player can open. What it *carries* is the launch guard: the check that refuses a debugger port on
 * a shipped game (`@shared/utils/runtimeStartupArguments`). As plain JavaScript that guard is one
 * text edit from gone. Compiled to bytecode it is not readable and not edited in place - defeating
 * it means reversing V8 bytecode or intercepting the small loader below, both of which cost more
 * than deleting a line.
 *
 * This is a cost, not a boundary, and it is removable like everything that runs on the player's
 * machine: the loader here is plain JavaScript (Electron's entry point has to be), so a determined
 * player can still stub the guard's effects around it. It removes the cheapest route - reading the
 * switch list and deleting the check - which is the same thing the switch masking and the argv
 * allowlist each do at their own layer.
 *
 * The bytecode is tied to the exact V8 the game runs under. Studio and the game it builds bundle the
 * same Electron, so the two match; an embedded engine tag turns any mismatch into a clear diagnostic
 * in the game's log rather than a crash with no cause. Comments in English per project convention.
 */

import crypto from "crypto";
import vm from "vm";
import v8 from "v8";
import { buildGuardMaskTable, GUARD_MASK_TABLE_PREFIX, parseGuardMaskTable } from "@shared/utils/runtimeStartupArguments";

/** The compiled main image, written beside the loader as this name. */
export const MAIN_BYTECODE_FILENAME = "main.jsc";

/**
 * Re-key the launch guard's masked table in a built main.js, per game.
 *
 * The allowlist and the refusal line ship masked (see `runtimeStartupArguments`), but with a fixed
 * key every game's tokens are byte-identical, so a token recovered from one game is a search string
 * for the same switch across every other. Re-keying with a fresh `(seed, step)` here breaks that:
 * each shipped game carries different bytes for the same names, and the bytecode compiled from this
 * source differs too. The table ships behind a distinctive prefix precisely so it can be found and
 * replaced without parsing the bundle; a build with no guard table (nothing matches) is returned
 * unchanged.
 */
export function reseedGuardMaskTable(mainJsSource: string): string {
    const match = mainJsSource.match(new RegExp(`${GUARD_MASK_TABLE_PREFIX}[A-Za-z0-9_-]+`));
    if (!match) {
        return mainJsSource;
    }
    const table = parseGuardMaskTable(match[0]);
    // A fresh key per game; `step` stays non-zero so the mask advances along the string.
    const reseeded = buildGuardMaskTable({ ...table, seed: crypto.randomInt(0, 256), step: crypto.randomInt(1, 256) });
    return mainJsSource.replace(match[0], reseeded);
}

/** Marks the blob so the loader can tell a bytecode image from anything else it might be handed. */
const BYTECODE_MAGIC = 0x4e4c4243; // "NLBC"

/**
 * Node's CommonJS module wrapper, written out rather than taken from `Module.wrap` (deprecated, and
 * a dependency both sides would have to agree on byte for byte). Only the compile side wraps: the
 * cached data carries the compiled wrapper function, and the loader runs that function directly.
 */
const WRAP_PREFIX = "(function (exports, require, module, __filename, __dirname) { ";
const WRAP_SUFFIX = "\n});";

/**
 * The tag that says which engine produced a bytecode image.
 *
 * V8's own cache check already refuses data from a different version or a different CPU architecture,
 * but it does so as an opaque rejection - and the version strings alone do not distinguish an arm64
 * image from an x64 one, so a cross-architecture mismatch would otherwise pass a version check and
 * then fail V8's silently. Platform and architecture are in the tag so the loader can name exactly
 * what it was built for. The caller must still only ship an image to the architecture that produced
 * it (a cache is not portable across architectures); the tag is the diagnostic, not the guard.
 */
export function bytecodeEngineTag(): string {
    return `electron-${process.versions.electron}-v8-${process.versions.v8}-${process.platform}-${process.arch}`;
}

/**
 * Compile a bundled main.js into a bytecode image.
 *
 * `--no-lazy` is set first and is load-bearing twice over: it forces V8 to compile every nested
 * function into the cache now, because no source ships to compile them from later; and it is part of
 * the flags hash V8 stamps into the cache, so the loader must set the same flag or the cache is
 * rejected. The loader below does.
 *
 * Runs wherever the pack is compiled - the build worker (a utility process) for a shipped build.
 * Verified that a utility process and the game's main process produce compatible caches under this
 * flag.
 */
export function compileMainToBytecode(mainJsSource: string): Buffer {
    v8.setFlagsFromString("--no-lazy");
    const wrapped = WRAP_PREFIX + mainJsSource + WRAP_SUFFIX;
    const script = new vm.Script(wrapped, { produceCachedData: true });
    if (!script.cachedData || script.cachedData.length === 0) {
        throw new Error("V8 produced no cached data for the main process bytecode");
    }
    const tag = Buffer.from(bytecodeEngineTag(), "utf8");
    const header = Buffer.alloc(10);
    header.writeUInt32LE(BYTECODE_MAGIC, 0);
    // A JS string length (UTF-16 code units), which is what V8's cache sanity check compares the
    // loader's placeholder source against.
    header.writeUInt32LE(wrapped.length, 4);
    header.writeUInt16LE(tag.length, 8);
    return Buffer.concat([header, tag, script.cachedData]);
}

/**
 * The plain-JavaScript entry point shipped as `main.js` in place of the real one.
 *
 * Electron compiles the app's `main` from source, so this file cannot itself be bytecode - it is the
 * irreducible readable part. It is kept small and says nothing about the guard it is loading. It
 * sets the same V8 flag the image was compiled under, reads the image beside it, checks the engine
 * tag for a clear failure, and runs the image as the main module - handing it the same `__dirname`
 * the real main.js reads to find everything else in the app directory.
 */
export function renderMainBytecodeBootstrap(): string {
    // Assembled as a string because it ships as source. Kept deliberately terse.
    return [
        `"use strict";`,
        `require("v8").setFlagsFromString("--no-lazy");`,
        `const fs=require("fs"),vm=require("vm"),path=require("path"),{createRequire}=require("module");`,
        `const here=__dirname,file=path.join(here,"main.js"),blob=fs.readFileSync(path.join(here,${JSON.stringify(MAIN_BYTECODE_FILENAME)}));`,
        `if(blob.readUInt32LE(0)!==${BYTECODE_MAGIC})throw new Error("main image unreadable");`,
        `const len=blob.readUInt32LE(4),tl=blob.readUInt16LE(8),tag=blob.toString("utf8",10,10+tl);`,
        // Must match bytecodeEngineTag() exactly, architecture and platform included.
        `const want="electron-"+process.versions.electron+"-v8-"+process.versions.v8+"-"+process.platform+"-"+process.arch;`,
        `if(tag!==want)throw new Error("main image built for "+tag+", running "+want);`,
        `const script=new vm.Script('"'+"\\u200b".repeat(Math.max(0,len-2))+'"',{filename:file,cachedData:blob.subarray(10+tl)});`,
        `if(script.cachedDataRejected)throw new Error("main image rejected by this engine");`,
        `const mod={exports:{}};`,
        `script.runInThisContext()(mod.exports,createRequire(file),mod,file,here);`,
        ``,
    ].join("\n");
}
