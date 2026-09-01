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
 * family and voice replay, then the dub languages. Each of the first four fixes added the missing
 * names and a hand-written list to guard them - which is exactly why there was a next time.
 *
 * So this test does not name any option. It reads the two call sites and compares them, which
 * means a capability added to the page path and forgotten on the slot path fails here on the day it
 * is added, named, with nothing to remember to update.
 *
 * ## Why it compares every key and not just the callbacks
 *
 * The fifth recurrence happened with this test already in place, and the miss was here. The
 * comparison used to read only keys spelled `onSomething`, on the assumption that a host is a bag
 * of callbacks. It is not: `voiceConfig` - the list of languages the game is dubbed into - is a
 * plain data field, and so are `audioTracks`, `localizationConfig` and the patches a rebuilt scope
 * starts from. Every one of them was outside the comparison, and the one that went missing made
 * `voice.listLocales()` answer empty, which the voice nodes report as "This project has no voice
 * languages configured" - an error blaming the author's project, on every slot surface.
 *
 * A data field is dead in exactly the way a callback is, so the comparison is over every key the
 * options object names, whatever it is called.
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
 * Comments and string bodies blanked out, so prose can never be read as source.
 *
 * Needed because the keys are found positionally: a comment reading "seed theirs: a host API" ends
 * in an identifier followed by a colon, and would otherwise be counted as an option named `theirs`.
 */
function withoutCommentsAndStrings(source: string): string {
    let out = "";
    for (let i = 0; i < source.length;) {
        const pair = source.slice(i, i + 2);
        if (pair === "//") {
            while (i < source.length && source[i] !== "\n") {
                i += 1;
            }
            continue;
        }
        if (pair === "/*") {
            i += 2;
            while (i < source.length && source.slice(i, i + 2) !== "*/") {
                i += 1;
            }
            i += 2;
            out += " ";
            continue;
        }
        const char = source[i]!;
        if (char === "\"" || char === "'" || char === "`") {
            i += 1;
            while (i < source.length && source[i] !== char) {
                i += source[i] === "\\" ? 2 : 1;
            }
            i += 1;
            out += "\"\"";
            continue;
        }
        out += char;
        i += 1;
    }
    return out;
}

/**
 * Every key the options object literal names at its own top level: `onPlaySound`, and equally
 * `voiceConfig`, `audioTracks`, and the shorthand `widgetRuntimeStore`.
 *
 * Read positionally rather than by name pattern. An identifier is a key when it sits at brace depth
 * one with a `{` or a `,` behind it and a `:` in front - or, for a shorthand property, a `,` or the
 * closing `}`. That is the whole grammar of an object literal key and it does not care what the key
 * is called, which is the point: the fifth recurrence was a key whose name no pattern would have
 * guessed was worth comparing.
 */
function optionKeys(site: string): Set<string> {
    const source = withoutCommentsAndStrings(site);
    const keys = new Set<string>();
    let depth = 0;
    for (let i = source.indexOf("{"); i >= 0 && i < source.length; i += 1) {
        const char = source[i]!;
        if (char === "{" || char === "(" || char === "[") {
            depth += 1;
            continue;
        }
        if (char === "}" || char === ")" || char === "]") {
            depth -= 1;
            if (depth === 0) {
                break;
            }
            continue;
        }
        if (depth !== 1 || !/[A-Za-z_$]/.test(char)) {
            continue;
        }
        let before = i - 1;
        while (before >= 0 && /\s/.test(source[before]!)) {
            before -= 1;
        }
        let end = i;
        while (end < source.length && /[\w$]/.test(source[end]!)) {
            end += 1;
        }
        let after = end;
        while (after < source.length && /\s/.test(source[after]!)) {
            after += 1;
        }
        const opens = source[before] === "{" || source[before] === ",";
        const closes = source[after] === ":" || source[after] === "," || source[after] === "}";
        if (opens && closes) {
            keys.add(source.slice(i, end));
        }
        // Past the identifier either way, so a value token is never mistaken for the key after it.
        i = end - 1;
    }
    return keys;
}

/**
 * Options a top-level surface legitimately does not carry.
 *
 * Both entries are the nested-frame host's own: `onFrameEmit` dispatches a page event back to the
 * `nl.frame` element hosting the surface and `frameParams` is what that frame was opened with, so
 * neither can be built without a frame. They are named here rather than left out because the page
 * host is the standard the slot host is held to, and a reader should see why these two are not part
 * of it. Anything added here needs that shape of reason - not "the slot does not need it yet".
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
            + "surface or an on-stage widget - usually in silence, and when the default is an empty "
            + "list with an error that reads as the author's project being misconfigured. Forward "
            + "them in StageSlotSurfaceShell.",
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
