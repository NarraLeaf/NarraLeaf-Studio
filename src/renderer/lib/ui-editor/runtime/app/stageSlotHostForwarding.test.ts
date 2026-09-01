/**
 * Every surface of a game gets its host API from the one builder, and that builder binds every
 * option it owns.
 *
 * ## What this used to be, and why it is not that any more
 *
 * A slot surface (the dialogue box, the choice list, notifications, NVL, the on-stage layer) used
 * to build its **own** blueprint host API, from a hand-written forwarding block in
 * `StageSlotSurfaceShell` that restated the same hundred keys the two hosts in `GameApp` did. Every
 * callback left off that block was a node answering with the bridge's default - `false`,
 * `{found:false}`, an empty list - without throwing and without a diagnostic. An author saw a
 * control that never lit up and had nothing to read.
 *
 * That hole was found five separate times: sound, then progress, then the saved variables, then a
 * batch of twenty-five including the visited record, the endings family, the whole layer family and
 * voice replay, then the dub languages - `voiceConfig`, a plain data field, whose absence made
 * `voice.listLocales()` answer empty and every voice node raise "This project has no voice
 * languages configured", an error blaming the author's project for a field a host had not passed.
 *
 * This file used to compare the two call sites' key sets as source text, which is what you do when
 * there is no single construction site to check. There is one now: `gameHostApiOptions` holds
 * `GameHostCapabilities` - derived from the bridge's own options type, with every key mandatory to
 * write - and `buildGameHostApiOptions` is the only thing that turns it into bridge options. A key
 * dropped from a host, or an option added to the bridge and answered for by only one host, is a
 * compile error now, not a dead node. There is nothing left for a key-set comparison to find.
 *
 * ## What is left for a test
 *
 * Two seams that the compiler still cannot hold, and both of them are how a sixth recurrence would
 * get in:
 *
 *  1. **A host built some other way.** The guarantee is only that the *builder* is complete.
 *     Anyone adding a fourth surface can hand-write an options literal for it instead, and be
 *     exactly where the slot shell was. So: every game host is built through the builder.
 *  2. **The builder quietly stopping.** Nearly every option it binds is optional on the bridge, so
 *     `buildGameHostApiOptions` could stop setting `onIsGameOverlay`, `initialWidgetPatches` or
 *     `onStartStory` and still compile - and each of those is a capability going quiet on every
 *     surface at once. So: it binds every key it declares as its own.
 *  3. **A narrowing applied to the wrong layer.** One surface does legitimately answer a
 *     capability for itself: a choice menu binds `Select Choice` and `Get Choice Count` to *its*
 *     menu rather than to the newest one on the stage. Written beside the capabilities instead of
 *     inside them it is silently dropped - the object still type-checks, because the spread has
 *     already satisfied the type - and every menu goes back to answering for whichever was drawn
 *     last. That happened while this file was being written and nothing saw it. So: the narrowing
 *     is inside the capabilities.
 *
 * Comments in English per project convention.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HERE = path.resolve(__dirname);
const BUILDER = path.join(HERE, "gameHostApiOptions.ts");

const CALL = "createDevModeBlueprintHostApi(";
const BUILDER_CALL = "buildGameHostApiOptions(";

/**
 * The files that build a host API for a running game.
 *
 * Named rather than globbed, so a new one is a deliberate addition to this list by someone who has
 * read why the list exists - and so the count below can be non-vacuous.
 */
const GAME_HOST_FILES: Readonly<Record<string, string>> = {
    "the page and nested-frame hosts": path.join(HERE, "GameApp.tsx"),
    "the Game UI slot host": path.join(HERE, "StageSlotSurfaceShell.tsx"),
};

/** Everything after `createDevModeBlueprintHostApi(`, up to the newline, at each call. */
function hostApiCallHeads(source: string): string[] {
    const heads: string[] = [];
    for (let from = 0; ;) {
        const start = source.indexOf(CALL, from);
        if (start < 0) {
            return heads;
        }
        const rest = start + CALL.length;
        const end = source.indexOf("\n", rest);
        heads.push(source.slice(rest, end < 0 ? source.length : end).trim());
        from = rest;
    }
}

/**
 * The quoted names in `type SurfaceBoundOptionKey = BridgeOptionKey< … >`.
 *
 * Read from the builder's own source rather than repeated here, so the check cannot fall behind the
 * declaration it is checking: a key added to that union is a key this test starts requiring on the
 * same edit.
 */
function surfaceBoundOptionKeys(builderSource: string): string[] {
    const start = builderSource.indexOf("type SurfaceBoundOptionKey = BridgeOptionKey<");
    if (start < 0) {
        throw new Error("SurfaceBoundOptionKey is not declared where this test expects it");
    }
    const end = builderSource.indexOf(">;", start);
    return [...builderSource.slice(start, end).matchAll(/"(\w+)"/g)].map(match => match[1]!);
}

