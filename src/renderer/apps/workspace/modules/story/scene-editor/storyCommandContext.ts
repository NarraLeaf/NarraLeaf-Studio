import type { StoryDocument, StoryLiteralValue, StoryScene, StorySceneId, StoryVariableValueType } from "@shared/types/story";
import { savedVariableDefs, sceneVariableDefs, storyPersistentDefs } from "@shared/types/story/declarations";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { collectTempSpeakers } from "@/lib/workspace/services/story/storyModel";
import type { Character } from "@/lib/workspace/services/character/Character";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { AssetsMap } from "@/lib/workspace/services/assets/types";
import { listSceneDisplayableTargets } from "../../story-motion/storyMotionPreviewTarget";
import type { StoryCommandContext, StoryCommandNamedRef, StoryCommandStageObjects, StoryCommandVariableEntry } from "./storyCommandResolution";

/**
 * Project a live project onto the flat, name-keyed view the command line resolves against.
 *
 * Pure so it can be tested without services, and separate from `storyCommandResolution` so that the
 * resolver never learns what a `Character` or an `AssetsMap` is. When the candidate list arrives it
 * reads this same context, which is what stops the two from disagreeing about what a name means.
 */

function assetRefs(assets: AssetsMap | undefined, type: AssetType): StoryCommandNamedRef[] {
    return Object.values(assets?.[type] ?? {}).map(asset => ({ id: asset.id, name: asset.name }));
}

/**
 * Variables the author may address by name, in scope-chain order: scene, then saved, then persistent.
 *
 * The order is load-bearing - it is what makes a bare `gold` in an expression resolve to the narrowest
 * declaration, with `saved.gold` as the escape hatch when a name is shadowed. See
 * `createStoryExpressionScope`, which sorts by the same rule.
 *
 * Persistent variables are declared in the *blueprint* document (keyed by `storageKey`, shared with UI
 * blueprints), which is why they arrive here as a separate input rather than off the story document.
 * They used to be missing entirely, so `/set` on a game-level flag reported "unknown variable"; they
 * are the whole point of having a persistent scope, so they belong in the list.
 */
function variableEntries(
    document: StoryDocument | null,
    scene: StoryScene | null,
    blueprintDocument: BlueprintDocument | null,
): StoryCommandVariableEntry[] {
    const entries: StoryCommandVariableEntry[] = [];
    // v6: the tables are scans over declaration rows - the row is the variable.
    for (const definition of Object.values(scene ? sceneVariableDefs(scene) : {})) {
        entries.push({
            name: definition.name,
            ref: { scope: "scene", variableId: definition.id },
            valueType: definition.valueType,
            defaultValue: definition.defaultValue,
        });
    }
    for (const definition of Object.values(document ? savedVariableDefs(document) : {})) {
        entries.push({
            name: definition.name,
            ref: { scope: "saved", variableId: definition.id },
            valueType: definition.valueType,
            defaultValue: definition.defaultValue,
        });
    }
    // Persistent variables declared as story rows, then the blueprint-declared ones - one scope,
    // two authoring surfaces until the project-level registry lands.
    for (const definition of Object.values(document ? storyPersistentDefs(document) : {})) {
        entries.push({
            name: definition.name,
            ref: { scope: "persistent", storageKey: definition.storageKey },
            valueType: definition.valueType,
            defaultValue: definition.defaultValue,
        });
    }
    for (const definition of Object.values(blueprintDocument?.persistentVariables ?? {})) {
        entries.push({
            name: definition.name,
            // Addressed by `storageKey`, not id: the key is what survives a rename, and what the
            // compiler hands the host persistence bridge.
            ref: { scope: "persistent", storageKey: definition.storageKey },
            // Blueprint variables carry a free-form `valueType`; anything outside the story system's
            // four types is treated as `json`, which type-checks as "assignable from anything" rather
            // than blocking the author over a distinction the story document cannot represent.
            valueType: asStoryValueType(definition.valueType),
            defaultValue: definition.defaultValue as StoryLiteralValue | undefined,
        });
    }
    return entries;
}

function asStoryValueType(valueType: string | undefined): StoryVariableValueType {
    return valueType === "boolean" || valueType === "number" || valueType === "string" ? valueType : "json";
}

/**
 * The named objects on stage in this scene, per kind - the picker `/imgshow`, `/settext`, `/stop`
 * lead with instead of a blind name field.
 *
 * image / text / layer come from {@link listSceneDisplayableTargets}, the same collector the
 * inspector's target picker reads, so the command line can never offer a name the inspector wouldn't.
 * video and sound handles are not displayable targets, so they are scanned directly off the scene's
 * action blocks. Scene-wide for now (`blockId` omitted): scoping the list to objects created *before*
 * the caret is the position-aware refinement, cheap to add once the slot's anchor is threaded here.
 */
function collectStageObjects(document: StoryDocument | null, sceneId: StorySceneId | null | undefined, scene: StoryScene | null): StoryCommandStageObjects {
    const image = new Set<string>();
    const text = new Set<string>();
    const layer = new Set<string>();
    const video = new Set<string>();
    const audio = new Set<string>();

    for (const ref of listSceneDisplayableTargets(document, sceneId ?? undefined, undefined)) {
        if (ref.kind === "image") {
            image.add(ref.name);
        } else if (ref.kind === "text") {
            text.add(ref.name);
        } else if (ref.kind === "layer") {
            layer.add(ref.name);
        }
    }
    for (const block of Object.values(scene?.blocks ?? {})) {
        if (block.kind !== "action") {
            continue;
        }
        if (block.payload.action === "video" && block.payload.objectName) {
            video.add(block.payload.objectName);
        } else if (block.payload.action === "audio" && block.payload.objectName) {
            audio.add(block.payload.objectName);
        }
    }
    return { image: [...image], text: [...text], layer: [...layer], video: [...video], audio: [...audio] };
}

export function buildStoryCommandContext(input: {
    assets: AssetsMap | undefined;
    characters: readonly Character[];
    document: StoryDocument | null;
    sceneId: StorySceneId | null | undefined;
    scene: StoryScene | null;
    /** Source of the persistent (game-level) variables; absent when the project has no blueprint document yet. */
    blueprintDocument?: BlueprintDocument | null;
}): StoryCommandContext {
    const formsByCharacterId: Record<string, string[]> = {};
    const characters: StoryCommandNamedRef[] = input.characters.map(character => {
        const id = character.profile.getId();
        formsByCharacterId[id] = character.profile.appearance.getForms().map(form => form.name);
        return { id, name: character.profile.getName() };
    });

    return {
        images: assetRefs(input.assets, AssetType.Image),
        audio: assetRefs(input.assets, AssetType.Audio),
        videos: assetRefs(input.assets, AssetType.Video),
        characters,
        // Derived from the document, exactly as the speaker picker derives them, so a temp speaker
        // retires from the command line's candidates precisely when its last line does.
        tempSpeakers: input.document ? collectTempSpeakers(input.document).map(speaker => speaker.name) : [],
        // A scene is addressed by the name the author sees in the panel, not its runtimeName.
        scenes: Object.values(input.document?.scenes ?? {}).map(entry => ({ id: entry.id, name: entry.name })),
        variables: variableEntries(input.document, input.scene, input.blueprintDocument ?? null),
        formsByCharacterId,
        stageObjects: collectStageObjects(input.document, input.sceneId, input.scene),
    };
}
