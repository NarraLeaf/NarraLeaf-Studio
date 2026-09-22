import type { StoryDocument, StoryScene } from "./document";

/**
 * A scene's internal name: what the engine is told the scene is called.
 *
 * The engine keys a scene's own variables by it - `Scene.local` lives in the storable namespace
 * `local:<name>`, and that is the namespace a save file writes them under - so two scenes answering
 * to one name share one set of scene variables, and whichever is entered last wipes the other's.
 *
 * The expression is the compiler's, in one place so that everything asking "which namespace is this
 * scene's" gets the engine's answer: the stored `runtimeName`, else the display name as it stands,
 * else the id. A document written before `runtimeName` was filled in everywhere still compiles under
 * the second, which is why a scene with an empty one is not nameless.
 */
export function sceneRuntimeName(scene: Pick<StoryScene, "id" | "name" | "runtimeName">): string {
    return scene.runtimeName || scene.name || scene.id;
}

/**
 * The part of a display name an internal name can be made from: lower case ASCII letters and digits,
 * everything else folded into single underscores. Empty for a name with no ASCII in it at all - a
 * Chinese or Japanese title - which is the case {@link mintSceneRuntimeName} hands to its fallback.
 */
export function sceneRuntimeNameStem(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

/**
 * `candidate`, or the first of `candidate_2`, `candidate_3`, ... that nothing has taken.
 *
 * A suffix rather than a random tail, so the file stays readable to somebody looking at a save or a
 * story document by hand: the second "Chapter 1" is `chapter_1_2`.
 */
export function uniqueSceneRuntimeName(candidate: string, isTaken: (name: string) => boolean): string {
    if (!isTaken(candidate)) {
        return candidate;
    }
    for (let n = 2; ; n += 1) {
        const next = `${candidate}_${n}`;
        if (!isTaken(next)) {
            return next;
        }
    }
}

/**
 * Every internal name a document's scenes answer to, optionally leaving one scene out.
 *
 * Computed through {@link sceneRuntimeName}, so a scene stored with an empty `runtimeName` holds the
 * name it actually compiles under rather than nothing.
 */
export function takenSceneRuntimeNames(
    document: Pick<StoryDocument, "scenes">,
    exceptSceneId?: string,
): Set<string> {
    const taken = new Set<string>();
    for (const scene of Object.values(document.scenes ?? {})) {
        if (scene && scene.id !== exceptSceneId) {
            taken.add(sceneRuntimeName(scene));
        }
    }
    return taken;
}

/**
 * The internal name for a scene being made now, unique within its story.
 *
 * **The only time an internal name is chosen.** It is kept through every rename after this, because
 * changing it would move the scene's variables to a namespace no existing save has: a save made in
 * that scene would load and then fail on its first read of a scene variable (`Namespace local:… is
 * not initialized`). So uniqueness has to be settled here, against every scene the story already
 * holds - settling it later would mean renaming one that exists.
 *
 * Unique per story because a story is what the engine runs: each one compiles into its own `Story`
 * with its own storable, and a save belongs to one of them.
 *
 * `fallback` answers a name {@link sceneRuntimeNameStem} can make nothing of. The caller mints it
 * (a generated id), so it is already unique and is not checked again.
 */
export function mintSceneRuntimeName(
    name: string,
    document: Pick<StoryDocument, "scenes">,
    fallback: () => string,
): string {
    const stem = sceneRuntimeNameStem(name);
    if (!stem) {
        return fallback();
    }
    const taken = takenSceneRuntimeNames(document);
    return uniqueSceneRuntimeName(stem, candidate => taken.has(candidate));
}
