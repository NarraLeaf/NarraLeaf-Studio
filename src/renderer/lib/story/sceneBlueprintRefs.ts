/**
 * Which blueprints a scene's rows name.
 *
 * A story blueprint has no scene in its identity (`BlueprintOwnerRef`'s `storyAction` arm): it runs in
 * whichever scene holds the row that names it, and the compiler hands it that scene's variables. So
 * every question of the form "which scene does this blueprint belong to" is answered by walking the
 * rows, here, once.
 *
 * Comments in English per project convention.
 */

import type { StoryDocument, StoryId, StoryScene } from "@shared/types/story/document";
import { listSceneIdsInDocumentOrder } from "@shared/types/story/order";

/**
 * Every blueprint id the rows of `scene` name.
 *
 * A row names a blueprint in four shapes - an action, an inline value, a condition and an expression
 * call - and all four spell it `blueprintId`, so one walk over the scene finds them all, including a
 * shape added later that keeps the spelling.
 */
export function blueprintIdsNamedByScene(scene: StoryScene): Set<string> {
    const found = new Set<string>();
    const visit = (value: unknown): void => {
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        if (!value || typeof value !== "object") {
            return;
        }
        for (const [key, child] of Object.entries(value)) {
            if (key === "blueprintId" && typeof child === "string") {
                found.add(child);
            } else {
                visit(child);
            }
        }
    };
    visit(scene);
    return found;
}

/** A scene, with the story it belongs to. */
export type StorySceneRef = { storyId: StoryId; scene: StoryScene };

/**
 * The scenes whose rows name `blueprintId`, in story order and then in the author's scene order.
 *
 * Usually one: Studio makes a story blueprint for the row it is created from. More than one when rows
 * naming it were copied into other scenes, and none when the row that named it is gone.
 */
export function scenesNamingBlueprint(
    stories: readonly { id: StoryId; document: StoryDocument | undefined }[],
    blueprintId: string,
): StorySceneRef[] {
    const out: StorySceneRef[] = [];
    for (const story of stories) {
        const document = story.document;
        if (!document) {
            continue;
        }
        for (const sceneId of listSceneIdsInDocumentOrder(document)) {
            const scene = document.scenes[sceneId];
            if (scene && blueprintIdsNamedByScene(scene).has(blueprintId)) {
                out.push({ storyId: story.id, scene });
            }
        }
    }
    return out;
}
