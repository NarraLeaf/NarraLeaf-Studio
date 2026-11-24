/**
 * The prose half of the format: the rows the row editor renders as words rather than as a command.
 *
 * Five kinds - narration, dialogue, a note, a choice option, and the blank row - and between them
 * they are 56% of a real project. None of them has a command spec, so this is the one place in the
 * tool that states a line/payload correspondence itself rather than reading one off the registry.
 *
 * ## Printing and reading are one function each, and the printer is checked against the reader
 *
 * {@link proseLineOf} writes a line, {@link buildProseBlock} reads one back. Nothing calls the first
 * without the second: `print` rebuilds every line it writes and keeps it only when the rebuilt
 * payload is the payload it started from (see `print.ts`). So the pair cannot drift - a row whose
 * spelling would not read back becomes an opaque row instead of a silently different one.
 *
 * ## What a row keeps that a line cannot carry
 *
 * A segment's `textId` is the unit every translation of the line is filed under, and its `role` is
 * authored data. Neither appears in the text, so both are taken from the row the line is replacing.
 * A brand new line mints a `textId` and takes the role its shape implies - which is exactly what
 * committing a new row in Studio does.
 *
 * ## Rich text: three marks are spelled, the rest is kept verbatim
 *
 * Bold, italic and colour runs are written as inline tags (`{b}…{/b}`, `{i}…{/i}`,
 * `{color #e04040}…{/color}`, the Script View's spelling; see `inlineMarkup.ts`), and so are inline
 * events, when the lookups carry an {@link InlineEventCodec}: `{char sad fade=0.2}` changes the
 * speaker's look as the typewriter reaches it, `{sound chime}` plays a sound there. A segment carrying
 * any other styling (ruby, size, typing speed, emphasis, an inline pause or variable) has no
 * spelling, so the row stays an opaque `»` line and keeps every mark - restyle it in Studio. Notes are
 * never styled.
 *
 * Comments in English per project convention.
 */

import type {
    StoryBlock,
    StoryNodeActionPayload,
    StoryTextSegment,
} from "@shared/types/story";
import {
    escapeText,
    speakerSplit,
    unescapeText,
    type StoryLineShape,
} from "./shapes";
import {
    escapePlainWithTags,
    readInlineMarkup,
    spellRichSegment,
    type InlineEventReader,
    type InlineEventSpeller,
    type InlineEventTag,
} from "./inlineMarkup";
import { escapeOptionWords } from "./optionConditions";

/** Naming the things a prose line mentions. Only characters, since prose names nothing else. */
export type ProseLookups = {
    /** The display name of a character id, or null when the id answers to nothing. */
    characterName: (characterId: string) => string | null;
    /**
     * Every character answering to a display name: called it, or - when none is - given it as a
     * nickname.
     *
     * A list rather than an id, because a name is neither unique nor guaranteed to exist: two
     * characters may share one (renaming does not check), and a line naming both is ambiguous rather
     * than resolved by whichever came first. The caller reports; this module never guesses.
     */
    charactersNamed: (name: string) => readonly { id: string; name: string }[];
    /**
     * Spelling and reading inline events, which name a look of the speaker and audio assets - names
     * only the command context knows. The printer and the compiler add it (see
     * `createInlineEventCodec`); without it a line with an event stays a `»` row and an event tag is
     * refused.
     */
    inlineEvents?: InlineEventCodec;
};

/**
 * Inline events against one line's speaker. `speakerId` is the character the line is bound to, or
 * null for narration, an option or a speaker with no character behind the name - which can carry a
 * `{sound …}` but not a `{char …}`, the look of nobody.
 */
export type InlineEventCodec = {
    spell: (event: Parameters<InlineEventSpeller>[0], speakerId: string | null) => string | null;
    read: (tag: InlineEventTag, speakerId: string | null) => ReturnType<InlineEventReader>;
};

export type ProseLine = { shape: StoryLineShape; text: string };

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

/**
 * The line a prose row reads as, or null when the row is not prose or cannot be named.
 *
 * Null on a dialogue row whose `characterId` resolves to nothing: a deleted character leaves a
 * dangling binding, which is a real and reachable state, and there is no name to write for it. The
 * row is preserved verbatim instead - printing a blank speaker would read back as narration, and
 * printing the raw id would put an identifier in a file an author's words live in.
 */
