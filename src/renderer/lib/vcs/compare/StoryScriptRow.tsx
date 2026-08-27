import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { projectStoryRow, type StoryRowLookups } from "@/lib/story/storyRowProjection";
import {
    STORY_MARK_PX,
    STORY_ROW_CONTENT_PAD_PX,
    StoryCommandGlyphMark,
    StoryNarratorRingMark,
    StorySpeakerDiscMark,
    StorySpeakerName,
} from "@/apps/workspace/modules/story/scene-editor/StoryRowGutterMark";
import {
    characterSpeakerIdentity,
    unknownSpeakerIdentity,
    type StorySpeakerIdentity,
} from "@/apps/workspace/modules/story/scene-editor/storySpeakerIdentity";
import { getBlockBadgeInfo } from "@/apps/workspace/modules/story/scene-editor/storySceneBlockUtils";
import { CHANGE_MASK_CLASS, type ChangeMaskTone } from "../presenters/changeMask";
import { DocumentChangeLine } from "../DocumentChangeList";
import type { StoryScriptLine, StoryScriptScene, StoryScriptSlot } from "./storyScriptPlan";

/**
 * One version's script, drawn the way the story editor draws it and unable to do anything else.
 *
 * The layout is not a second reading of a story row: the sentence comes from `storyRowProjection` -
 * the projection the story editor and the Dev Mode timeline both draw from - and the gutter marks
 * are the editor's own components. A row here has to be the same drawing as the row in the editor,
 * or a comparison is a different reading of the script than the tab beside it.
 *
 * **Nothing here can be operated, and that is structural rather than a promise.** There is no
 * button, no handler, no input and nothing focusable in this file: a comparison shows a version, and
 * the older half shows a version that cannot be written to even in principle. The editor's row
 * component could not be borrowed for that reason - it arrives with selection, drag, inline editing,
 * undo and autosave attached to a workspace service - so what is reused is its projection, its marks
 * and its measurements, and the fifty lines of layout around them are written out here.
 *
 * **A whole line is the finest mark there is.** `storyDiff.ts` compares a block's whole payload in
 * one go, so "this line changed" is the entire truth the data carries; nothing here tints a word or
 * claims to know which ones moved.
 */

/** One nesting level, in px. The editor's own step, which is what makes the two read alike. */
const SCRIPT_INDENT_PX = 12;

/** Wide enough for three digits at `text-2xs`; a scene with four is longer than anyone scrolls. */
const SCRIPT_NUMBER_PX = 20;

/** The single-line box every column of a row centres in, so a wrapped line keeps its first line level. */
const SCRIPT_ROW_BOX_PX = STORY_MARK_PX;

const COLUMN_STYLE = {
    height: SCRIPT_ROW_BOX_PX,
    display: "flex",
    alignItems: "center",
} as const;

/** What a row wears when the comparison marked it, and what it wears when it did not. */
function toneClass(tone: ChangeMaskTone | null): string {
    return tone ? CHANGE_MASK_CLASS[tone] : "border-transparent";
}

/**
 * The words for the two speakers a document cannot name by itself.
 *
 * Taken as props rather than translated here so the whole file stays free of a translator, which is
 * what lets it be rendered from anywhere - and both are keys the story editor already uses.
 */
export interface StoryScriptWords {
    /** What a narration row's mark is called. `story.badge.narration`. */
    readonly narrator: string;
    /** A dialogue row with nobody assigned. `story.characterName.unassigned`. */
    readonly unassigned: string;
    /** A scene with no name of its own. `story.describe.sceneUnknown`. */
    readonly unnamedScene: string;
}

export function StoryScriptSceneRow({
    scene,
    tone,
    active,
    words,
}: {
    readonly scene: StoryScriptScene;
    readonly tone: ChangeMaskTone | null;
    readonly active: boolean;
    readonly words: StoryScriptWords;
}) {
    return (
        // Padding rather than a margin above the rule: the halves reserve a measured height for
        // every slot, and `getBoundingClientRect` does not count margins - so a margin here would
        // put the two columns a few pixels out of step once per scene.
        <div data-script-scene data-script-tone={tone ?? undefined} className="border-t border-edge pt-2">
            <div
                className={cn(
                    "flex items-center rounded-md border px-1 py-0.5",
                    toneClass(tone),
                    active && "ring-1 ring-primary/40",
                )}
            >
                <span className="min-w-0 truncate text-xs font-medium text-fg">
                    {scene.name ?? words.unnamedScene}
                </span>
            </div>
        </div>
    );
}

