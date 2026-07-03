import type { DevModeBundle } from "@shared/types/devMode";
import type { StoryDocument, StoryId, StorySceneId } from "@shared/types/story";

export type DefaultLaunchScene = {
    storyId: StoryId;
    sceneId: StorySceneId;
};

function firstSceneId(document: StoryDocument): StorySceneId | undefined {
    for (const chapter of document.chapters) {
        if (chapter.sceneIds[0]) {
            return chapter.sceneIds[0];
        }
    }
    return Object.keys(document.scenes)[0];
}

function resolveSceneId(document: StoryDocument): StorySceneId | undefined {
    if (document.entrySceneId && document.scenes[document.entrySceneId]) {
        return document.entrySceneId;
    }
    return firstSceneId(document);
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
