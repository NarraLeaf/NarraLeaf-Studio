import type { BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_GAME_START_STORY } from "@shared/types/blueprint/graph";
import type { DevModeBundle } from "@shared/types/devMode";
import type { StoryDocument, StoryId, StorySceneId } from "@shared/types/story";
import { listSceneIdsInDocumentOrder } from "@shared/types/story";

export type DefaultLaunchScene = {
    storyId: StoryId;
    sceneId: StorySceneId;
};

function resolveSceneId(document: StoryDocument): StorySceneId | undefined {
    if (document.entrySceneId && document.scenes[document.entrySceneId]) {
        return document.entrySceneId;
    }
    // Which scene the game boots into when no entry scene is set — so this fallback has to be the
    // author's first scene, not whichever scene id sorts lowest once the record is rewritten.
    return listSceneIdsInDocumentOrder(document)[0];
}

/**
 * Resolve the story/scene that should be preloaded when the NarraLeaf React
 * environment is initialised at game boot. Returns the configured default story's
 * entry scene, or `null` when no usable default story/scene is available (the
 * caller then boots an empty NLR environment).
 */
export function resolveDefaultLaunchScene(bundle: DevModeBundle): DefaultLaunchScene | null {
    const library = bundle.storyLibrary;
    if (!library) {
        return null;
    }
    const defaultStoryId = library.index.defaultStoryId;
    const document = defaultStoryId ? library.documents[defaultStoryId] : undefined;
    if (!document) {
        return null;
    }
    const sceneId = resolveSceneId(document);
    if (!sceneId) {
        return null;
    }
    return { storyId: document.id, sceneId };
}

function* eachGraph(blueprints: BlueprintDocument | undefined): Generator<BlueprintGraphIr> {
    for (const blueprint of Object.values(blueprints?.blueprints ?? {})) {
        if (blueprint.program.kind !== "graph") {
            continue;
        }
        const { events, functions, macros } = blueprint.program.graphs;
        for (const holder of [
            ...Object.values(events ?? {}),
            ...Object.values(functions ?? {}),
            ...Object.values(macros ?? {}),
        ]) {
            if (holder.graph) {
                yield holder.graph;
            }
        }
    }
}

/**
 * Every distinct story/scene a "Start Game" node in the project would launch, deduped.
 */
function collectStartGameTargets(blueprints: BlueprintDocument | undefined): DefaultLaunchScene[] {
    const targets = new Map<string, DefaultLaunchScene>();
    for (const graph of eachGraph(blueprints)) {
        for (const node of Object.values(graph.nodes ?? {})) {
            if (node.type !== BLUEPRINT_NODE_TYPE_GAME_START_STORY) {
                continue;
            }
            const storyId = String(node.params?.storyId ?? "").trim();
            const sceneId = String(node.params?.sceneId ?? "").trim();
            if (!storyId || !sceneId) {
                continue;
            }
            targets.set(`${storyId}::${sceneId}`, { storyId, sceneId });
        }
    }
    return Array.from(targets.values());
}

/**
 * The story/scene whose assets should be fetched and decoded during boot, while the loading step
 * is still on screen.
 *
 * Preloading is only worth anything if it warms the scene the player is about to see, and a mounted
 * environment for the *wrong* scene is worse than useless: Start Game then has to recompile and
 * remount, paying the full cost after the click. So when the project's "Start Game" nodes all agree
 * on one target, that is what gets warmed. Anything ambiguous — several different targets, none at
 * all, or one naming a story/scene this bundle does not have — falls back to the default story's
 * entry scene, which is also what a bundle without a UI would launch.
 */
export function resolveStagePreloadTarget(bundle: DevModeBundle): DefaultLaunchScene | null {
    const fallback = resolveDefaultLaunchScene(bundle);
    const targets = collectStartGameTargets(bundle.ui?.localBlueprints);
    if (targets.length !== 1) {
        return fallback;
    }
    const [target] = targets;
    const documents = bundle.storyLibrary?.documents ?? {};
    const document = documents[target.storyId]
        ?? Object.values(documents).find(entry => entry.id === target.storyId);
    if (!document?.scenes[target.sceneId]) {
        return fallback;
    }
    return target;
}