/**
 * The object literal `buildGameHostApiOptions` returns, brace-matched.
 *
 * The literal rather than the whole function body: the body also destructures the binding -
 * `const { runtimeScopeId, ... } = binding` - and a name read there would answer for a key the
 * returned object no longer sets, which is precisely the failure being looked for.
 */
function builderReturnedOptions(builderSource: string): string {
    const start = builderSource.indexOf("export function buildGameHostApiOptions(");
    if (start < 0) {
        throw new Error("buildGameHostApiOptions is not declared where this test expects it");
    }
    let depth = 0;
    for (let index = builderSource.indexOf("return {", start); index < builderSource.length; index += 1) {
        if (builderSource[index] === "{") {
            depth += 1;
        } else if (builderSource[index] === "}") {
            depth -= 1;
            if (depth === 0) {
                return builderSource.slice(start, index + 1);
            }
        }
    }
    throw new Error("buildGameHostApiOptions returns nothing this test can read");
}

describe("every surface of a game gets the whole game host", () => {
    const builder = fs.readFileSync(BUILDER, "utf8");

    it("builds every game host through the one builder", () => {
        // The seam the type system cannot hold. `GameHostCapabilities` guarantees that whoever
        // fills one in has answered for every capability - it guarantees nothing about a host that
        // never asks for one. A hand-written options literal type-checks perfectly and is exactly
        // the shape of the five defects above.
        const wrong: string[] = [];
        let calls = 0;
        for (const [what, file] of Object.entries(GAME_HOST_FILES)) {
            for (const head of hostApiCallHeads(fs.readFileSync(file, "utf8"))) {
                calls += 1;
                if (!head.startsWith(BUILDER_CALL)) {
                    wrong.push(`${what} (${path.basename(file)}): createDevModeBlueprintHostApi(${head}`);
                }
            }
        }

        // Non-vacuous: a rename that stopped the scan matching would otherwise pass with nothing
        // examined. Three hosts - a page, a page inside an `nl.frame`, and a Game UI slot.
        expect(calls, "no host API construction found at all").toBe(3);
        expect(
            wrong,
            "these build a game host from a hand-written options object rather than from the "
            + "game's capabilities, which is how a capability reaches some surfaces of a game and "
            + "not others - in silence, and sometimes with an error that reads as the author's "
            + "project being misconfigured. Build it with buildGameHostApiOptions.\n"
            + wrong.join("\n"),
        ).toEqual([]);
    });

    it("binds every option the builder declares as the surface's own", () => {
        // The other seam. These are the options that are deliberately *not* in the capabilities -
        // the runtime a drawing runs in, which surface it is, the plumbing back to its own adapter,
        // and the one capability the three hosts reach differently. The builder sets them all
        // unconditionally, which is what makes them impossible to forget; nearly all of them are
        // optional on the bridge, so it could stop and still compile.
        const declared = surfaceBoundOptionKeys(builder);
        const options = builderReturnedOptions(builder);

        expect(declared.length, "SurfaceBoundOptionKey names nothing").toBeGreaterThan(8);
        // `[:,]` because a key whose value is a binding of the same name is written shorthand.
        const unbound = declared.filter(key => !new RegExp(`\\b${key}\\s*[:,]`).test(options));
        expect(
            unbound,
            "buildGameHostApiOptions declares these as its own and never sets them, so they reach "
            + "no surface of any game at all:\n" + unbound.join("\n"),
        ).toEqual([]);
    });
    it("narrows a capability inside the capabilities, where a host will read it", () => {
        // The choice surface is the one place a surface answers a capability differently from the
        // game it belongs to, and it has to: a graph running inside a menu means *that* menu, and
        // the host API is built per runtime scope, which is per menu. The registry-wide answers
        // `GameApp` supplies are for the callers outside every menu - the skip loop, Dev Mode's
        // test controls.
        //
        // Spelled beside the capabilities rather than inside them it compiles and does nothing:
        // the spread has already satisfied the type, so the extra keys are never read, and every
        // menu silently answers for whichever menu was drawn last. Nothing catches that - not the
        // type, and not a test, because rendering this surface needs a running engine around it.
        // It happened while this file was being written, which is why it is checked as text.
        const source = fs.readFileSync(path.join(HERE, "ChoiceSlotSurface.tsx"), "utf8");
        const from = source.indexOf("const scopedOptions");
        expect(from, "the choice surface no longer scopes anything to its own menu").toBeGreaterThan(0);
        const scoped = source.slice(from, source.indexOf("const runtime =", from));

        expect(scoped, "the narrowing is not applied to the game's capabilities").toContain("...options.host,");
        for (const option of ["onGetChoiceCount:", "onSelectChoice:"]) {
            expect(
                scoped.includes(option),
                `${option} is not narrowed inside the game's capabilities, so a graph running in `
                + "one choice menu addresses whichever menu was drawn last",
            ).toBe(true);
        }
    });
});
