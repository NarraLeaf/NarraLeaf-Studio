/**
 * The scope bridge has two setters one word apart, and only one of them reaches the store.
 *
 * `persistenceSet` updates an in-memory map and notifies subscribers. `persistenceSetAsync` does
 * that *and* hands the value to the host store. A value written through the first reads back
 * perfectly for the life of the window and is gone the moment it closes — so nothing asserted
 * within a session can tell the two apart, and neither can the type checker.
 *
 * That has now shipped three separate times:
 *
 *  - story-written persistent variables, invisible to every blueprint (fixed at the story
 *    compiler's persistence bridge, whose comment is the reason this pattern has a name here);
 *  - the playtime total, which never survived a relaunch;
 *  - the read-text record, which meant skip-read-text skipped nothing and every "has the player
 *    heard this line" answered no, on every playthrough after the first.
 *
 * Each was found by hand, twice by driving the real app. So this enumerates every call site
 * instead: a bare `persistenceSet` has to be paired with the durable write, or be named below with
 * a reason it is deliberately session-only. The allowlist is checked for staleness too, because an
 * exemption nobody revalidates is how the fourth one gets in.
 */

import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";

const RENDERER_SRC = path.resolve(__dirname, "../../../..");

/** Files that call the bridge's setters. Kept explicit: a glob would quietly stop covering a new one. */
const CALLERS = [
    "apps/dev-mode/components/StoryRuntimeDebugPanel.tsx",
    "apps/workspace/modules/story/scene-editor/preview/useStoryPreviewGameUi.ts",
    "lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge.ts",
    "lib/ui-editor/runtime/app/GameApp.tsx",
    "lib/ui-editor/runtime/plugins/runtimePluginStoryState.ts",
];

/**
 * Writes that are session-only on purpose, keyed `file::firstArgument`.
 *
 * Both halves of the key earn their place. Without the file, a generic argument name excuses every
 * site that happens to use it — the first draft keyed on the argument alone, `key` was on the list
 * for the story preview, and it silently excused the read-text write this whole file exists for.
 * Without the argument, a file inherits one excuse for every write it ever grows.
 */
const SESSION_ONLY: Readonly<Record<string, string>> = {
    "lib/ui-editor/runtime/app/GameApp.tsx::LOCALE_STORAGE_KEY":
        "the system-locale match, re-derived from navigator on every boot; an explicit choice goes "
        + "through the Set Language node, which writes durably",
    "apps/dev-mode/components/StoryRuntimeDebugPanel.tsx::variable.storageKey":
        "the Story Runtime debug panel poking a value into a running game, which is an instrument "
        + "rather than an edit the project should keep",
    "apps/workspace/modules/story/scene-editor/preview/useStoryPreviewGameUi.ts::key":
        "the in-editor story preview, which has no host store behind it at all",
    "lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge.ts::key":
        "the `state.set` persistence branch, which no caller reaches: every caller passes surface "
        + "or global, and the durable path is `persistence.set` right below it",
    "lib/ui-editor/runtime/plugins/runtimePluginStoryState.ts::def.storageKey":
        "REPORTED, NOT EXCUSED: a plugin writing a persistent story variable. Same shape as the "
        + "story-compiler bug already fixed, but nothing in the repo exercises it, so it is listed "
        + "here to be decided rather than changed blind",
    "lib/ui-editor/runtime/app/GameApp.tsx::refKey.slice(\"persistent:\".length)":
        "REPORTED, NOT EXCUSED: Scene Snapshot launch overrides. Writing them durably would leak a "
        + "preview launch into the author's real store, so the fix is a decision, not a rename",
};

/**
 * Every bare `persistenceSet` **on the bridge itself**, with the text that follows it.
 *
 * The receiver matters: a hook that takes a `persistenceSet` callback as an option calls it by that
 * name too, and whether *that* one is durable is decided where the option is wired, not where it is
 * invoked. Matching on the method name alone flags the abstraction boundary instead of the defect.
 */
function bareWrites(source: string): Array<{ arg: string; tail: string }> {
    const out: Array<{ arg: string; tail: string }> = [];
    const pattern = /(?:scopeBridge|scope|persistence)\??\.persistenceSet\((?!Async)/g;
    for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
        const from = match.index + match[0].length;
        const argument = source.slice(from, source.indexOf(",", from)).trim();
        // Enough to see a paired durable write in the same statement or the next one, and not so
        // much that an unrelated call further down the file launders this one.
        out.push({ arg: argument, tail: source.slice(match.index, match.index + 260) });
    }
    return out;
}

describe("persistence durability", () => {
    it("pairs every in-memory write with the durable one, or names why not", async () => {
        const unpaired: string[] = [];
        for (const file of CALLERS) {
            const source = await fs.readFile(path.join(RENDERER_SRC, file), "utf-8");
            for (const write of bareWrites(source)) {
                if (write.tail.includes("persistenceSetAsync")) {
                    continue;
                }
                if (SESSION_ONLY[`${file}::${write.arg}`]) {
                    continue;
                }
                unpaired.push(`${file}: persistenceSet(${write.arg}) never reaches the store`);
            }
        }
        expect(
            unpaired,
            `these writes are lost when the window closes:\n${unpaired.join("\n")}`,
        ).toEqual([]);
    });

    it("is non-vacuous: it can see the writes it is checking", async () => {
        const seen: string[] = [];
        for (const file of CALLERS) {
            const source = await fs.readFile(path.join(RENDERER_SRC, file), "utf-8");
            seen.push(...bareWrites(source).map(write => write.arg));
        }
        // If the bridge is ever renamed, this drops to zero and the test above passes vacuously.
        expect(seen.length, "no persistenceSet calls found — has the bridge been renamed?")
            .toBeGreaterThan(4);
    });

    it("keeps the session-only list honest", async () => {
        const live = new Set<string>();
        for (const file of CALLERS) {
            const source = await fs.readFile(path.join(RENDERER_SRC, file), "utf-8");
            for (const write of bareWrites(source)) {
                live.add(`${file}::${write.arg}`);
            }
        }
        const stale = Object.keys(SESSION_ONLY).filter(argument => !live.has(argument));
        expect(stale, `these entries no longer name a write:\n${stale.join("\n")}`).toEqual([]);
    });

    it("keeps the read-text record durable, which is the only reason it is persisted", async () => {
        // Named on its own because within a session the tracker answers from its own Set: a
        // session-only write here is indistinguishable from working until the player relaunches,
        // which is exactly how it shipped.
        const source = await fs.readFile(
            path.join(RENDERER_SRC, "lib/ui-editor/runtime/app/GameApp.tsx"),
            "utf-8",
        );
        const wiring = source.slice(source.indexOf("createTextReadTracker({"));
        const tracker = wiring.slice(0, wiring.indexOf("});") + 3);
        expect(tracker, "the text-read tracker is not wired where this test expects")
            .toContain("persistenceGetAsync");
        expect(
            tracker.includes("persistenceSetAsync"),
            "the read-text record must be written durably; it is useless within a single session",
        ).toBe(true);
    });
});
