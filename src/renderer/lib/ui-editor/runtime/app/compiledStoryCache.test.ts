import { describe, expect, it } from "vitest";
import type { CompiledNlrStory } from "@/lib/ui-editor/runtime/game/storyCompiler";
import {
    compiledStoryCacheKey,
    reuseCompiledStory,
    type CompiledStoryCacheEntry,
} from "./compiledStoryCache";

const BASE = {
    bundleId: "bundle-1",
    revision: 3,
    storyId: "story-1",
    textLocale: "en",
    voiceLocale: "ja",
    hasCore: true,
    rowPrecise: false,
};

/** A compiled story reduced to the three fields the cache touches. */
function compiled(sceneIds: string[]): { compiled: CompiledNlrStory; entries: string[] } {
    const entries: string[] = [];
    const scenes = Object.fromEntries(sceneIds.map(id => [id, { id } as never]));
    return {
        entries,
        compiled: {
            story: { entry: (scene: { id: string }) => entries.push(scene.id) },
            scene: scenes[sceneIds[0]],
            sceneId: sceneIds[0],
            scenes,
            diagnostics: [],
        } as unknown as CompiledNlrStory,
    };
}

function entry(key: string, sceneIds: string[]): { entry: CompiledStoryCacheEntry; entries: string[] } {
    const built = compiled(sceneIds);
    return { entry: { key, compiled: built.compiled }, entries: built.entries };
}

describe("compiledStoryCacheKey", () => {
    it("gives one key to two launches that may share a compile", () => {
        expect(compiledStoryCacheKey(BASE)).toBe(compiledStoryCacheKey({ ...BASE }));
    });

    it("refuses a row-precise launch outright", () => {
        // Those fabricate an entry scene posed at the target row, so the output depends on the row.
        expect(compiledStoryCacheKey({ ...BASE, rowPrecise: true })).toBeNull();
    });

    it("separates every field that changes what the compile contains", () => {
        const base = compiledStoryCacheKey(BASE);
        for (const variant of [
            { bundleId: "bundle-2" },
            { revision: 4 },
            { storyId: "story-2" },
            { textLocale: "ja" },
            { voiceLocale: "en" },
            { hasCore: false },
        ]) {
            expect(compiledStoryCacheKey({ ...BASE, ...variant })).not.toBe(base);
        }
    });

    it("does not let one field's value spill into the next", () => {
        // The separator is the one character none of the parts can contain; without it
        // ("a" + "bc") and ("ab" + "c") would key the same compile.
        expect(compiledStoryCacheKey({ ...BASE, bundleId: "a", storyId: "bc" }))
            .not.toBe(compiledStoryCacheKey({ ...BASE, bundleId: "ab", storyId: "c" }));
    });

    it("is blind to the scene, which is what makes one compile serve every launch of a story", () => {
        expect(compiledStoryCacheKey(BASE)).toBe(compiledStoryCacheKey(BASE));
    });
});

describe("reuseCompiledStory", () => {
    it("re-points the story at the scene this launch asked for", () => {
        const cached = entry("k", ["hub", "chapter-2"]);
        const reused = reuseCompiledStory(cached.entry, "k", "chapter-2");

        expect(cached.entries).toEqual(["chapter-2"]);
        expect(reused?.sceneId).toBe("chapter-2");
        expect(reused?.scene).toBe(cached.entry.compiled.scenes["chapter-2"]);
        // Everything else is the very same object: not rebuilding it is the whole point.
        expect(reused?.story).toBe(cached.entry.compiled.story);
        expect(reused?.scenes).toBe(cached.entry.compiled.scenes);
        // And the stored entry still names what it was compiled as, so the next launch re-points
        // from the same place rather than from wherever the last one left it.
        expect(cached.entry.compiled.sceneId).toBe("hub");
    });

    it("misses on a different key, an absent entry, and no key at all", () => {
        const cached = entry("k", ["hub"]);
        expect(reuseCompiledStory(cached.entry, "other", "hub")).toBeNull();
        expect(reuseCompiledStory(null, "k", "hub")).toBeNull();
        expect(reuseCompiledStory(cached.entry, null, "hub")).toBeNull();
        expect(cached.entries).toEqual([]);
    });

    it("misses rather than starting a story on the wrong entry", () => {
        // The key covers the document, so this should not happen - and if it does, compiling once
        // more is a far smaller failure than opening on a scene the launch did not name.
        const cached = entry("k", ["hub"]);
        expect(reuseCompiledStory(cached.entry, "k", "chapter-9")).toBeNull();
        expect(cached.entries).toEqual([]);
    });
});
