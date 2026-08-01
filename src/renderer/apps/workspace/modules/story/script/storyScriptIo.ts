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
 * same way; nothing else here can tell them apart.
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
