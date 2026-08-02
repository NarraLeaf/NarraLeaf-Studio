import type { StoryBlock } from "@shared/types/story";

/**
 * Turning a wall of pasted prose into story rows.
 *
 * The wizard this serves asks the author exactly one question worth asking: **who is speaking each
 * line**. Everything else - which character a name means, whether a name is a name at all, what the
 * separator is - is either inferred and shown for correction, or remembered from the last time.
 *
 * The separator is a means, not the question. An author who is handed "what is your separator?" as a
 * first prompt has to reverse-engineer their own file; an author who is handed a parsed preview and a
 * wrong guess just fixes the guess. So {@link inferPasteSeparator} always runs first and the control
 * that changes it sits above a live preview.
 */

/**
 * The separators worth guessing, in the order {@link inferPasteSeparator} prefers them on a tie.
 *
 * `none` is not a fallback for "nothing matched" - it is the author's assertion that the text has no
 * speakers at all, which is the correct reading of a novel excerpt and is why it is offered as a
 * first-class choice rather than left to a regex that matches nothing.
 */
export type PasteSeparatorKind =
    | "none"
    /** `Name: text` - the ASCII colon. */
    | "colon"
    /** `Name：text` - the fullwidth colon, which is what a Chinese manuscript actually uses. */
    | "fullwidthColon"
    /** `Name - text` / `Name — text`. Requires surrounding space, or every hyphenated word matches. */
    | "dash"
    /** `【Name】text` */
    | "lenticular"
    /** `「Name」text` */
    | "cornerBracket"
    /** `Name\ttext` - what a spreadsheet column pair pastes as. */
    | "tab"
    | "regex";

export type PasteSeparatorChoice =
    | { kind: Exclude<PasteSeparatorKind, "regex"> }
    /**
     * A custom pattern, applied per line. Must carry named groups `speaker` and `text`; a pattern that
     * does not compile, or does not name both, is reported rather than thrown - the author is typing
     * it live, so every intermediate state is invalid and none of them may break the wizard.
     */
    | { kind: "regex"; source: string };

export type PasteSeparatorProblem = "invalidRegex" | "missingGroups";

/** One pasted line after splitting. Blank lines never produce one - they are paragraph breaks. */
export type PastedLine = {
    /** 0-based over the non-blank lines, so it indexes {@link PasteSplit.lines} directly. */
    index: number;
    /** The line as pasted, before the separator was applied. Kept for the "not a speaker" undo path. */
    raw: string;
    /** Present only when the separator matched. Trimmed. */
    speaker?: string;
    /** The line minus its speaker label, trimmed. Equals `raw` when there is no speaker. */
    text: string;
};

export type PasteSpeakerTally = {
    label: string;
    count: number;
    /** Line indices, so the preview can show which lines a mapping decision affects. */
    lineIndices: number[];
};

export type PasteSplit = {
    lines: PastedLine[];
    /** Distinct speaker labels in first-appearance order. First appearance, not frequency: it matches
     *  reading order, so the table does not reshuffle itself as the author changes the separator. */
    speakers: PasteSpeakerTally[];
    /** Lines the separator did not match. */
    narrationCount: number;
    /** Set when a `regex` choice could not be used; the split then falls back to `none`. */
    problem?: PasteSeparatorProblem;
};

/**
 * What a speaker label becomes.
 *
 * `tempSpeaker` is the default for a label that matches no character, deliberately. Creating a
 * character is a side effect on a different part of the project, and a wizard that did it by default
 * would turn one paste of a 400-line chapter into forty characters the author never asked for.
 * `NarraLeaf` renders a bare `speakerName` perfectly well, so the safe default is also a correct one.
 */
export type SpeakerMappingTarget =
    | { kind: "character"; characterId: string }
    | { kind: "createCharacter" }
    | { kind: "tempSpeaker" }
    /** The label was a false positive; it folds back into the line and the row becomes narration. */
    | { kind: "notASpeaker" };

/**
 * Per-project memory of the two decisions the author should only make once.
 *
 * Keyed by the **lower-cased, trimmed** label, because the same speaker turns up as `林`, `林 ` and
 * `林：` across a manuscript's chapters and none of those differences are decisions.
 *
 * Lives in `PanelStateService` (`.nlstudio/services/panel_state.json`) - per project, outside the
 * versioned tree, and exempt from the freeze latch. That last part matters: remembering a mapping is
 * not an edit to the project, so it must keep working on a frozen (historical) revision.
 */
export type StoryPasteMemory = {
    version: 1;
    speakers: Record<string, SpeakerMappingTarget>;
    /** Author-named separator presets, newest first. The built-ins are not stored here. */
    separators: { name: string; choice: PasteSeparatorChoice }[];
};

export const STORY_PASTE_MEMORY_PANEL_ID = "story:editor:paste-memory";

export type PastePlanRow =
    | { kind: "narration"; text: string }
    | {
          kind: "dialogue";
          text: string;
          characterId?: string;
          speakerName?: string;
          /** Set when this row waits on a character the confirm step still has to create. */
          pendingCharacterName?: string;
      };

export type PastePlan = {
    rows: PastePlanRow[];
    /** Distinct names the confirm step must create, in first-appearance order. */
    charactersToCreate: string[];
    counts: { dialogue: number; narration: number };
};

export type PastePlanInput = {
    split: PasteSplit;
    /** Keyed the same way {@link StoryPasteMemory.speakers} is - lower-cased and trimmed. */
    mappings: Record<string, SpeakerMappingTarget>;
};

/**
 * The shape a plain (no-wizard) paste lands in, taken from wherever the caret is.
 *
 * `dialogue` carries the anchor row's own speaker so a run of lines pasted mid-conversation stays in
 * that conversation. That is the whole of the gesture's cleverness, and it is deliberately all of it:
 * a plain paste that started guessing speakers would be the wizard with no way to correct it.
 */
export type PlainPasteAnchor =
    | { kind: "narration" | "note" | "none" }
    | { kind: "dialogue"; characterId?: string; speakerName?: string };

export type StoryPasteIdFactory = () => string;

export type MaterializeContext = {
    /** Must yield UUID v4 - `assertValidStoryEntityId` rejects anything else, and only on next load. */
    generateId: StoryPasteIdFactory;
    /** Name -> id for the characters the confirm step created, before materializing. */
    createdCharacterIds: Record<string, string>;
};

/** How many rows a paste may add before it has to be confirmed even without the wizard. */
export const STORY_PASTE_CONFIRM_THRESHOLD = 300;

/**
 * A pasted Story Script file, detected by its header.
 *
 * Its `#data` footer is hundreds of lines of JSON, so treating one as prose would bury a scene under
 * its own serialization. The paste path refuses instead and points at Import Script - which is the
 * one thing that can actually read it.
 */
export const STORY_SCRIPT_HEADER = "#nlscript";

export type StoryPasteRoute =
    | { kind: "blocks" }
    | { kind: "single" }
    | { kind: "wizard"; text: string }
    | { kind: "plain"; text: string }
    | { kind: "scriptFile" };

export type MaterializedPaste = { blocks: StoryBlock[] };
