/**
 * Whether the session on the stage can receive a save of its own story, and where to enter that
 * story afresh when it cannot.
 *
 * A save finds its way back by looking up the ids the compiler stamped on what it was holding, and
 * the engine answers those lookups from the elements and actions it can reach from the story's entry
 * scene - nothing else. So whether a save loads depends on where the running session entered the
 * story, not only on which story it is:
 *
 * - A session started at a row enters through a scene built for that launch. The scene it was
 *   launched in is reachable only if the story jumps back to it, and every scene before it not at
 *   all, so a save written anywhere else was refused - even one written a minute earlier in the
 *   same scene.
 * - A session started at a scene reaches what that scene can jump to. A save from a scene before it
 *   was refused the same way.
 *
 * To an author testing their game, a save is a save however the session was started. When the
 * session on the stage cannot receive one, the story is mounted again, entered where everything the
 * save names is reachable - and never into a row launch's own compile, whose numbering a save written
 * anywhere else does not share.
 *
 * Reachability is read off the document's jump rows ({@link reachableSceneIds}), which are the only
 * edges the compiler turns into scene changes; it is the same walk a build uses to decide which
 * scenes ship.
 */

import { reachableSceneIds } from "@shared/story/storyReachability";
import { listSceneIdsInDocumentOrder, type StoryDocument } from "@shared/types/story";

export type SaveMountPlan =
    /** The session on the stage reaches everything the save names. */
    | { kind: "same" }
    /** Mount the story again, entered at this scene. */
    | { kind: "remount"; entrySceneId: string };

export function planSaveMount(input: {
    document: StoryDocument;
    /** What the session on the stage was started with. The caller has checked it is this story. */
    mounted: { sceneId: string; startBlockId?: string };
    /**
     * Where this story is normally entered - what the title screen's Start Game warms - or null when
     * there is no such scene. Tried first: a save written in ordinary play was written against it.
     */
    preferredEntrySceneId: string | null;
    /** The scene the save's position names. */
    saveSceneId: string;
    /** Every scene of this story the save's ids name; ids the document does not have are ignored. */
    sceneIds: readonly string[];
}): SaveMountPlan {
    const { document } = input;
    const needed = new Set(
        [...input.sceneIds, input.saveSceneId].filter(sceneId => Boolean(document.scenes?.[sceneId])),
    );
    const covers = (entrySceneId: string): boolean => {
        // The document's own entry mark is left out: what is being asked is what THIS scene reaches,
        // and a story entered elsewhere does not pass through the marked one.
        const reached = reachableSceneIds({ ...document, entrySceneId: undefined }, {
            entrySceneIds: [entrySceneId],
            fallback: "none",
        });
        for (const sceneId of needed) {
            if (!reached.has(sceneId)) {
                return false;
            }
        }
        return true;
    };

    const rowLaunch = Boolean(input.mounted.startBlockId);
    if (!rowLaunch && covers(input.mounted.sceneId)) {
        return { kind: "same" };
    }

    const candidates = [
        input.preferredEntrySceneId,
        input.saveSceneId,
        ...listSceneIdsInDocumentOrder(document).filter(sceneId => needed.has(sceneId)),
    ];
    for (const candidate of candidates) {
        if (candidate && document.scenes?.[candidate] && covers(candidate)) {
            return rowLaunch || candidate !== input.mounted.sceneId
                ? { kind: "remount", entrySceneId: candidate }
                : { kind: "same" };
        }
    }

    // Nowhere reaches all of it - a scene only a blueprint enters, or one cut from this build. A row
    // launch is still left for a plain mount at the save's own scene, which is the closest a save
    // written outside it can come; a plain session gains nothing by being replaced with another, and
    // the load's own check then says precisely what is missing.
    return rowLaunch && document.scenes?.[input.saveSceneId]
        ? { kind: "remount", entrySceneId: input.saveSceneId }
        : { kind: "same" };
}
