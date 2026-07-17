import type { StoryDocument, StoryScene } from "@shared/types/story";
import { collectTempSpeakers } from "@/lib/workspace/services/story/storyModel";
import type { Character } from "@/lib/workspace/services/character/Character";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { AssetsMap } from "@/lib/workspace/services/assets/types";
import type { StoryCommandContext, StoryCommandNamedRef, StoryCommandVariableEntry } from "./storyCommandResolution";

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
 * Variables the author may address by name.
 *
 * Scene-local and document-saved only: persistent variables live in the blueprint document and are
 * keyed by `storageKey`, so they need a source this builder does not have. `/set` on a persistent
 * variable therefore reports "unknown variable" for now — a gap, not a decision.
 */
function variableEntries(document: StoryDocument | null, scene: StoryScene | null): StoryCommandVariableEntry[] {
    const entries: StoryCommandVariableEntry[] = [];
    for (const definition of Object.values(scene?.sceneVariables ?? {})) {
        entries.push({
            name: definition.name,
            ref: { scope: "scene", variableId: definition.id },
            valueType: definition.valueType,
        });
    }
    for (const definition of Object.values(document?.savedVariables ?? {})) {
        entries.push({
            name: definition.name,
            ref: { scope: "saved", variableId: definition.id },
            valueType: definition.valueType,
        });
    }
    return entries;
}

export function buildStoryCommandContext(input: {
    assets: AssetsMap | undefined;
    characters: readonly Character[];
    document: StoryDocument | null;
    scene: StoryScene | null;
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
        variables: variableEntries(input.document, input.scene),
        formsByCharacterId,
    };
}
