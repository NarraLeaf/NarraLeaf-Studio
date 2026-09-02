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
 * ## Rich text is not spelled, deliberately
 *
 * A segment carrying `rich` runs has styling this format has no syntax for, so it fails the echo
 * check and is preserved verbatim. That is a coverage limit rather than a loss: the row keeps every
 * mark, and the way to restyle it is Studio, which is the only surface that offers marks at all.
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

/** Naming the things a prose line mentions. Only characters, since prose names nothing else. */
export type ProseLookups = {
    /** The display name of a character id, or null when the id answers to nothing. */
    characterName: (characterId: string) => string | null;
    /**
     * Every character answering to a display name.
     *
     * A list rather than an id, because a name is neither unique nor guaranteed to exist: two
     * characters may share one (renaming does not check), and a line naming both is ambiguous rather
     * than resolved by whichever came first. The caller reports; this module never guesses.
     */
    charactersNamed: (name: string) => readonly { id: string; name: string }[];
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
        case "narration":
            return { shape: "narration", text: escapeText(payload.text.value, { asProse: true }) };
        case "choiceOption":
            return { shape: "option", text: escapeText(payload.text.value, { asProse: true }) };
        case "dialogue": {
            const speaker = payload.characterId
                ? lookups.characterName(payload.characterId)
                : payload.speakerName ?? "";
            if (speaker === null) {
                return null;
            }
            // The speaker is escaped as prose too: a name holding `: ` would otherwise split the
            // line in the wrong place on the way back in.
            const words = escapeText(payload.text.value, { asProse: true });
            return { shape: "dialogue", text: `${escapeText(speaker, { asProse: true })}: ${words}` };
        }
        default:
            // `choice` is a container whose prompt is written by `/menu`, so it is a command row.
            return null;
    }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type ProseBuildResult =
    | { ok: true; block: StoryBlock }
    | { ok: false; reason: "ambiguousSpeaker"; detail: string };

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

    const text = unescapeText(line.text);
    if (line.shape === "note") {
        return {
            ok: true,
            block: { ...base, kind: "note", payload: { text: segment(previous, "note", text, mintId) } },
        };
    }
    if (line.shape === "narration") {
        const payload: StoryNodeActionPayload = {
            action: "narration",
            text: segment(previous, "narration", text, mintId),
        };
        return { ok: true, block: { ...base, kind: "nodeAction", payload } };
    }
    if (line.shape === "option") {
        const carried = previousNodeAction(previous, "choiceOption");
        const payload: StoryNodeActionPayload = {
            action: "choiceOption",
            text: segment(previous, "choiceText", text, mintId),
            // The two conditions an option may carry have no spelling on the line, so they ride on
            // the row: editing an option's words must not clear the check that hides it.
            ...(carried?.action === "choiceOption" && carried.hiddenWhen ? { hiddenWhen: carried.hiddenWhen } : {}),
            ...(carried?.action === "choiceOption" && carried.disabledWhen ? { disabledWhen: carried.disabledWhen } : {}),
        };
        return { ok: true, block: { ...base, kind: "nodeAction", payload } };
    }

    // Dialogue.
    const split = speakerSplit(line.text);
    const speaker = unescapeText(split?.speaker ?? "").trim();
    const words = unescapeText(split?.words ?? "");
    const matches = speaker ? lookups.charactersNamed(speaker) : [];
    if (matches.length > 1) {
        return {
            ok: false,
            reason: "ambiguousSpeaker",
            detail: `${matches.length} characters are called "${speaker}"`,
        };
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
    value: string,
    mintId: () => string,
): StoryTextSegment {
    const carried = previousSegment(previous);
    return {
        textId: carried?.textId ?? mintId(),
        // The stored role, not the shape's: `role` is authored data, and a narration row that was
        // given a different role keeps it rather than being normalised back on every read.
        role: carried?.role ?? role,
        value,
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

function previousNodeAction(block: StoryBlock | null, action: string): StoryNodeActionPayload | null {
    if (block?.kind !== "nodeAction" || block.payload.action !== action) {
        return null;
    }
    return block.payload;
}
