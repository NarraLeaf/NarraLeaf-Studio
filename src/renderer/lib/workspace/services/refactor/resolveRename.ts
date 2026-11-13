import {
    findDeclarationBlock,
    listSceneLabels,
    listScenesInDocumentOrder,
    type StoryBlockId,
    type StoryId,
    type StorySceneId,
    type StoryVariableRef,
} from "@shared/types/story";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { Services, type WorkspaceContext } from "../services";
import type { CharacterService } from "../core/CharacterService";
import type { VariableRegistryService } from "../variables/VariableRegistryService";
import type { LocalBlueprintService } from "../ui-editor/LocalBlueprintService";
import { loadRenameStories } from "./applyRename";
import {
    planCharacterRename,
    planLabelRename,
    planSceneRename,
    planVariableRename,
    variableNamesInReach,
    type RenamePlan,
    type RenameStory,
    type RenameSubject,
    type VariableSubject,
} from "./renameModel";

/** What a rename is asked about, by id. See `renameRequests.ts` in the workspace modules. */
export type RenameRequest =
    /** `storyId` places a scene variable, whose declaration row lives in one story. */
    | { kind: "variable"; ref: StoryVariableRef; storyId?: StoryId }
    | { kind: "label"; storyId: StoryId; sceneId: StorySceneId; blockId: StoryBlockId }
    | { kind: "scene"; storyId: StoryId; sceneId: StorySceneId }
    | { kind: "character"; characterId: string };

/** A request resolved against the project as it stands: what to plan from, and what it competes with. */
export type ResolvedRename = {
    subject: RenameSubject;
    stories: RenameStory[];
    registry: VariableRegistryEntry[];
    blueprints: BlueprintDocument | null;
    /** The other names in the subject's namespace. */
    taken: string[];
};

function optional<T>(ctx: WorkspaceContext, id: Services): T | null {
    try {
        return (ctx.services.get as (key: Services) => unknown)(id) as T;
    } catch {
        return null;
    }
}

/**
 * Who declares a variable: a registry entry (by id or storage key), else a declaration row in a
 * story. Scene variables are always rows; their ref's id IS the row's id.
 */
export function resolveVariableSubject(
    ref: StoryVariableRef,
    stories: readonly RenameStory[],
    registry: readonly VariableRegistryEntry[],
    storyId?: StoryId,
): VariableSubject | null {
    if (ref.scope !== "scene") {
        const entry = registry.find(candidate => candidate.scope === ref.scope
            && (candidate.id === ref.variableId || candidate.storageKey === ref.variableId));
        if (entry) {
            return { kind: "variable", ref, name: entry.name, declaration: { source: "registry", entryId: entry.id } };
        }
    }
    const ordered = storyId ? [...stories].sort((a, b) => Number(b.id === storyId) - Number(a.id === storyId)) : stories;
    for (const story of ordered) {
        const found = findDeclarationBlock(story.document, ref.variableId);
        if (found && found.block.payload.scope === ref.scope) {
            return {
                kind: "variable",
                ref,
                name: found.block.payload.name,
                declaration: { source: "story", storyId: story.id, sceneId: found.sceneId, blockId: found.block.id },
            };
        }
    }
    return null;
}

/** Read everything a rename dialog needs. Null when the thing named no longer exists. */
export async function resolveRenameRequest(ctx: WorkspaceContext, request: RenameRequest): Promise<ResolvedRename | null> {
    const stories = await loadRenameStories(ctx);
    const registry = optional<VariableRegistryService>(ctx, Services.VariableRegistry)?.listEntries() ?? [];
    let blueprints: BlueprintDocument | null = null;
    try {
        blueprints = optional<LocalBlueprintService>(ctx, Services.LocalBlueprint)?.getBlueprintDocument() ?? null;
    } catch {
        blueprints = null;
    }
    const base = { stories, registry, blueprints };

    switch (request.kind) {
        case "variable": {
            const subject = resolveVariableSubject(request.ref, stories, registry, request.storyId);
            return subject ? { ...base, subject, taken: variableNamesInReach({ subject, stories, registry }) } : null;
        }
        case "label": {
            const scene = stories.find(story => story.id === request.storyId)?.document.scenes[request.sceneId];
            const block = scene?.blocks[request.blockId];
            if (!scene || block?.kind !== "control" || block.payload.control !== "label") {
                return null;
            }
            return {
                ...base,
                subject: { kind: "label", storyId: request.storyId, sceneId: request.sceneId, blockId: request.blockId, name: block.payload.name },
                taken: listSceneLabels(scene).filter(label => label.blockId !== request.blockId).map(label => label.name),
            };
        }
        case "scene": {
            const story = stories.find(entry => entry.id === request.storyId);
            const scene = story?.document.scenes[request.sceneId];
            if (!story || !scene) {
                return null;
            }
            return {
                ...base,
                subject: { kind: "scene", storyId: story.id, sceneId: scene.id, name: scene.name },
                taken: listScenesInDocumentOrder(story.document).filter(entry => entry && entry.id !== scene.id).map(entry => entry.name),
            };
        }
        case "character": {
            const characters = optional<CharacterService>(ctx, Services.Character);
            const character = characters?.getCharacter(request.characterId);
            if (!characters || !character) {
                return null;
            }
            return {
                ...base,
                subject: { kind: "character", characterId: request.characterId, name: character.profile.getName() },
                taken: characters.listCharacter().filter(entry => entry !== character).map(entry => entry.profile.getName()),
            };
        }
    }
}

export function planResolvedRename(resolved: ResolvedRename, newName: string): RenamePlan {
    const { subject, stories, registry, blueprints } = resolved;
    switch (subject.kind) {
        case "variable":
            return planVariableRename({ subject, newName, stories, registry, blueprints });
        case "label":
            return planLabelRename({ subject, newName, stories });
        case "scene":
            return planSceneRename({ subject, newName, stories });
        case "character":
            return planCharacterRename({ subject, newName, stories });
    }
}
