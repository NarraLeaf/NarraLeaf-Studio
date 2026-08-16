/**
 * What a patch does to the saves players already have.
 *
 * A save does not record "chapter two, line nine". It records the ids the compiler stamped on the
 * action it stopped at and on the elements whose state it was holding, and it finds its way back by
 * looking those ids up. So the question a patch has to answer is not "did the story change" - a
 * patch exists to change it - but "did any id a save could be holding stop existing".
 *
 * ## Two answers, because there are two failure modes and they look nothing alike
 *
 * **An action id that is gone refuses the load.** Pre-resolution walks the save's anchors and stops
 * on the first one the compiled story cannot answer, and the player is told their save cannot be
 * opened. Loud, immediate, and the player's progress is still there once the patch is removed.
 *
 * **An element id that is gone is not noticed at all.** Pre-resolution only asks whether an id
 * exists; nothing checks that the thing behind it is still the same thing. So the state a save was
 * holding for that element - where it was, whether it was shown - is quietly applied to nothing, and
 * the game plays on with a stage that is subtly not the one the player left. Silent, and it survives
 * every check the runtime has.
 *
 * Both are reported, never as one number. An author who is told "12 anchors changed" cannot tell
 * whether that means twelve players see an error message or twelve players see a wrong scene.
 *
 * ## Why this runs the compiler rather than reading the documents
 *
 * The ids are the compiler's own output - a row's index within its block, an element's name under
 * its scene - and a reader that derived them from the document would be a second implementation of
 * the naming rules. It would agree with the compiler right up until one of them changed, and the
 * failure it would then hide is invisible by construction. So both sides of the comparison come from
 * the same compiler the shipped game runs, over the two packs being compared.
 */

import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import type { StoryDocument } from "@shared/types/story";
import { listScenesInDocumentOrder } from "@shared/types/story";

/** Every anchor one build offers, and enough naming to say where a lost one used to be. */
export type SaveAnchorSet = {
    actions: string[];
    elements: string[];
    /** Studio scene id -> "Story / Scene", so a loss names a place rather than a uuid. */
    sceneNames: Record<string, string>;
    /** Stories the compiler could not read. Their anchors are unknown, not absent - see the diff. */
    storyErrors: { story: string; message: string }[];
};

export type SaveAnchorLoss = {
    anchor: string;
    /** "Story / Scene", or the raw scene id when the build no longer names it. */
    where: string;
};

export type SaveAnchorDiff = {
    /**
     * Anchors whose loss stops a save from opening at all. The player is told; nothing is corrupted.
     */
    refusesToLoad: SaveAnchorLoss[];
    /**
     * Anchors whose loss is invisible: the save opens and the state it held for these is dropped on
     * the floor. Fewer of these is not better than fewer of the other kind - they are worse per
     * anchor, because nobody finds out.
     */
    loadsWithHazard: SaveAnchorLoss[];
    /**
     * True when either build had a story the compiler could not read, so its anchors were never
     * counted. A clean diff over a partial read is not a clean diff, and saying so is the only
     * honest way to report one.
     */
    incomplete: boolean;
};

/**
 * Compile every story in a pack and collect the ids it stamps.
 *
 * One compile per story enumerates that story whole - the compiler visits every scene whatever scene
 * it is told to start at - so this walks the shipped content exactly once. A story that will not
 * compile is recorded rather than thrown: the other stories still have an answer worth having, and a
 * comparison that silently dropped one would report its every anchor as lost.
 */
export async function collectSaveAnchors(pack: GameRuntimePackV1): Promise<SaveAnchorSet> {
    const actions = new Set<string>();
    const elements = new Set<string>();
    const sceneNames: Record<string, string> = {};
    const storyErrors: { story: string; message: string }[] = [];
    const library = pack.bundle?.storyLibrary;

    for (const [storyId, document] of Object.entries(library?.documents ?? {})) {
        const storyName = library?.index?.stories?.find(story => story.id === storyId)?.name ?? storyId;
        for (const scene of listScenesInDocumentOrder(document)) {
            sceneNames[scene.id] = `${storyName} / ${scene.name || scene.id}`;
        }
        const startSceneId = pickEntryScene(document);
        if (!startSceneId) {
            continue;
        }
        try {
            const compiled = await compileStudioStoryToNlr({
                document,
                sceneId: startSceneId,
                characters: library?.characters,
                animations: library?.animations,
                blueprintDocument: pack.bundle.ui.localBlueprints,
                persistentVariables: pack.bundle.ui.persistentVariables,
                savedVariables: pack.bundle.ui.savedVariables,
                localization: pack.bundle.localization,
                voice: pack.bundle.voice,
                audioClips: pack.bundle.audio?.clips,
                audioTracks: pack.bundle.audio?.tracks,
                // A URL for anything asked for. What is being counted is ids, and a compile that
                // stopped on a missing asset would report every anchor after it as lost.
                resolveAssetUrl: (assetId: string) => "anchor://" + String(assetId ?? "").trim(),
            } as Parameters<typeof compileStudioStoryToNlr>[0]);
            for (const binding of compiled.actionIdBindings) {
                actions.add(binding.staticId);
            }
            for (const elementId of compiled.elementIdBindings) {
                elements.add(elementId);
            }
        } catch (error) {
            storyErrors.push({
                story: storyName,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return {
        actions: [...actions],
        elements: [...elements],
        sceneNames,
        storyErrors,
    };
}

/**
 * What the new build no longer answers for.
 *
 * Only losses. An anchor the new build added is not a change any existing save can notice, and
 * reporting additions would bury the two lists that matter under the ordinary business of a patch
 * adding content.
 */
export function diffSaveAnchors(before: SaveAnchorSet, after: SaveAnchorSet): SaveAnchorDiff {
    const stillThere = {
        actions: new Set(after.actions),
        elements: new Set(after.elements),
    };
    const locate = (anchor: string): string => {
        const sceneId = sceneIdOf(anchor);
        return (sceneId && (before.sceneNames[sceneId] ?? after.sceneNames[sceneId])) || sceneId || anchor;
    };
    return {
        refusesToLoad: before.actions
            .filter(anchor => !stillThere.actions.has(anchor))
            .map(anchor => ({ anchor, where: locate(anchor) })),
        loadsWithHazard: before.elements
            .filter(anchor => !stillThere.elements.has(anchor))
            .map(anchor => ({ anchor, where: locate(anchor) })),
        incomplete: before.storyErrors.length > 0 || after.storyErrors.length > 0,
    };
}

/**
 * The scene an anchor belongs to, for naming it.
 *
 * Both shapes carry it in a known position - `studio:<story>:<scene>:…` for an action and
 * `nl:<kind>:<scene>:…` for an element - and the handful of element ids that name no scene (the
 * narrator, a character) simply get no location, which reads better than a wrong one.
 */
function sceneIdOf(anchor: string): string | null {
    const parts = anchor.split(":");
    if (parts[0] === "studio" && parts.length >= 3) {
        return parts[2];
    }
    if (parts[0] === "nl" && parts[1] === "scene" && parts.length >= 3) {
        return parts[2];
    }
    if (parts[0] === "nl" && parts.length >= 4 && parts[1] !== "character") {
        return parts[2];
    }
    return null;
}

/** The scene the collection compiles from; any scene enumerates the document, so it only has to exist. */
function pickEntryScene(document: StoryDocument): string | null {
    const entry = document.entrySceneId;
    if (entry && document.scenes?.[entry]) {
        return entry;
    }
    return listScenesInDocumentOrder(document)[0]?.id ?? null;
}
