/**
 * "Have I already compiled this story?" — the policy, apart from the component that holds the slot.
 *
 * ## Why a compiled story is worth keeping
 *
 * A compile walks the WHOLE document: every scene, every row, every asset reference. `sceneId`
 * decides only which scene the story opens on, because that is all the compiler does with it -
 * `Story.entry(scene)` at the end. So a hub-shaped game, where a page launches a scene and the scene
 * hands the screen back to the page, rebuilt the entire story on every hop. MEASURED, on a
 * 10,000-line script with 30,000 takes: 450-600ms of pure compute per launch, before any of the
 * mounting and painting that follows.
 *
 * ## Why re-pointing the entry is sound rather than a shortcut
 *
 * `Story.entry(scene)` is a plain assignment, and everything that depends on it happens afterwards:
 * `LiveGame.loadStory` runs `constructStory()`, which builds the scene roots and assigns action and
 * element ids by walking from whatever the entry is at that moment, then runs the static check and
 * captures the element baseline. A reused story re-pointed at another scene is therefore stamped
 * exactly as a fresh compile of that scene would have stamped it.
 *
 * `newGame()` then clears the storable, re-seeds every persistent the story declares, and resets
 * every element reachable from the entry - a superset of what the run can reach, since a scene the
 * run cannot walk to is a scene it cannot show.
 *
 * ## What must never be reused
 *
 * A row-precise launch (`startBlockId` / `snapshotId`) fabricates a synthetic entry scene posed at
 * the target row, so its output depends on the row rather than on the document alone. Those get no
 * key at all and always compile fresh.
 *
 * Comments in English per project convention.
 */

import type { CompiledNlrStory } from "@/lib/ui-editor/runtime/game/storyCompiler";

export type CompiledStoryCacheEntry = {
    key: string;
    compiled: CompiledNlrStory;
};

export type CompiledStoryCacheKeyInput = {
    /** The bundle this compile was built from - its id and revision cover the document itself. */
    bundleId: string;
    /** The bundle revision, as the host counts it. */
    revision: number;
    storyId: string;
    /**
     * The text and dub languages in force.
     *
     * Both are partly baked into the compile - a scene's own background resolves through the text
     * locale, and the take table installed on each scene is the voice one - so two languages are two
     * different compiles rather than one that can be re-pointed.
     */
    textLocale: string;
    voiceLocale: string;
    /**
     * Whether the compile had a runtime core to close over.
     *
     * The statements read persistent variables through its scope bridge, so a compile made without
     * one is not the same artefact as a compile made with one.
     */
    hasCore: boolean;
    /** A row-precise launch. See the note above: these are never reusable. */
    rowPrecise: boolean;
};

/**
 * The one character none of the key's parts can contain.
 *
 * A scene id, a locale tag and a bundle id are all author- or platform-supplied, so any printable
 * separator is one a field could legitimately contain - and a separator a field can contain is a key
 * that can collide.
 */
const SEPARATOR = "\u0000";

/**
 * The key two compiles must share for one to stand in for the other, or null when this one may not
 * be reused at all.
 */
export function compiledStoryCacheKey(input: CompiledStoryCacheKeyInput): string | null {
    if (input.rowPrecise) {
        return null;
    }
    return [
        input.bundleId,
        String(input.revision),
        input.storyId,
        input.textLocale,
        input.voiceLocale,
        input.hasCore ? "core" : "no-core",
    ].join(SEPARATOR);
}

/**
 * The cached compile, re-pointed at `sceneId`, or null when there is nothing to reuse.
 *
 * Returns a shallow copy rather than the stored object so the caller's `scene` and `sceneId` name
 * the entry this launch asked for, while the story, the scenes and every binding stay shared - the
 * whole point being to not rebuild them.
 *
 * A key that matches a compile which does not contain the scene is treated as a miss. That should
 * not happen - the key covers the document - but starting a story on the wrong entry is a far worse
 * failure than compiling one more time.
 */
export function reuseCompiledStory(
    entry: CompiledStoryCacheEntry | null,
    key: string | null,
    sceneId: string,
): CompiledNlrStory | null {
    if (!key || !entry || entry.key !== key) {
        return null;
    }
    const scene = entry.compiled.scenes[sceneId];
    if (!scene) {
        return null;
    }
    // Set here, before the player mounts: `constructStory()` reads it on `loadStory`.
    entry.compiled.story.entry(scene);
    return { ...entry.compiled, scene, sceneId };
}
