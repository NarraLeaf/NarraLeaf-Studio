import type { StoryBlock, StoryScene, StoryTextSegment } from "@shared/types/story";
import { listSceneBlocksInDocumentOrder, listScenesInDocumentOrder } from "@shared/types/story";
import { countSegmentInterpolations, serializeSegmentSourceText } from "@shared/utils/localizationText";
import type { SearchJumpTarget } from "../../../workspace/services/search/searchIndexModel";
import type { LintContext, LintStoryEntry } from "../../context";
import type { LintLocation } from "../../types";

/**
 * The one walk behind all eight W4 rules: every player-facing line the shipped game will actually
 * contain.
 *
 * It lives under `rules/text/` because that is the private helper directory of the work item that
 * owns `text.ts`, `localization.ts` and `voice.ts` - the three files that consume it. There is no
 * `index.ts` beside it, so `./text` still resolves to the rule file, not this directory.
 *
 * What "actually contain" means, and why each clause is load-bearing:
 *
 *  - **Document order, never `Object.values`.** `listScenesInDocumentOrder` /
 *    `listSceneBlocksInDocumentOrder` read the declared arrays; a scene record is a lookup table and
 *    reading sequence out of one gives whatever the last rebuild of the object happened to leave.
 *    Findings would then reorder themselves between runs for no authored reason.
 *  - **A disabled block is not in the game.** It is skipped *with its subtree* (same predicate the
 *    compiler uses), so a disabled choice takes its options with it. Linting a row the build strips
 *    would report defects in text no player can reach.
 *  - **All four text-bearing node actions, including the choice prompt.** The prompt is translated
 *    and voiced through the same unit id space as everything else, so leaving it out of the live set
 *    would make every translated prompt read as an orphan. Individual rules narrow from here; the
 *    walk itself never decides what a rule cares about.
 *  - **Notes are not here.** An editor note has a `textId` but never reaches a player.
 */

export type LintTextSegmentKind = "narration" | "dialogue" | "choicePrompt" | "choiceOption";

/**
 * Kinds a voice actor always records: the spoken line. A project that voices its choices adds
 * `choiceOption` on top of these - see `voice/missing`, which is the only rule that asks.
 */
export const SPOKEN_TEXT_SEGMENT_KINDS: readonly LintTextSegmentKind[] = ["narration", "dialogue"];

export type LintTextSegmentRef = {
    story: LintStoryEntry;
    scene: StoryScene;
    block: StoryBlock;
    segment: StoryTextSegment;
    /** The segment's `textId` - simultaneously the translation unit id and the engine's `voiceId`. */
    textId: string;
    /**
     * Derived from the block payload rather than from `segment.role`: the role is authored data that
     * a migration or a hand-edited document can leave disagreeing with the action it sits on, and
     * every rule here means "what kind of row is this", which only the payload answers.
     */
    kind: LintTextSegmentKind;
};

type SegmentOfBlock = { segment: StoryTextSegment; kind: LintTextSegmentKind };

function textSegmentOfBlock(block: StoryBlock): SegmentOfBlock | null {
    if (block.kind !== "nodeAction") {
        return null;
    }
    const payload = block.payload;
    switch (payload.action) {
        case "narration":
            return { segment: payload.text, kind: "narration" };
        case "dialogue":
            return { segment: payload.text, kind: "dialogue" };
        case "choice":
            return payload.prompt ? { segment: payload.prompt, kind: "choicePrompt" } : null;
        case "choiceOption":
            return { segment: payload.text, kind: "choiceOption" };
        default:
            return null;
    }
}

function isDisabled(block: StoryBlock): boolean {
    return block.disabled === true;
}

/** Every live text segment of every story, in authoring order. */
export function listLiveTextSegments(ctx: LintContext): LintTextSegmentRef[] {
    const refs: LintTextSegmentRef[] = [];
    for (const story of ctx.stories) {
        for (const scene of listScenesInDocumentOrder(story.document)) {
            for (const block of listSceneBlocksInDocumentOrder(scene, { skipSubtree: isDisabled })) {
                const found = textSegmentOfBlock(block);
                if (!found || !found.segment.textId) {
                    continue;
                }
                refs.push({
                    story,
                    scene,
                    block,
                    segment: found.segment,
                    textId: found.segment.textId,
                    kind: found.kind,
                });
            }
        }
    }
    return refs;
}

/**
 * Translator-facing source text of a segment: literal runs verbatim, interpolations as `{n}`.
 *
 * The shared helper, not a local rehash - it is what `LocalizationService` hashed into every stored
 * `sourceHash`, so any second implementation would make staleness disagree with the panel the author
 * fixes it in.
 */
export function segmentSourceText(segment: StoryTextSegment): string {
    return serializeSegmentSourceText(segment);
}

/**
 * True when a segment renders nothing at all.
 *
 * Mirrors the compiler's own emptiness test (`storyCompiler` skips a dialogue whose text is blank
 * *and* carries no interpolation and no inline event): a line that is only `{gold}` is a real line,
 * and a line that is only a reveal-time event still fires. Blank lines are excluded from the
 * translation and voice rules because there is nothing to translate or record - `text/empty` is the
 * rule that reports them, once.
 */
export function isBlankSegment(segment: StoryTextSegment): boolean {
    if (segmentSourceText(segment).trim()) {
        return false;
    }
    if (countSegmentInterpolations(segment) > 0) {
        return false;
    }
    return !(segment.rich ?? []).some(run => "event" in run);
}

/**
 * The legacy per-line voice asset, when the row has one.
 *
 * Only a dialogue payload carries `voiceAssetId`; narration never did. The compiler tries the voice
 * map first and falls back to this field (`scene.getVoice(id) || voice`), so a rule that ignored it
 * would report a missing recording for a line that plays one.
 */
export function legacyVoiceAssetId(block: StoryBlock): string | undefined {
    if (block.kind !== "nodeAction" || block.payload.action !== "dialogue") {
        return undefined;
    }
    return block.payload.voiceAssetId;
}

export function storyLocation(ref: LintTextSegmentRef): LintLocation {
    return {
        kind: "story",
        storyId: ref.story.id,
        storyName: ref.story.name,
        sceneId: ref.scene.id,
        sceneName: ref.scene.name,
        blockId: ref.block.id,
    };
}

export function storyBlockTarget(ref: LintTextSegmentRef): SearchJumpTarget {
    return {
        kind: "storyBlock",
        storyId: ref.story.id,
        storyName: ref.story.name,
        sceneId: ref.scene.id,
        sceneName: ref.scene.name,
        blockId: ref.block.id,
    };
}
