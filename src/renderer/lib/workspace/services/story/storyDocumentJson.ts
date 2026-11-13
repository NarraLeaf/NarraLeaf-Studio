import type { StoryDocument, StoryId, StoryScene, StorySceneId } from "@shared/types/story/document";

/**
 * A story document's file text, byte for byte what `JSON.stringify(document, null, 2)` writes, with
 * the scenes nobody touched since the last save taken from a cache instead of serialised again.
 *
 * ## Why
 *
 * One story holds every scene, so a one-word edit used to re-serialise the whole script on the
 * renderer's own thread: about 14 MB of pretty-printed JSON for 300 scenes, measured at 70-130 ms
 * in one piece, at least every 5 seconds of continuous typing (the auto-saver's max wait). The
 * scene being typed in is a few kilobytes of that.
 *
 * ## What keeps it honest
 *
 *  - **The output is the old output.** Each scene is serialised inside a wrapper that puts it at the
 *    depth it has in the file, so its indentation is the indentation `JSON.stringify` would give it,
 *    and the pieces are joined with the separators `JSON.stringify` uses. The tests compare the two
 *    on real documents. Nothing about the file on disk, its diffs or its merges changes.
 *  - **A cached scene is only ever used for the same object.** An entry remembers the scene it was
 *    taken from; a document re-read from disk, restored or replaced has new scene objects and misses.
 *  - **Invalidation is the mutation's job, and the default is everything.** `StoryService`
 *    invalidates on every `mutateDocument`; only the row operations, whose reach is one named scene,
 *    narrow that to the scenes they name. A path nobody narrowed costs a full serialise, never a
 *    stale file.
 *  - **A mostly cold cache is not used.** Serialising scene by scene costs more than one call when
 *    nothing is cached, so below half warm the save takes the plain path and the cache is filled
 *    later, in idle time, by {@link warm}.
 */
export class StoryDocumentJsonCache {
    private readonly stories = new Map<StoryId, Map<StorySceneId, CachedScene>>();

    /** Forget the named scenes of a story, or the whole story when no scenes are named. */
    public invalidate(storyId: StoryId, sceneIds?: readonly StorySceneId[]): void {
        if (!sceneIds) {
            this.stories.delete(storyId);
            return;
        }
        const scenes = this.stories.get(storyId);
        if (!scenes) {
            return;
        }
        for (const sceneId of sceneIds) {
            scenes.delete(sceneId);
        }
    }

    public clear(): void {
        this.stories.clear();
    }

    public serialize(storyId: StoryId, document: StoryDocument): string {
        const scenes = sceneRecord(document);
        const cached = this.stories.get(storyId);
        if (!scenes || !cached) {
            return JSON.stringify(document, null, 2);
        }
        const ids = Object.keys(scenes);
        let warm = 0;
        for (const id of ids) {
            if (cached.get(id)?.scene === scenes[id]) {
                warm += 1;
            }
        }
        if (warm * 2 < ids.length) {
            return JSON.stringify(document, null, 2);
        }
        return composeStoryDocumentJson(document, (id, scene) => this.sceneEntry(storyId, id, scene));
    }

    /**
     * Fill the cache for a story a few scenes at a time, while `hasTime` says there is time.
     * Returns true once every scene is cached.
     */
    public warm(storyId: StoryId, document: StoryDocument, hasTime: () => boolean): boolean {
        const scenes = sceneRecord(document);
        if (!scenes) {
            return true;
        }
        for (const id of Object.keys(scenes)) {
            const scene = scenes[id];
            if (this.stories.get(storyId)?.get(id)?.scene === scene) {
                continue;
            }
            if (!hasTime()) {
                return false;
            }
            this.sceneEntry(storyId, id, scene);
        }
        return true;
    }

    private sceneEntry(storyId: StoryId, id: string, scene: StoryScene): string | null {
        let scenes = this.stories.get(storyId);
        const hit = scenes?.get(id);
        if (hit && hit.scene === scene) {
            return hit.json;
        }
        const json = sceneEntryJson(id, scene);
        if (json !== null) {
            if (!scenes) {
                scenes = new Map();
                this.stories.set(storyId, scenes);
            }
            scenes.set(id, { scene, json });
        }
        return json;
    }
}

type CachedScene = { scene: StoryScene; json: string };

/** `document.scenes` when it is a plain record, the only shape the composed path handles. */
function sceneRecord(document: StoryDocument): Record<string, StoryScene> | null {
    const scenes = document.scenes as unknown;
    if (!scenes || typeof scenes !== "object" || Array.isArray(scenes)
        || typeof (scenes as { toJSON?: unknown }).toJSON === "function") {
        return null;
    }
    return scenes as Record<string, StoryScene>;
}

// Depth 2 is where a scene's key sits in the file: `{ "scenes": { "<id>": ... } }`.
const SCENE_WRAPPER_HEAD = "{\n  \"s\": {\n    ";
const SCENE_WRAPPER_TAIL = "\n  }\n}";

/**
 * `"<id>": { ... }` exactly as it appears inside the file, or null for a value `JSON.stringify`
 * leaves out (undefined, a function).
 */
export function sceneEntryJson(id: string, scene: unknown): string | null {
    const wrapped = JSON.stringify({ s: { [id]: scene } }, null, 2);
    if (wrapped.length <= SCENE_WRAPPER_HEAD.length + SCENE_WRAPPER_TAIL.length) {
        return null;
    }
    return wrapped.slice(SCENE_WRAPPER_HEAD.length, wrapped.length - SCENE_WRAPPER_TAIL.length);
}

/**
 * The document's file text with each scene's entry supplied by `sceneEntry`. Every other top-level
 * field is serialised on the spot: they are small, and `meta.updatedAt` changes on every edit.
 */
export function composeStoryDocumentJson(
    document: StoryDocument,
    sceneEntry: (id: string, scene: StoryScene) => string | null,
): string {
    const scenes = sceneRecord(document);
    if (!scenes || typeof (document as { toJSON?: unknown }).toJSON === "function") {
        return JSON.stringify(document, null, 2);
    }
    const fields: string[] = [];
    for (const key of Object.keys(document)) {
        const value = (document as Record<string, unknown>)[key];
        if (key === "scenes") {
            const entries: string[] = [];
            for (const id of Object.keys(scenes)) {
                const entry = sceneEntry(id, scenes[id]);
                if (entry !== null) {
                    entries.push(entry);
                }
            }
            fields.push(entries.length === 0
                ? "\"scenes\": {}"
                : `"scenes": {\n    ${entries.join(",\n    ")}\n  }`);
            continue;
        }
        // `{ "<key>": value }` at depth 1, less its braces.
        const wrapped = JSON.stringify({ [key]: value }, null, 2);
        if (wrapped === "{}") {
            continue;
        }
        fields.push(wrapped.slice(4, wrapped.length - 2));
    }
    return fields.length === 0 ? "{}" : `{\n  ${fields.join(",\n  ")}\n}`;
}
