/**
 * A Game UI slot surface must be handed the same game host a page surface is.
 *
 * ## Why this is a source comparison and not a list
 *
 * A slot surface (the dialogue box, the choice list, notifications, NVL, the on-stage layer) builds
 * its **own** blueprint host API, from a hand-written forwarding block in `StageSlotSurfaceShell`.
 * Every callback left off that block is a node that answers with the bridge's default - `false`,
 * `{found:false}`, an empty list - without throwing and without a diagnostic. An author sees a
 * control that never lights up and has nothing to read.
 *
 * That hole has now been found five separate times: sound, then progress, then the saved variables,
 * then a batch of twenty-five including the visited record, the endings family, the whole layer
 * family and voice replay, then the dub languages. Each time the fix was to add the missing names,
 * and each time the guard added with it was another hand-written list - which is exactly why there
 * was a next time.
 *
 * So this test does not name any option. It reads the two call sites and compares them, which
 * means a capability added to the page path and forgotten on the slot path fails here on the day it
 * is added, named, with nothing to remember to update.
 *
 * ## Why the whole options object and not just the callbacks
 *
 * This test used to compare only keys matching `onX`, and the fifth hole walked straight through
 * that: `voiceConfig` is data rather than a callback, so the slot host reported the game as having
 * no dub languages while its `onPlayVoice` sat correctly wired one line away. A family can be
 * half-forwarded, and the half left behind is not always the callable one - so the comparison is
 * over every top-level key of the options object, callbacks and configuration alike.
 *
 * Comments in English per project convention.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP = path.resolve(__dirname, "GameApp.tsx");
const SHELL = path.resolve(__dirname, "StageSlotSurfaceShell.tsx");

const CALL = "createDevModeBlueprintHostApi(";

/**
 * Every `createDevModeBlueprintHostApi(...)` argument list in one file, brace-matched.
 *
 * Matched rather than windowed because a fixed slice is the classic way a source test starts
 * passing for the wrong reason: the block grows past the window and the keys past the cut simply
 * stop being compared.
 */
function hostApiCallSites(source: string): string[] {
    const sites: string[] = [];
    for (let from = 0; ;) {
        const start = source.indexOf(CALL, from);
        if (start < 0) {
            return sites;
        }
        let depth = 0;
        let i = start + CALL.length - 1;
        for (; i < source.length; i += 1) {
            const c = source[i];
            if (c === "(") {
                depth += 1;
            } else if (c === ")") {
                depth -= 1;
                if (depth === 0) {
                    i += 1;
                    break;
                }
            }
        }
        sites.push(source.slice(start, i));
        from = i;
    }
}

/**
 * The top-level keys of the options object a call site hands the bridge.
 *
 * Depth-tracked rather than pattern-matched. The two call sites sit at different nesting depths, so
 * indentation says nothing, and many of the values are themselves object literals or arrow-function
 * bodies whose own keys would otherwise be counted as options. Strings and comments are stepped
 * over for the same reason, and shorthand (`document,`) counts as a key, which is how the two files
 * spell several of the same options.
 */
function optionKeys(site: string): Set<string> {
    const open = site.indexOf("{");
    if (open < 0) {
        return new Set();
    }
    const keys = new Set<string>();
    let depth = 0;
    // True while the scanner stands where a key may begin: just inside the `{`, or after a `,`.
    let atKey = false;
    for (let i = open; i < site.length; i += 1) {
        const c = site[i]!;
        if (c === "/" && site[i + 1] === "/") {
            const newline = site.indexOf("\n", i);
            if (newline < 0) {
                break;
            }
            i = newline;
            continue;
        }
        if (c === "/" && site[i + 1] === "*") {
            const end = site.indexOf("*/", i + 2);
            i = end < 0 ? site.length : end + 1;
            continue;
        }
        if (c === "\"" || c === "'" || c === "`") {
            for (i += 1; i < site.length; i += 1) {
                if (site[i] === "\\") {
                    i += 1;
                    continue;
                }
                if (site[i] === c) {
                    break;
                }
            }
            continue;
        }
        if (c === "{" || c === "[" || c === "(") {
            depth += 1;
            atKey = depth === 1 && c === "{";
            continue;
        }
        if (c === "}" || c === "]" || c === ")") {
            depth -= 1;
            atKey = false;
            if (depth === 0) {
                break;
            }
            continue;
        }
        if (c === ",") {
            atKey = depth === 1;
            continue;
        }
        if (/\s/.test(c)) {
            continue;
        }
        if (atKey && /[A-Za-z_$]/.test(c)) {
            let end = i;
            while (end < site.length && /[A-Za-z0-9_$]/.test(site[end]!)) {
                end += 1;
            }
            keys.add(site.slice(i, end));
            i = end - 1;
        }
        atKey = false;
    }
    return keys;
}

/**
 * Options a top-level surface legitimately does not carry.
 *
 * Two entries, and they are the same reason twice: the nested-surface host exists inside an
 * `nl.frame` element, so it alone can dispatch a page event back to that element (`onFrameEmit`)
 * and read the params the frame was given (`frameParams`). Neither can be built without a frame.
 * Anything added here needs that shape of reason - not "the slot does not need it yet".
 */
const NOT_A_TOP_LEVEL_SURFACE_CONCERN = new Set(["onFrameEmit", "frameParams"]);

describe("stage slot surfaces get the whole game host", () => {
    const app = fs.readFileSync(APP, "utf8");
    const shell = fs.readFileSync(SHELL, "utf8");
    const appSites = hostApiCallSites(app);
    const shellSites = hostApiCallSites(shell);

    it("finds the call sites it is comparing", () => {
        // The guard against the whole file passing vacuously: a rename, a refactor into a helper or
        // a regex that stops matching would otherwise leave two empty sets that agree perfectly.
        expect(appSites.length, "GameApp should build a host API for a page and for a nested frame").toBe(2);
        expect(shellSites.length, "the slot shell should build exactly one host API").toBe(1);
        expect(optionKeys(appSites[0]!).size).toBeGreaterThan(60);
        expect(optionKeys(shellSites[0]!).size).toBeGreaterThan(60);
    });

    it("hands a slot every option a page surface gets", () => {
        // The first site is `createHostAdapterBundle` - the host a top-level page surface gets, and
        // the standard a slot surface is held to.
        const page = optionKeys(appSites[0]!);
        const slot = optionKeys(shellSites[0]!);

        const missing = [...page]
            .filter(key => !slot.has(key) && !NOT_A_TOP_LEVEL_SURFACE_CONCERN.has(key))
            .sort();

        expect(
            missing,
            "these reach the page surfaces and not the stage slots, so the nodes that use them "
            + "answer the bridge's default on a dialogue box, a choice list, a notification, an NVL "
            + "surface or an on-stage widget - silently. Forward them in StageSlotSurfaceShell.",
        ).toEqual([]);
    });

    it("keeps the nested-frame host a superset, so nothing hides in it", () => {
        // The second site is the frame host. It may carry more, never less: an option that existed
        // only there would be one no ordinary surface could reach.
        const page = optionKeys(appSites[0]!);
        const frame = optionKeys(appSites[1]!);
        expect([...page].filter(key => !frame.has(key)).sort()).toEqual([]);
    });
});
