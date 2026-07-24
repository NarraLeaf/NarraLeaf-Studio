/**
 * Pure projections for the Dev Mode story-runtime panel (variables / call stack / timeline / scene).
 *
 * React- and engine-free so the row projection, the action↔block reverse lookup, and the declared
 * variable listing stay unit-testable. The block summary is a deliberately minimal projection: the
 * workspace editor's `describeBlock`/`blockOverview` live in a renderer-workspace module coupled to
 * the workspace `Character` service, so per the M5 card WI-4 we re-project against the shared types
 * here rather than move the component.
 */

import type { DevModeCharacterSummary } from "@shared/types/devMode";
import type {
    StoryBlock,
    StoryBlockId,
    StoryDocument,
    StoryLiteralValue,
    StoryScene,
    StorySceneId,
    StoryVariableValueType,
} from "@shared/types/story";
import { sceneVariableDefs, savedVariableDefs, storyPersistentDefs } from "@shared/types/story";

/** The action↔block fields the reverse lookups need (a structural subset of NlrActionIdBinding). */
export type ActionIdBindingLike = { staticId: string; blockId: string };

/** Editor-facing variable scopes: scene = Local, saved = Var, persistent = Persis. */
export type StoryRuntimeVariableScope = "scene" | "saved" | "persistent";

export type StoryTimelineRow = {
    blockId: StoryBlockId;
    /** 1-based, mirroring the editor's visible row numbering (a flat DFS of the block tree). */
    lineNumber: number;
    depth: number;
    kind: StoryBlock["kind"];
    disabled: boolean;
    summary: string;
};

export type DeclaredStoryVariable = {
    scope: StoryRuntimeVariableScope;
    /** Stable per-scope id: scene/saved use the declaration block id; persistent uses the storageKey. */
    id: string;
    name: string;
    valueType: StoryVariableValueType;
    defaultValue?: StoryLiteralValue;
    /** Runtime storage key inside the scope's namespace / host store. */
    storageKey: string;
};

const SPEAKER_FALLBACK = "…";

function characterName(charactersById: Map<string, DevModeCharacterSummary>, id: string | undefined): string {
    if (!id) {
        return "";
    }
    return charactersById.get(id)?.name ?? "";
}

/** A minimal one-line, read-only summary of a block for the timeline (see module note). */
export function describeStoryBlock(
    block: StoryBlock,
    charactersById: Map<string, DevModeCharacterSummary>,
    scenes?: Record<StorySceneId, StoryScene>,
): string {
    switch (block.kind) {
        case "nodeAction": {
            const payload = block.payload;
            if (payload.action === "narration") {
                return payload.text.value;
            }
            if (payload.action === "dialogue") {
                const speaker = characterName(charactersById, payload.characterId) || payload.speakerName || SPEAKER_FALLBACK;
                return `${speaker}: ${payload.text.value}`;
            }
            if (payload.action === "choice") {
                return payload.prompt?.value ? `? ${payload.prompt.value}` : "?";
            }
            return `• ${payload.text.value}`;
        }
        case "action": {
            const payload = block.payload;
            const verb = "operation" in payload && payload.operation
                ? `${payload.action} ${payload.operation}`
                : payload.action;
            let target = "";
            if ("objectName" in payload && payload.objectName) {
                target = payload.objectName;
            } else if ("characterId" in payload && payload.characterId) {
                target = characterName(charactersById, payload.characterId);
            }
            return target ? `${verb} · ${target}` : verb;
        }
        case "jump": {
            const target = scenes?.[block.payload.targetSceneId]?.name ?? block.payload.targetSceneId;
            return `→ ${target}`;
        }
        case "control": {
            const payload = block.payload;
            return payload.control === "conditionBranch" ? payload.branch : payload.control;
        }
        case "declaration":
            return `var ${block.payload.name}`;
        case "note":
            return block.payload.text.value;
        case "code":
            return "code";
        case "invalid":
            return block.payload.source;
        default:
            return "";
    }
}

/**
 * Flatten a scene's block tree into ordered rows (DFS over `rootBlockIds` → `childrenIds`), matching
 * the editor's visible-row numbering. The visited guard keeps a corrupted `childrenIds` cycle from
 * hanging the panel.
 */
export function projectSceneTimeline(
    scene: StoryScene,
    charactersById: Map<string, DevModeCharacterSummary>,
    scenes?: Record<StorySceneId, StoryScene>,
): StoryTimelineRow[] {
    const rows: StoryTimelineRow[] = [];
    const seen = new Set<StoryBlockId>();
    const walk = (blockId: StoryBlockId, depth: number): void => {
        if (seen.has(blockId)) {
            return;
        }
        const block = scene.blocks[blockId];
        if (!block) {
            return;
        }
        seen.add(blockId);
        rows.push({
            blockId,
            lineNumber: rows.length + 1,
            depth,
            kind: block.kind,
            disabled: block.disabled === true,
            summary: describeStoryBlock(block, charactersById, scenes),
        });
        for (const childId of block.childrenIds) {
            walk(childId, depth + 1);
        }
    };
    for (const rootId of scene.rootBlockIds) {
        walk(rootId, 0);
    }
    return rows;
}

/** Reverse-map an engine action id (`event:action.current`) to its Studio block. */
export function blockIdForActionId(
    bindings: readonly ActionIdBindingLike[],
    actionId: string | null,
): StoryBlockId | null {
    if (!actionId) {
        return null;
    }
    for (const binding of bindings) {
        if (binding.staticId === actionId) {
            return binding.blockId;
        }
    }
    return null;
}

/** The first action id a block compiles to — the hot-jump target for a timeline row. */
export function firstActionIdForBlock(
    bindings: readonly ActionIdBindingLike[],
    blockId: StoryBlockId,
): string | null {
    for (const binding of bindings) {
        if (binding.blockId === blockId) {
            return binding.staticId;
        }
    }
    return null;
}

/**
 * The declared variables of the running story, split by scope: scene variables of the entry scene,
 * document-wide saved and persistent. Live values are merged in by the panel from the runtime store.
 */
export function listDeclaredStoryVariables(
    document: StoryDocument,
    sceneId: StorySceneId,
): DeclaredStoryVariable[] {
    const variables: DeclaredStoryVariable[] = [];
    const scene = document.scenes[sceneId];
    if (scene) {
        for (const def of Object.values(sceneVariableDefs(scene))) {
            variables.push({
                scope: "scene",
                id: def.id,
                name: def.name,
                valueType: def.valueType,
                defaultValue: def.defaultValue,
                storageKey: def.storageKey,
            });
        }
    }
    for (const def of Object.values(savedVariableDefs(document))) {
        variables.push({
            scope: "saved",
            id: def.id,
            name: def.name,
            valueType: def.valueType,
            defaultValue: def.defaultValue,
            storageKey: def.storageKey,
        });
    }
    for (const def of Object.values(storyPersistentDefs(document))) {
        variables.push({
            scope: "persistent",
            id: def.storageKey,
            name: def.name,
            valueType: def.valueType,
            defaultValue: def.defaultValue,
            storageKey: def.storageKey,
        });
    }
    return variables;
}