export function proseLineOf(block: StoryBlock, lookups: ProseLookups): ProseLine | null {
    if (block.kind === "empty") {
        return { shape: "empty", text: "" };
    }
    if (block.kind === "note") {
        return { shape: "note", text: escapeText(block.payload.text.value, { asProse: true }) };
    }
    if (block.kind !== "nodeAction") {
        return null;
    }
    const payload = block.payload;
    switch (payload.action) {
        case "narration": {
            const words = spokenWords(payload.text, lookups, null);
            return words === null ? null : { shape: "narration", text: words };
        }
        case "choiceOption": {
            // The words only: the printer adds the option's clauses (`optionConditions.ts`), which
            // need condition lookups this module does not have.
            const words = spokenWords(payload.text, lookups, null);
            return words === null ? null : { shape: "option", text: escapeOptionWords(words) };
        }
        case "dialogue": {
            const speaker = payload.characterId
                ? lookups.characterName(payload.characterId)
                : payload.speakerName ?? "";
            if (speaker === null) {
                return null;
            }
            // The speaker is escaped as prose too: a name holding `: ` would otherwise split the
            // line in the wrong place on the way back in.
            const words = spokenWords(payload.text, lookups, payload.characterId ?? null);
            if (words === null) {
                return null;
            }
            return { shape: "dialogue", text: `${escapeText(speaker, { asProse: true })}: ${words}` };
        }
        default:
            // `choice` is a container whose prompt is written by `/menu`, so it is a command row.
            return null;
    }
}

/**
 * The words of a narration, dialogue or option segment as the line spells them: styled runs as inline
 * tags, plain text with a literal tag shape escaped. Null when the styling has no spelling.
 */
function spokenWords(text: StoryTextSegment, lookups: ProseLookups, speakerId: string | null): string | null {
    const codec = lookups.inlineEvents;
    return text.rich
        ? spellRichSegment(text, codec ? event => codec.spell(event, speakerId) : undefined)
        : escapePlainWithTags(text.value);
}

