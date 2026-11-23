import type { StoryBlockId, StoryDocument, StoryScene } from "@shared/types/story";
import type { StoryCustomCommand, StoryCustomCommandRow } from "@shared/types/story/customCommands";
import { projectStoryCommandLine } from "@/apps/workspace/modules/story/scene-editor/storyCommandLine";
import { buildCustomCommandRow } from "@/apps/workspace/modules/story/scene-editor/customCommandDefinition";
import { sceneBlockOrder } from "@/apps/workspace/modules/stage-timeline/stageTimelineModel";
import { buildContext } from "@/lib/story-cli/model";
import { buildLookups } from "@/lib/story-cli/lookups";
import { storyProjectDataOf, withCanonicalCommandVocabulary } from "@/lib/workspace/services/agent/tools/textFormat";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { StoryCustomCommandService } from "@/lib/workspace/services/story/StoryCustomCommandService";

/**
 * Rows a scene already has, written again as a custom command's rows: each printed as its command
 * line in the scene it stands in, then read back the way a line typed into the command editor is.
 *
 * Through the line rather than by copying the row, because a row in a scene is anchored to that scene
 * (the row that brought a character on, a layer's declaring row) and a command plays in every scene;
 * the line names things the way any scene can resolve them. A row the command line cannot write, or
 * that a command cannot hold (dialogue, a branch, a jump), is left out and counted.
 */
export function sceneRowsToCustomCommandRows(
    ctx: WorkspaceContext,
    document: StoryDocument,
    scene: StoryScene,
    blockIds: readonly StoryBlockId[],
): { rows: StoryCustomCommandRow[]; skipped: number } {
    const data = storyProjectDataOf(ctx);
    const lookups = buildLookups(data, document, scene, buildContext(data, document, scene)).rowLookups;
    const commandContext = buildContext(data, null, null);
    const order = sceneBlockOrder(scene);
    const ordered = [...blockIds].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    return withCanonicalCommandVocabulary(() => {
        const rows: StoryCustomCommandRow[] = [];
        let skipped = 0;
        for (const blockId of ordered) {
            const block = scene.blocks[blockId];
            const projected = block ? projectStoryCommandLine(block, lookups) : null;
            const result = projected ? buildCustomCommandRow(projected.source, commandContext) : null;
            if (result?.ok) {
                rows.push(result.row);
            } else {
                skipped += 1;
            }
        }
        return { rows, skipped };
    });
}

/** A new command made of these rows, under the first free "新指令" name. Null when none can be held. */
export function createCustomCommandFromSceneRows(
    ctx: WorkspaceContext,
    document: StoryDocument,
    scene: StoryScene,
    blockIds: readonly StoryBlockId[],
    baseName: string,
): { command: StoryCustomCommand | null; skipped: number } {
    const { rows, skipped } = sceneRowsToCustomCommandRows(ctx, document, scene, blockIds);
    if (rows.length === 0) {
        return { command: null, skipped };
    }
    const service = ctx.services.get<StoryCustomCommandService>(Services.StoryCustomCommands);
    let name = baseName;
    for (let suffix = 2; service.nameProblem(name); suffix += 1) {
        name = `${baseName}${suffix}`;
    }
    return { command: service.createCommand(name, { rows }), skipped };
}
