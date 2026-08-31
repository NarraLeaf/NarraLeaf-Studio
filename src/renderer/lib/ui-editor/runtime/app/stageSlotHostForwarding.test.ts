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
 * That hole has now been found four separate times: sound, then progress, then the saved variables,
 * then a batch of twenty-five including the visited record, the endings family, the whole layer
 * family and voice replay. Each time the fix was to add the missing names, and each time the guard
 * added with it was another hand-written list - which is exactly why there was a next time.
 *
 * So this test does not name any callback. It reads the two call sites and compares them, which
 * means a capability added to the page path and forgotten on the slot path fails here on the day it
 * is added, named, with nothing to remember to update.
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

/** The `onX:` keys an options object hands the bridge. */
function callbackKeys(site: string): Set<string> {
    return new Set(site.match(/\bon[A-Z][A-Za-z0-9]*(?=\s*:)/g) ?? []);
}

/**
 * Callbacks a top-level surface legitimately does not carry.
 *
 * One entry so far, and it earns its place: `onFrameEmit` dispatches a page event back to the
 * `nl.frame` element that is hosting the surface, so it exists only in the nested-surface host and
 * cannot be built without a frame to emit to. Anything added here needs that shape of reason - not
 * "the slot does not need it yet".
 */
const NOT_A_TOP_LEVEL_SURFACE_CONCERN = new Set(["onFrameEmit"]);

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
        expect(callbackKeys(appSites[0]!).size).toBeGreaterThan(60);
        expect(callbackKeys(shellSites[0]!).size).toBeGreaterThan(60);
    });

    it("hands a slot every callback a page surface gets", () => {
        // The first site is `createHostAdapterBundle` - the host a top-level page surface gets, and
        // the standard a slot surface is held to.
        const page = callbackKeys(appSites[0]!);
        const slot = callbackKeys(shellSites[0]!);

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
        // The second site is the frame host. It may carry more, never less: a callback that existed
        // only there would be one no ordinary surface could reach.
        const page = callbackKeys(appSites[0]!);
        const frame = callbackKeys(appSites[1]!);
        expect([...page].filter(key => !frame.has(key)).sort()).toEqual([]);
    });
});
