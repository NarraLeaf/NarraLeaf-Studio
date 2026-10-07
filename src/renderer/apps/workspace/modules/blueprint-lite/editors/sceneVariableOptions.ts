/**
 * The choices a `Get Scene Var` / `Set Scene Var` card offers.
 *
 * A scene variable exists only in its scene, and a story blueprint runs in the scene whose row names
 * it (`scenesNamingBlueprint`): that is where the compiler takes the variable table from. So the card
 * lists exactly those variables. A blueprint named from more than one scene - its row was copied -
 * lists the variables of each, labelled "<scene> / <variable>" as the scene's other pickers label a
 * row that only its scene tells apart; a variable picked there is found only while that scene runs.
 * One named by no scene lists nothing, since nothing runs it.
 *
 * Comments in English per project convention.
 */

import type { StoryDocument, StoryId } from "@shared/types/story/document";
import { sceneVariableDefs } from "@shared/types/story/declarations";
import type { BlueprintInspectorParamSelectOption } from "@/lib/ui-editor/blueprint-nodes/types";
import { scenesNamingBlueprint } from "@/lib/story/sceneBlueprintRefs";

export function buildSceneVariableOptions(
    stories: readonly { id: StoryId; document: StoryDocument | undefined }[],
    blueprintId: string,
    untitledScene: string,
): BlueprintInspectorParamSelectOption[] {
    const scenes = scenesNamingBlueprint(stories, blueprintId);
    const qualify = scenes.length > 1;
    const options: BlueprintInspectorParamSelectOption[] = [];
    for (const { scene } of scenes) {
        const sceneLabel = scene.name || scene.runtimeName || untitledScene;
        for (const variable of Object.values(sceneVariableDefs(scene))) {
            options.push({
                value: variable.id,
                label: qualify ? `${sceneLabel} / ${variable.name}` : variable.name,
            });
        }
    }
    return options;
}
