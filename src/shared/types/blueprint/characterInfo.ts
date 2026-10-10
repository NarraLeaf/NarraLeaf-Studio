/**
 * The slice of a character a blueprint can read.
 *
 * A character lives in the editor's own model (`services/character`), which blueprints must not
 * depend on: the graph runs inside a shipped game, where that model does not exist. What crosses the
 * boundary is this flat record, mirrored into blueprint global state from the Dev Mode bundle's
 * character table.
 *
 * The colour is the one place the two subsystems genuinely disagree. A character profile stores a
 * *string* - a hex literal (`#40a8c4`), or a `nlbrand:` link at the project palette; a blueprint
 * colour pin carries {@link BlueprintRGBAColor}. Converting here - once, at the boundary - is
 * deliberate: every consumer downstream then sees the pin type it declares, and nobody writes a
 * second hex parser or a second link resolver.
 *
 * Comments in English per project convention.
 */

import { resolveBrandColorValue } from "@shared/brand/brandRegistry";
import {
    normalizeBlueprintImageAssetValue,
    normalizeBlueprintRGBAColor,
    type BlueprintImageAsset,
    type BlueprintRGBAColor,
} from "./valueTypes";

export type BlueprintCharacterInfo = {
    id: string;
    /** Author-facing display name. Empty when the character is unnamed - never falls back to `id`, which is a UUID. */
    name: string;
    /**
     * The author's accent colour, already in pin shape. Null when the character has no colour set,
     * which is a different thing from "white" - see {@link blueprintCharacterColorOrDefault} for
     * what a non-nullable colour pin does with it.
     */
    color: BlueprintRGBAColor | null;
    /** The character's default dialog avatar, or null when it has none. */
    avatar: BlueprintImageAsset | null;
};

function trimmed(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * A profile's hex colour as a colour pin sees it, or null when unset.
 *
 * The parse is `normalizeBlueprintRGBAColor` verbatim - the same call
 * `BlueprintColorValueControl` makes - so what the author picked in the colour field and what a
 * blueprint reads can never drift apart. That function has no failure mode (an unparseable string
 * normalizes to the default), so the *only* signal available here is presence: an empty or
 * non-string value is null, anything else is a colour.
 *
 * That absence of a failure mode is why the brand link has to come off *here* rather than being left
 * to the parse: handed `nlbrand:primary`, `normalizeBlueprintRGBAColor` does not report a problem,
 * it returns opaque white - so a character pointed at the project palette would read out of a
 * blueprint as white, with nothing to say it had ever been anything else. Resolving first makes the
 * pin carry the colour the palette says, and a link the palette cannot answer for falls to null,
 * which is the same "no colour" a character without one has.
 */
export function toBlueprintCharacterColor(value: unknown): BlueprintRGBAColor | null {
    const raw = typeof value === "string" ? resolveBrandColorValue(value) : null;
    return raw ? normalizeBlueprintRGBAColor(raw) : null;
}

/**
 * What a non-nullable `RGBAColor` pin yields for a character with no colour.
 *
 * Opaque white, which is `normalizeBlueprintRGBAColor`'s own default and therefore what every other
 * colour pin in the system falls back to. A nullable colour would need a new pin type; the round
 * that added these nodes deliberately did not add one.
 */
export function blueprintCharacterColorOrDefault(color: BlueprintRGBAColor | null | undefined): BlueprintRGBAColor {
    return color ?? normalizeBlueprintRGBAColor(undefined);
}

/**
 * The palette entry a speaking character with no colour of their own is painted in. It is the colour
 * a nametag is authored in when nobody has said otherwise - the skeleton's, and every theme drawn
 * from the seeded palette - so a nametag that tints itself from the speaker keeps that look for
 * them instead of turning white.
 */
const SPEAKER_FALLBACK_COLOR = "nlbrand:primary";

/**
 * The colour a dialogue line's speaker is painted in, as `Get Speaker Color` reads it: the
 * character's own, else the palette's primary, and null on a narration line.
 *
 * This is the one caller that decides the colour pin's fallback (see
 * {@link blueprintCharacterColorOrDefault}), and it decides for the palette rather than white: the
 * value exists to paint a name, and a name painted white because its character was made without a
 * colour reads as a broken theme. A named line whose speaker is not in the character table is
 * painted the same way. Narration stays null - there is no name to paint, and whatever else tints
 * itself from the speaker can still tell narration apart. Resolved per line, so a palette edited in
 * Dev Mode is followed from the next line; a palette with no primary answers null, as narration does.
 */
export function blueprintSpeakerColor(
    speaker: BlueprintCharacterInfo | null,
    isNarrator: boolean,
): BlueprintRGBAColor | null {
    if (isNarrator) {
        return null;
    }
    return speaker?.color ?? toBlueprintCharacterColor(SPEAKER_FALLBACK_COLOR);
}

/** Defensive read of one mirrored table entry. Returns null for anything that is not a usable record. */
export function normalizeBlueprintCharacterInfo(value: unknown): BlueprintCharacterInfo | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const raw = value as { id?: unknown; name?: unknown; color?: unknown; avatar?: unknown };
    const id = trimmed(raw.id);
    if (!id) {
        return null;
    }
    return {
        id,
        name: trimmed(raw.name),
        // Accepts both shapes on purpose: the mirror writes an already-parsed RGBA record, but a
        // host that mirrored the raw profile hex still resolves correctly.
        color: raw.color === null || raw.color === undefined ? null : toBlueprintCharacterColorValue(raw.color),
        avatar: normalizeBlueprintImageAssetValue(raw.avatar),
    };
}

function toBlueprintCharacterColorValue(value: unknown): BlueprintRGBAColor | null {
    return typeof value === "string" ? toBlueprintCharacterColor(value) : normalizeBlueprintRGBAColor(value);
}

/**
 * Build one table entry from the fields a `DevModeCharacterSummary` carries.
 *
 * `color` is read as `unknown` rather than typed: it is an additive field on the summary, and this
 * helper must keep compiling (and keep degrading to "no colour") on a bundle that predates it.
 */
export function toBlueprintCharacterInfo(input: {
    id: unknown;
    name?: unknown;
    color?: unknown;
    avatarAssetId?: unknown;
}): BlueprintCharacterInfo | null {
    const id = trimmed(input.id);
    if (!id) {
        return null;
    }
    return {
        id,
        name: trimmed(input.name),
        color: toBlueprintCharacterColor(input.color),
        avatar: normalizeBlueprintImageAssetValue(trimmed(input.avatarAssetId) || null),
    };
}

/** Look one character up in a mirrored table. Null when the table is missing, or the id is not in it. */
export function findBlueprintCharacterInfo(table: unknown, characterId: string): BlueprintCharacterInfo | null {
    const id = trimmed(characterId);
    if (!id || !Array.isArray(table)) {
        return null;
    }
    for (const entry of table) {
        const info = normalizeBlueprintCharacterInfo(entry);
        if (info && info.id === id) {
            return info;
        }
    }
    return null;
}