export function StoryScriptLineRow({
    line,
    lookups,
    tone,
    active,
    words,
}: {
    readonly line: StoryScriptLine;
    readonly lookups: StoryRowLookups;
    readonly tone: ChangeMaskTone | null;
    readonly active: boolean;
    readonly words: StoryScriptWords;
}) {
    const { block, depth, lineNumber } = line;
    // A read-only surface, so no editing placeholders: an empty narration row prints nothing rather
    // than the editor's "double-click to enter narration", which is an instruction nobody here can
    // follow.
    const projected = projectStoryRow(block, lookups, { editingPlaceholders: false });
    const speaker = projected.speaker
        ? characterSpeakerIdentity(projected.speaker.name || words.unassigned, {
            hasPortrait: false,
            color: projected.speaker.color,
        })
        : null;

    return (
        <div
            data-script-line={lineNumber}
            data-script-tone={tone ?? undefined}
            className={cn(
                "flex cursor-default items-start gap-2 rounded-md border px-1",
                toneClass(tone),
                active && "ring-1 ring-primary/40",
                // A disabled row is still in the document and still compared, so it is drawn - dimmed
                // the same amount the editor dims it, which is how it says "this does not run".
                block.disabled === true && "opacity-45",
            )}
        >
            <span
                className="shrink-0 select-none justify-end text-2xs tabular-nums text-fg-subtle"
                style={{ ...COLUMN_STYLE, width: SCRIPT_NUMBER_PX }}
            >
                {lineNumber}
            </span>
            <span
                className="shrink-0 justify-center"
                style={{ ...COLUMN_STYLE, width: STORY_MARK_PX, marginLeft: depth * SCRIPT_INDENT_PX }}
            >
                <StoryScriptRowMark line={line} speaker={speaker} words={words} />
            </span>
            {/* Wrapped rather than truncated: the halves measure what a row actually came out at, so
                a long line costs both columns the same extra height and nothing is cut off in a tab
                an author widened precisely to read it. */}
            <span
                className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-normal text-fg"
                style={{
                    minHeight: SCRIPT_ROW_BOX_PX,
                    paddingTop: STORY_ROW_CONTENT_PAD_PX,
                    paddingBottom: STORY_ROW_CONTENT_PAD_PX,
                }}
            >
                {speaker && <StorySpeakerName identity={speaker} className="mr-1.5" />}
                {projected.sentence}
            </span>
        </div>
    );
}

/**
 * The mark at the head of a row: who says it, or which directive it is.
 *
 * The editor's own gutter vocabulary, drawn by the editor's own components - a person is a solid
 * disc, the narrator a hollow ring, a directive a bare glyph in its category's hue. The one shape
 * this surface cannot draw is the portrait, which needs the asset library at that version; the disc
 * is that mark's documented downgrade, same size and same colour, so a character still reads as that
 * character.
 */
function StoryScriptRowMark({
    line,
    speaker,
    words,
}: {
    readonly line: StoryScriptLine;
    readonly speaker: StorySpeakerIdentity | null;
    readonly words: StoryScriptWords;
}): ReactNode {
    const { block } = line;
    if (block.kind === "nodeAction" && block.payload.action === "narration") {
        return <StoryNarratorRingMark label={words.narrator} />;
    }
    if (block.kind === "nodeAction" && block.payload.action === "dialogue") {
        return <StorySpeakerDiscMark identity={speaker ?? unknownSpeakerIdentity(words.unassigned)} />;
    }
    const badge = getBlockBadgeInfo(block);
    return <StoryCommandGlyphMark icon={badge.icon} label={badge.label} color={badge.iconColor} />;
}

/** Everything a row needs from outside the plan: the two words, and how a half resolves its names. */
export interface StoryScriptRenderContext {
    readonly words: StoryScriptWords;
    /** How a row of one half resolves its names, including that half's own copy of its scene. */
    readonly lookupsFor: (side: "base" | "head", sceneId: string) => StoryRowLookups;
}

/**
 * What one half draws for one slot of the plan.
 *
 * Here rather than in `useStoryScript` so that "a story slot becomes this drawing" is reachable
 * without a workspace, a version-control service or an IPC round trip - the hook's job is reading
 * two versions, and this one's is turning what it read into rows.
 *
 * A slot the half does not hold answers nothing, and the shell draws its hatched gap instead. That
 * is the whole of "a gap is drawn, never closed" as far as this file is concerned: it never returns
 * a substitute for a line the version it is drawing does not have.
 */
export function renderStoryScriptSlot(
    slot: StoryScriptSlot,
    side: "base" | "head",
    active: boolean,
    context: StoryScriptRenderContext,
): ReactNode {
    if (slot.kind === "change") {
        return <DocumentChangeLine row={slot.row} dense={false} active={active} />;
    }
    if (slot.kind === "scene") {
        const scene = side === "base" ? slot.base : slot.head;
        return scene
            ? <StoryScriptSceneRow scene={scene} tone={slot.tone} active={active} words={context.words} />
            : null;
    }
    const line = side === "base" ? slot.base : slot.head;
    return line
        ? (
            <StoryScriptLineRow
                line={line}
                lookups={context.lookupsFor(side, slot.sceneId)}
                tone={slot.tone}
                active={active}
                words={context.words}
            />
        )
        : null;
}
