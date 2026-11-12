import type { StoryBlock, StoryBlockId, StoryDocument, StoryId, StorySceneId } from "@shared/types/story";
import type { TranslationKey } from "@shared/i18n/catalog";
import { getProjectWriteFreeze } from "@/lib/app/writeFreeze";
import { Services, type WorkspaceContext } from "../services";
import { StoryService } from "../story/StoryService";
import type { CharacterService } from "../core/CharacterService";
import type { VariableRegistryService } from "../variables/VariableRegistryService";
import { HistoryService, type HistoryGroupMember } from "../history/HistoryService";
import type { HistoryLabel } from "../history/historyModel";
import { projectHistoryScope, renameRefactorHistoryScope, storySceneHistoryScope } from "../history/historyScopes";
import { blockReferenceSlots, type RenameChange, type RenamePlan, type RenameStory } from "./renameModel";

/**
 * Write a rename plan, as one undo step.
 *
 * Shaped like the Search panel's replace (`storyReplace.ts`), for the same reasons: every edit is
 * worked out before the first write, a plan carrying a site it could not rewrite is refused whole,
 * and each scene gets a command step of its own on its own stack, so Ctrl+Z inside a scene stays in
 * order with that scene's other edits. One group step on the project stack takes all of them back
 * together - which is what Ctrl+Z outside an editor, and the Edit menu, reach.
 *
 * Both directions re-read the live row and write a change only where the row still holds the side it
 * expects. A row edited since keeps the author's later edit; undo never writes a document back to a
 * state it was never in.
 *
 * A character is the exception: `CharacterService.renameCharacter` already owns that one step,
 * because only it can restore the character record, so the plan's rows are handed to it.
 */

/** Every story in the project, loaded - what a plan is made from. Unreadable stories are skipped. */
export async function loadRenameStories(ctx: WorkspaceContext): Promise<RenameStory[]> {
    const storyService = ctx.services.get<StoryService>(Services.Story);
    const stories: RenameStory[] = [];
    for (const entry of storyService.listStories()) {
        try {
            stories.push({ id: entry.id, name: entry.name, document: await storyService.loadStory(entry.id) });
        } catch (error) {
            console.warn(`[rename] could not read story ${entry.id}:`, error);
        }
    }
    return stories;
}

export function selectedChanges(plan: RenamePlan, excluded: ReadonlySet<string>): RenameChange[] {
    return plan.edits.filter(edit => edit.required || !excluded.has(edit.id)).map(edit => edit.change);
}

type Side = "before" | "after";

type BlockChange = Exclude<RenameChange, { kind: "sceneName" | "registryName" | "characterName" }>;

function isBlockChange(change: RenameChange): change is BlockChange {
    return change.kind !== "sceneName" && change.kind !== "registryName" && change.kind !== "characterName";
}

const other = (side: Side): Side => (side === "after" ? "before" : "after");

/** One change applied to a live payload, or null when the row no longer holds the side expected. */
function applyToPayload(block: StoryBlock, payload: StoryBlock["payload"], change: BlockChange, side: Side): StoryBlock["payload"] | null {
    const expect = change[other(side)];
    const write = change[side];
    switch (change.kind) {
        case "blockExpression": {
            const slot = blockReferenceSlots({ ...block, payload } as StoryBlock).expressions.find(entry => entry.key === change.key);
            const expected = expect as typeof change.before;
            if (!slot || slot.expression.source !== expected.source) {
                return null;
            }
            return slot.write(payload, write as typeof change.after);
        }
        case "declarationName":
        case "labelName": {
            const current = (payload as { name?: string }).name;
            return current === expect ? ({ ...payload, name: write } as StoryBlock["payload"]) : null;
        }
        case "gotoTarget": {
            const current = (payload as { targetLabel?: string }).targetLabel;
            return current === expect ? ({ ...payload, targetLabel: write } as StoryBlock["payload"]) : null;
        }
        case "speakerName": {
            const current = (payload as { speakerName?: string }).speakerName;
            return current === expect ? ({ ...payload, speakerName: write } as StoryBlock["payload"]) : null;
        }
    }
}

