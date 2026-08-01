import type { StoryDocument } from "@shared/types/story";
import { describeStoryBlock } from "@/lib/story/storyRowProjection";
import type {
    StoryScriptImportPlan,
    StoryScriptLabeller,
    StoryScriptScenePlan,
    StoryScriptSpeakerLabeller,
    StoryScriptSpeakerResolver,
} from "@/lib/story/script/storyScriptTypes";
import type { Character } from "@/lib/workspace/services/character/Character";
import { characterRowLookup } from "../scene-editor/storySceneBlockUtils";

/**
 * What the Story Script codec needs from the project, and nothing else.
 *
 * The codec is pure by construction - it holds a scene and a text file, never a workspace service -
 * so the two places it has to ask about the world outside a scene arrive as callbacks. Both live
 * here rather than in the hook so they can be built (and read) without React.
 */

/**
 * The cosmetic `»` label of a non-editable row.
 *
 * The same sentence the editor's own row list shows, asset ids and motion ids resolved to names:
 * the label is what the writer reads in a text editor to know which action they are looking at, and
 * a raw UUID there says nothing. Nothing parses it back (see `storyScriptTypes`), so getting it
 * *prettier* is free and getting it wrong costs only legibility.
 */
export function createStoryScriptLabeller(
    document: StoryDocument,
    characters: Character[],
    assetName: (assetId: string) => string | null,
    motionName: (animationId: string) => string | null,
): StoryScriptLabeller {
    const character = characterRowLookup(characters);
    return (scene, blockId) => {
        const block = scene.blocks[blockId];
        if (!block) {
            return "";
        }
        return describeStoryBlock(block, {
            character,
            assetName,
            motionName,
            scene,
            scenes: document.scenes,
            document,
        });
    };
}

/**
 * The name a dialogue line is prefixed with, or `""` when it has none.
 *
 * Deliberately not `storyRowSpeaker`, which is the same precedence but substitutes a *translated
 * placeholder* ("Unassigned") for a line with no speaker at all. That placeholder is right on screen
 * and poison here: it would come back through `resolveSpeaker` as a bare `speakerName` and invent a
 * speaker the author never wrote, in whatever language the export happened to run in.
 *
 * A resolved character wins over `speakerName` because that is what the payload means - see the note
 * on `speakerName` in the story document types - so the script prints the name Studio and the game
 * both show, not a shadow one only the file would know about.
 *
 * **Import needs this too**, as `speakerLabel` on the plan input: comparing the file's label against
 * what this would print for the snapshot row is the only way to tell an edited label from an untouched
 * one. Export and import must therefore run the same function over the same character list - a labeller
 * that disagrees with the exporter reports edits the author never made.
 */
export function createStoryScriptSpeakerLabeller(characters: Character[]): StoryScriptSpeakerLabeller {
    const character = characterRowLookup(characters);
    return (scene, blockId) => {
        const block = scene.blocks[blockId];
        if (!block || block.kind !== "nodeAction" || block.payload.action !== "dialogue") {
            return "";
        }
        if (block.payload.characterId) {
            const resolved = character(block.payload.characterId)?.name.trim();
            if (resolved) {
                return resolved;
            }
        }
        return block.payload.speakerName?.trim() ?? "";
    };
}

/**
 * A speaker label, as typed in a text editor, resolved back to a character.
 *
 * Case- and whitespace-insensitive: the writer retypes these by hand on a device Studio is not
 * running on, and a slipped capital must not silently detach a line from its character. Two
 * characters sharing a display name resolve to the first one, so the same file always imports the
 * same way; nothing else here can tell them apart - which is precisely why the codec asks this only
 * about labels the author *changed* (see `speakerLabel` on `StoryScriptPlanInput`). Answering it for
 * an untouched label would rebind every line of the second twin to the first.
 *
 * The fallback is a bare `speakerName`, which is a valid line rather than an error - NarraLeaf's
 * dialogue box displays whatever name it is handed.
 */
export function createStoryScriptSpeakerResolver(characters: Character[]): StoryScriptSpeakerResolver {
    const byName = new Map<string, string>();
    for (const character of characters) {
        const name = character.profile.getName().trim().toLowerCase();
        if (name && !byName.has(name)) {
            byName.set(name, character.profile.getId());
        }
    }
    return label => {
        const characterId = byName.get(label.trim().toLowerCase());
        return characterId ? { characterId } : { speakerName: label };
    };
}

/**
 * The scenes an import may actually write.
 *
 * `replaceScene` throws on a scene the live document does not have, and minting one under the file's
 * own id would resurrect a scene the author deleted since the export. So a missing scene is reported
 * in the confirm dialog and skipped, never applied.
 */
export function applicableScenePlans(plan: StoryScriptImportPlan): StoryScriptScenePlan[] {
    return plan.scenes.filter(scene => !scene.missing);
}

/**
 * Write the scenes in order, stopping at the first one that refuses.
 *
 * A plan is computed when the file is picked and applied when the author confirms, and the project can
 * change in between - deleting a scene in another window is enough for `replaceScene` to throw halfway
 * through. There is no transaction to roll back to (each `replaceScene` is its own document mutation),
 * so the honest answer is to stop and say exactly how far it got.
 */
export function applyStoryScriptScenes(
    scenes: StoryScriptScenePlan[],
    write: (scene: StoryScriptScenePlan) => void,
): { applied: StoryScriptScenePlan[]; failed?: { scene: StoryScriptScenePlan; error: unknown } } {
    const applied: StoryScriptScenePlan[] = [];
    for (const scene of scenes) {
        try {
            write(scene);
        } catch (error) {
            return { applied, failed: { scene, error } };
        }
        applied.push(scene);
    }
    return { applied };
}

/**
 * How much of an import the author would be able to undo afterwards, and how much of it they would not.
 * The count travels with the verdict because "some of this cannot be undone" is only useful with a
 * number attached.
 */
export type StoryScriptUndoState = {
    coverage: "all" | "partial" | "none";
    /** Scenes with no open editor to take the write back. */
    unundoable: number;
};

/**
 * Undo is per open scene editor, so an import that spans scenes can be undoable in part. Answering
 * that with `every` (as this did) tells an author with two of three scenes open that none of it can be
 * taken back, which is both false and the kind of false that stops them importing at all.
 */
export function storyScriptUndoCoverage(
    scenes: StoryScriptScenePlan[],
    canUndo: (sceneId: string) => boolean,
): StoryScriptUndoState {
    const unundoable = scenes.filter(scene => !canUndo(scene.sceneId)).length;
    if (unundoable === 0) {
        return { coverage: "all", unundoable };
    }
    return { coverage: unundoable === scenes.length ? "none" : "partial", unundoable };
}

/** Whether anything at all is worth showing the author beyond the counts. */
export function planHasWarnings(plan: StoryScriptImportPlan): boolean {
    return !plan.storyMatches
        || plan.diagnostics.length > 0
        || plan.scenes.some(scene => scene.stale || scene.missing || scene.diagnostics.length > 0);
}

/** A file name a native save dialog will accept on every platform we ship to. */
export function storyScriptFileName(name: string): string {
    const cleaned = name.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
    return `${cleaned || "script"}.txt`;
}