/** The reader for a line's inline event tags, or undefined when nothing can resolve them. */
function eventReader(lookups: ProseLookups, speakerId: string | null): InlineEventReader | undefined {
    const codec = lookups.inlineEvents;
    return codec ? tag => codec.read(tag, speakerId) : undefined;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type ProseBuildResult =
    | { ok: true; block: StoryBlock }
    | { ok: false; reason: "ambiguousSpeaker" | "inlineMarkup"; detail: string };

/**
 * A prose line as the block it means.
 *
 * `previous` is the row this line is replacing, when the line carried an anchor that matched one. It
 * supplies exactly two things - the segment's `textId` and its `role` - and nothing else: every
 * other field is rebuilt from the text, because carrying a field over is right only while the line
 * still says the same thing, and an edit is the one moment it may not.
 */
export function buildProseBlock(
    line: ProseLine,
    context: {
        previous: StoryBlock | null;
        mintId: () => string;
        lookups: ProseLookups;
    },
): ProseBuildResult {
    const { previous, mintId, lookups } = context;
    const base = {
        id: previous?.id ?? mintId(),
        parentId: null,
        childrenIds: [],
        ...(previous?.disabled ? { disabled: true } : {}),
    };

    if (line.shape === "empty") {
        return { ok: true, block: { ...base, kind: "empty", payload: {} } };
    }

    if (line.shape === "note") {
        const text = unescapeText(line.text);
        return {
            ok: true,
            block: { ...base, kind: "note", payload: { text: segment(previous, "note", { value: text }, mintId) } },
        };
    }
    if (line.shape === "narration") {
        const words = readInlineMarkup(line.text, eventReader(lookups, null));
        if (!words.ok) {
            return { ok: false, reason: "inlineMarkup", detail: words.detail };
        }
        const payload: StoryNodeActionPayload = {
            action: "narration",
            text: segment(previous, "narration", words, mintId),
            // Bound to the row like a voice clip: no line spells it, so editing the words keeps it.
            ...(carriedSkipsBehaviours(previousNodeAction(previous, "narration")) ? { skipCharacterBehaviours: true as const } : {}),
        };
        return { ok: true, block: { ...base, kind: "nodeAction", payload } };
    }
    if (line.shape === "option") {
        const words = readInlineMarkup(line.text, eventReader(lookups, null));
        if (!words.ok) {
            return { ok: false, reason: "inlineMarkup", detail: words.detail };
        }
        const carried = previousNodeAction(previous, "choiceOption");
        const payload: StoryNodeActionPayload = {
            action: "choiceOption",
            text: segment(previous, "choiceText", words, mintId),
            // The two conditions ride on the row from here. The caller then replaces each with what
            // the line's clauses say, and drops one the line could have spelled but did not - a
            // blueprint condition has no spelling, so editing an option's words keeps it.
            ...(carried?.action === "choiceOption" && carried.hiddenWhen ? { hiddenWhen: carried.hiddenWhen } : {}),
            ...(carried?.action === "choiceOption" && carried.disabledWhen ? { disabledWhen: carried.disabledWhen } : {}),
        };
        return { ok: true, block: { ...base, kind: "nodeAction", payload } };
    }

    // Dialogue.
    const split = speakerSplit(line.text);
    const speaker = unescapeText(split?.speaker ?? "").trim();
    // The speaker first: a `{char …}` in the words names a look of this character.
    const matches = speaker ? lookups.charactersNamed(speaker) : [];
    if (matches.length > 1) {
        return {
            ok: false,
            reason: "ambiguousSpeaker",
            detail: `${matches.length} characters are called "${speaker}"`,
        };
    }
    const words = readInlineMarkup(split?.words ?? "", eventReader(lookups, matches.length === 1 ? matches[0].id : null));
    if (!words.ok) {
        return { ok: false, reason: "inlineMarkup", detail: words.detail };
    }
    const carried = previousNodeAction(previous, "dialogue");
    const payload: StoryNodeActionPayload = {
        action: "dialogue",
        // A name with a character behind it binds; one without is carried as itself, which is the
        // same rule `/say` follows and the reason a one-off speaker is a valid line rather than an
        // error. Exactly one of the two is ever written.
        ...(matches.length === 1 ? { characterId: matches[0].id } : speaker ? { speakerName: speaker } : {}),
        text: segment(previous, "dialogue", words, mintId),
        // A voice clip is bound to the row, not stated by the line - editing the words keeps it.
        ...(carried?.action === "dialogue" && carried.voiceAssetId ? { voiceAssetId: carried.voiceAssetId } : {}),
        // And so is a line's opt-out from the cast's behaviours.
        ...(carried?.action === "dialogue" && carried.skipCharacterBehaviours ? { skipCharacterBehaviours: true as const } : {}),
    };
    return { ok: true, block: { ...base, kind: "nodeAction", payload } };
}

/**
 * The segment for a rebuilt row: the words from the line, the identity from the row it replaces.
 *
 * A `textId` that survives an edit is the whole point. Every translation of a line is filed under
 * it, so minting a fresh one because someone fixed a typo would unlink each of them with nothing
 * recording what they were. An edit makes a translation STALE, which the localisation system already
 * knows how to say; unlinking it is a loss nothing can undo.
 */
function segment(
    previous: StoryBlock | null,
    role: StoryTextSegment["role"],
    words: { value: string; rich?: StoryTextSegment["rich"] },
    mintId: () => string,
): StoryTextSegment {
    const carried = previousSegment(previous);
    return {
        textId: carried?.textId ?? mintId(),
        // The stored role, not the shape's: `role` is authored data, and a narration row that was
        // given a different role keeps it rather than being normalised back on every read.
        role: carried?.role ?? role,
        value: words.value,
        ...(words.rich ? { rich: words.rich } : {}),
    };
}

function previousSegment(block: StoryBlock | null): StoryTextSegment | null {
    if (!block) {
        return null;
    }
    if (block.kind === "note") {
        return block.payload.text;
    }
    if (block.kind !== "nodeAction") {
        return null;
    }
    const payload = block.payload;
    if (payload.action === "narration" || payload.action === "dialogue" || payload.action === "choiceOption") {
        return payload.text;
    }
    return payload.action === "choice" ? payload.prompt ?? null : null;
}

/** Whether the row a line replaces had opted out of the cast's behaviours. */
function carriedSkipsBehaviours(payload: StoryNodeActionPayload | null): boolean {
    return (payload?.action === "narration" || payload?.action === "dialogue") && payload.skipCharacterBehaviours === true;
}

function previousNodeAction(block: StoryBlock | null, action: string): StoryNodeActionPayload | null {
    if (block?.kind !== "nodeAction" || block.payload.action !== action) {
        return null;
    }
    return block.payload;
}