/** Write one scene's share of the changes, in one direction. */
function writeScene(storyService: StoryService, storyId: StoryId, sceneId: StorySceneId, changes: readonly RenameChange[], side: Side): void {
    let document: StoryDocument;
    try {
        document = storyService.getStoryDocument(storyId);
    } catch {
        return;
    }
    const scene = document.scenes[sceneId];
    if (!scene) {
        return;
    }
    const payloads = new Map<StoryBlockId, StoryBlock["payload"]>();
    for (const change of changes) {
        if (!isBlockChange(change)) {
            continue;
        }
        const block = scene.blocks[change.blockId];
        if (!block) {
            continue;
        }
        const next = applyToPayload(block, payloads.get(block.id) ?? block.payload, change, side);
        if (next) {
            payloads.set(block.id, next);
        }
    }
    if (payloads.size > 0) {
        storyService.updateBlocks(storyId, [...payloads].map(([blockId, payload]) => ({ sceneId, blockId, payload })));
    }
    for (const change of changes) {
        if (change.kind === "sceneName" && scene.name === change[other(side)]) {
            storyService.renameScene(storyId, sceneId, change[side]);
        }
    }
}

export function renameHistoryLabel(plan: RenamePlan): HistoryLabel {
    return {
        key: "refactor.history.rename" as TranslationKey,
        params: { from: plan.subject.name, to: plan.newName },
    };
}

/**
 * Apply the edits of `plan` the author left ticked. Returns whether anything was written: false for
 * a plan with failures, a frozen workspace, or nothing to write - and then no history is recorded.
 */
export async function applyRenamePlan(ctx: WorkspaceContext, plan: RenamePlan, excluded: ReadonlySet<string>): Promise<boolean> {
    if (plan.failures.length > 0 || !plan.newName || getProjectWriteFreeze()) {
        return false;
    }
    const changes = selectedChanges(plan, excluded);
    if (changes.length === 0) {
        return false;
    }

    if (plan.subject.kind === "character") {
        const rows = new Map<StoryId, { sceneId: StorySceneId; blockId: StoryBlockId }[]>();
        for (const change of changes) {
            if (change.kind === "speakerName") {
                const bucket = rows.get(change.storyId) ?? [];
                bucket.push({ sceneId: change.sceneId, blockId: change.blockId });
                rows.set(change.storyId, bucket);
            }
        }
        return ctx.services.get<CharacterService>(Services.Character).renameCharacter(plan.subject.characterId, plan.newName, {
            spokenRows: [...rows].map(([storyId, list]) => ({ storyId, rows: list })),
        });
    }

    const storyService = ctx.services.get<StoryService>(Services.Story);
    const registryService = ctx.services.get<VariableRegistryService>(Services.VariableRegistry);
    const historyService = ctx.services.get<HistoryService>(Services.History);
    const label = renameHistoryLabel(plan);

    const byScene = new Map<string, { storyId: StoryId; sceneId: StorySceneId; changes: RenameChange[] }>();
    const registryChanges: Extract<RenameChange, { kind: "registryName" }>[] = [];
    for (const change of changes) {
        if (change.kind === "registryName") {
            registryChanges.push(change);
            continue;
        }
        if (change.kind === "characterName") {
            continue;
        }
        const key = `${change.storyId}\u0000${change.sceneId}`;
        const bucket = byScene.get(key) ?? { storyId: change.storyId, sceneId: change.sceneId, changes: [] };
        bucket.changes.push(change);
        byScene.set(key, bucket);
    }

    const writeRegistry = (side: Side) => {
        for (const change of registryChanges) {
            if (registryService.getEntry(change.entryId)?.name === change[other(side)]) {
                registryService.renameEntry(change.entryId, change[side]);
            }
        }
    };

    historyService.withoutRecording(() => {
        writeRegistry("after");
        for (const { storyId, sceneId, changes: sceneChanges } of byScene.values()) {
            writeScene(storyService, storyId, sceneId, sceneChanges, "after");
        }
    });

    const members: HistoryGroupMember[] = [...byScene.values()].map(({ storyId, sceneId, changes: sceneChanges }) => ({
        scopeId: storySceneHistoryScope(storyId, sceneId),
        label,
        undo: () => writeScene(storyService, storyId, sceneId, sceneChanges, "before"),
        redo: () => writeScene(storyService, storyId, sceneId, sceneChanges, "after"),
    }));
    if (registryChanges.length > 0) {
        members.push({
            scopeId: renameRefactorHistoryScope(),
            label,
            undo: () => writeRegistry("before"),
            redo: () => writeRegistry("after"),
        });
    }
    historyService.pushGroup(projectHistoryScope(), { label, members });
    return true;
}
