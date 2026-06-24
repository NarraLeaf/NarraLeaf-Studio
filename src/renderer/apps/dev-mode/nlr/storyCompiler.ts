import { Character, DevTools, Narrator, Scene, Story } from "narraleaf-react";
import type { DevModeCharacterSummary } from "@shared/types/devMode";
import type { StoryBlock, StoryDocument, StoryScene } from "@shared/types/story";

export type NlrStoryCompileDiagnostic = {
    level: "warning" | "error";
    blockId?: string;
    message: string;
};

export type NlrActionIdBinding = {
    action: Parameters<typeof DevTools.setActionId>[0];
    staticId: string;
    blockId: string;
    textId?: string;
};

type NlrAction = Parameters<typeof DevTools.setActionId>[0];
type DevToolsWithStaticId = typeof DevTools & {
    setStaticId?: (action: NlrAction, id: string | null) => NlrAction;
};

export type CompiledNlrStory = {
    story: Story;
    scene: Scene;
    storyId: string;
    sceneId: string;
    actionIdBindings: NlrActionIdBinding[];
    diagnostics: NlrStoryCompileDiagnostic[];
};

export function compileStudioStoryToNlr(input: {
    document: StoryDocument;
    sceneId: string;
    characters?: readonly DevModeCharacterSummary[];
}): CompiledNlrStory {
    const scene = input.document.scenes[input.sceneId];
    if (!scene) {
        throw new Error(`Scene not found: ${input.sceneId}`);
    }

    const nlrStory = new Story(input.document.name || input.document.id);
    const nlrScene = new Scene(scene.runtimeName || scene.name || scene.id);
    const diagnostics: NlrStoryCompileDiagnostic[] = [];
    const actionIdBindings: NlrActionIdBinding[] = [];
    const statements: unknown[] = [];
    const characterById = new Map<string, Character>();
    const characterNames = new Map((input.characters ?? []).map(character => [character.id, character.name]));

    const getCharacter = (characterId: string | undefined): Character => {
        const normalizedId = characterId?.trim() || "__unknown_character__";
        const existing = characterById.get(normalizedId);
        if (existing) {
            return existing;
        }
        const displayName = characterNames.get(normalizedId) ?? (normalizedId === "__unknown_character__" ? "Unknown" : normalizedId);
        const character = new Character(displayName);
        characterById.set(normalizedId, character);
        return character;
    };

    let actionIndex = 0;
    for (const block of walkSceneBlocksPreorder(scene)) {
        if (block.kind !== "nodeAction") {
            diagnostics.push({
                level: "warning",
                blockId: block.id,
                message: `Unsupported story block kind: ${block.kind}`,
            });
            continue;
        }

        if (block.payload.action === "narration") {
            const text = block.payload.text.value;
            if (!text.trim()) {
                continue;
            }
            const chain = Narrator.say(text);
            statements.push(chain);
            for (const action of DevTools.chainToActions(chain)) {
                const staticId = stableActionId(input.document.id, scene.id, block.id, block.payload.text.textId, actionIndex++);
                setStableActionId(action, staticId);
                actionIdBindings.push({
                    action,
                    staticId,
                    blockId: block.id,
                    textId: block.payload.text.textId,
                });
            }
            continue;
        }

        if (block.payload.action === "dialogue") {
            const text = block.payload.text.value;
            if (!text.trim()) {
                continue;
            }
            const character = getCharacter(block.payload.characterId);
            const chain = character.say(text);
            statements.push(chain);
            for (const action of DevTools.chainToActions(chain)) {
                const staticId = stableActionId(input.document.id, scene.id, block.id, block.payload.text.textId, actionIndex++);
                setStableActionId(action, staticId);
                actionIdBindings.push({
                    action,
                    staticId,
                    blockId: block.id,
                    textId: block.payload.text.textId,
                });
            }
            continue;
        }

        diagnostics.push({
            level: "warning",
            blockId: block.id,
            message: `Unsupported node action: ${block.payload.action}`,
        });
    }

    nlrScene.action(statements as unknown as Parameters<Scene["action"]>[0]);
    nlrStory.entry(nlrScene);

    return {
        story: nlrStory,
        scene: nlrScene,
        storyId: input.document.id,
        sceneId: scene.id,
        actionIdBindings,
        diagnostics,
    };
}

function* walkSceneBlocksPreorder(scene: StoryScene): Generator<StoryBlock> {
    const visited = new Set<string>();
    const visit = function* (blockId: string): Generator<StoryBlock> {
        if (visited.has(blockId)) {
            return;
        }
        visited.add(blockId);
        const block = scene.blocks[blockId];
        if (!block) {
            return;
        }
        yield block;
        for (const childId of block.childrenIds) {
            yield* visit(childId);
        }
    };

    for (const blockId of scene.rootBlockIds) {
        yield* visit(blockId);
    }
}

function stableActionId(storyId: string, sceneId: string, blockId: string, textId: string | undefined, index: number): string {
    return `studio:${storyId}:${sceneId}:${blockId}:${textId ?? "action"}:${index}`;
}

function setStableActionId(action: NlrAction, staticId: string): void {
    const tools = DevTools as DevToolsWithStaticId;
    if (tools.setStaticId) {
        tools.setStaticId(action, staticId);
        return;
    }
    DevTools.setActionId(action, staticId);
}
