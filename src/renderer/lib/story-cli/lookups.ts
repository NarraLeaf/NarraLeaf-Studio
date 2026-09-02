/**
 * Turning a project read off disk into the lookup tables the printer and the reader take.
 *
 * Three surfaces want overlapping slices of the same facts - the row projection wants to NAME
 * things, the prose reader wants to resolve a speaker name back to a character, and a condition
 * wants a variable's name - so they are built together from one project rather than assembled at
 * each call site. Nothing here reads a file; `project.ts` has already done that.
 *
 * An id that resolves to nothing answers `null` everywhere, never the id itself. That is what makes
 * a dangling reference visible: the printer cannot spell the row, so the row is preserved verbatim
 * instead of being written with an identifier where a name belongs.
 *
 * Comments in English per project convention.
 */

import type { StoryDocument, StoryScene, StoryVariableRef } from "@shared/types/story";
import {
    savedVariableDefs,
    sceneVariableDefs,
    storyPersistentDefs,
} from "@shared/types/story/declarations";
import type { StoryCommandLineLookups } from "@/apps/workspace/modules/story/scene-editor/storyCommandLine";
import type { StoryCommandContext } from "@/apps/workspace/modules/story/scene-editor/storyCommandValues";
import type { ConditionLookups } from "./dsl/condition";
import type { ProseLookups } from "./dsl/prose";
import type { ProjectData } from "./project";

export type SceneLookups = {
    rowLookups: StoryCommandLineLookups;
    prose: ProseLookups;
    conditions: ConditionLookups;
};

export function buildLookups(
    data: ProjectData,
    document: StoryDocument | null,
    scene: StoryScene | null,
    context: StoryCommandContext,
): SceneLookups {
    const charactersById = new Map(data.characters.map(character => [character.profile.getId(), character]));
    const byName = new Map<string, { id: string; name: string }[]>();
    for (const character of data.characters) {
        const name = character.profile.getName();
        const list = byName.get(name) ?? [];
        list.push({ id: character.profile.getId(), name });
        byName.set(name, list);
    }

    const assetsByIdName = new Map<string, string>();
    for (const shard of Object.values(data.assets)) {
        for (const asset of Object.values(shard as Record<string, { id: string; name: string }>)) {
            assetsByIdName.set(asset.id, asset.name);
        }
    }

    // Both project scopes in one lookup, each addressed the way a ref carries it: `saved` by entry
    // id, `persistent` by storage key. A ref already says which scope it is, so one function is
    // enough and two would have to agree about which one a caller meant.
    const savedById = new Map(data.savedVariables.map(entry => [entry.id, entry.name]));
    const persistentByKey = new Map(data.persistentVariables.map(entry => [entry.storageKey ?? entry.id, entry.name]));

    const rowLookups: StoryCommandLineLookups = {
        character: characterId => {
            const character = charactersById.get(characterId);
            return character ? { name: character.profile.getName() } : null;
        },
        assetName: assetId => assetsByIdName.get(assetId) ?? null,
        motionName: () => null,
        appearanceName: (characterId, refId) => appearanceName(charactersById.get(characterId), refId),
        appearanceOptions: characterId => appearanceOptions(charactersById.get(characterId)),
        projectVariableName: (scope, variableId) =>
            (scope === "saved" ? savedById.get(variableId) : persistentByKey.get(variableId)) ?? null,
        appTagName: appTagId => data.appTags.find(tag => tag.id === appTagId)?.name ?? null,
        surfaceName: surfaceId => data.surfaces.find(surface => surface.id === surfaceId)?.name ?? null,
        audioTrackName: trackId => data.audioTracks.find(track => track.id === trackId)?.name ?? null,
        ...(scene ? { scene } : {}),
        ...(document ? { scenes: document.scenes, document } : {}),
        commandContext: context,
    };

    const prose: ProseLookups = {
        characterName: characterId => charactersById.get(characterId)?.profile.getName() ?? null,
        charactersNamed: name => byName.get(name) ?? [],
    };

    const conditions: ConditionLookups = {
        variableName: ref => variableName(ref, document, scene, rowLookups),
    };

    return { rowLookups, prose, conditions };
}

/**
 * A variable ref's author-facing name.
 *
 * Three places declare one: a `scene` variable is a declaration row in its own scene, a `saved` one
 * is either a declaration row anywhere in the story or an entry in the project registry, and a
 * `persistent` one is a registry entry addressed by storage key. The scan comes first because a
 * story-declared variable is the one the registry does not hold.
 */
function variableName(
    ref: StoryVariableRef,
    document: StoryDocument | null,
    scene: StoryScene | null,
    rowLookups: StoryCommandLineLookups,
): string | null {
    if (ref.scope === "scene") {
        const defs = scene ? sceneVariableDefs(scene) : {};
        return defs[ref.variableId]?.name ?? null;
    }
    if (ref.scope === "saved") {
        const declared = document ? savedVariableDefs(document)[ref.variableId] : undefined;
        return declared?.name ?? rowLookups.projectVariableName?.("saved", ref.variableId) ?? null;
    }
    // A persistent ref's `variableId` IS its storage key, which is what the registry files the entry
    // under - so both scopes address their table with the one field the ref carries.
    const declared = document ? storyPersistentDefs(document)[ref.variableId] : undefined;
    return declared?.name ?? rowLookups.projectVariableName?.("persistent", ref.variableId) ?? null;
}

type CharacterLike = ProjectData["characters"][number];

/**
 * A pose or tag id as its name, across both appearance kinds.
 *
 * A layered character's tags are looked up flat across every axis, the way the command context
 * builds its own table: the engine resolves a tag against the group that owns it, so no surface has
 * to say which axis the author meant.
 */
function appearanceName(character: CharacterLike | undefined, refId: string): string | null {
    if (!character) {
        return null;
    }
    const appearance = character.profile.appearance;
    if (appearance.getKind() === "preset") {
        return appearance.getPoses().find(pose => pose.id === refId)?.name ?? null;
    }
    for (const axis of appearance.getAxes()) {
        const tag = axis.tags.find(candidate => candidate.id === refId);
        if (tag) {
            return tag.name;
        }
    }
    return null;
}

function appearanceOptions(
    character: CharacterLike | undefined,
): readonly { id: string; name: string; axisId?: string }[] {
    if (!character) {
        return [];
    }
    const appearance = character.profile.appearance;
    if (appearance.getKind() === "preset") {
        return appearance.getPoses().map(pose => ({ id: pose.id, name: pose.name }));
    }
    return appearance
        .getAxes()
        .flatMap(axis => axis.tags.map(tag => ({ id: tag.id, name: tag.name, axisId: axis.id })));
}
