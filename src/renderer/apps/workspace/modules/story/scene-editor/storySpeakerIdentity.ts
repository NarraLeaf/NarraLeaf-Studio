import type { CSSProperties } from "react";

/**
 * Who is speaking a row, as a colour and a glyph — the one place the gutter's identity rules live.
 *
 * The gutter is a "who is speaking" column, not a "what kind of row is this" column (gutter 规范 §0),
 * and three fill states carry the whole distinction (§3.1):
 *
 *  - **solid** — a specific person. A portrait when there is one, a colour disc bearing their first
 *    grapheme when there is not. Both are solid, which is what keeps "solid = somebody" true without
 *    exception; a character with no artwork must NEVER fall back to the hollow ring, because that
 *    would put a person and a disembodied voice in the same shape and void the whole vocabulary.
 *  - **hollow** — a voice with no face (the narrator). Its only occupant, forever.
 *  - **bare stroke** — not in the script at all (a directive). Owned by
 *    {@link StoryRowGutterMark}, not by this module: it has no speaker to identify.
 *
 * The narrator deliberately takes no hue (§4): it is a voice, not a member of the cast, and a
 * narrator that competed for a colour with the characters would read as one of them.
 */

/** Neutral CJK-safe fallback when a speaker has no name at all yet. */
const UNNAMED_INITIAL = "?";

/**
 * FNV-1a over the display name → hue. Verbatim from 规范 §4, and it must STAY verbatim: the promise
 * is that the same name is the same colour in every project, so an author who copies a scene into
 * another Studio project sees the cast they left. Any change here silently recolours every script
 * ever written.
 */
export function storySpeakerHash(name: string): number {
    let hash = 2166136261;
    for (let index = 0; index < name.length; index += 1) {
        hash ^= name.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash) % 360;
}

/** Hex → hue (0–359), or `null` when the string is not a colour this can read. */
function hexHue(hex: string): number | null {
    const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
    if (!match) {
        return null;
    }
    const full = match[1].length === 3 ? match[1].replace(/./g, char => char + char) : match[1];
    const r = parseInt(full.slice(0, 2), 16) / 255;
    const g = parseInt(full.slice(2, 4), 16) / 255;
    const b = parseInt(full.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const span = max - min;
    if (span === 0) {
        // A grey has no hue to take. Returning 0 would silently mean "red", so the caller is told
        // there is nothing here and falls back to the name hash.
        return null;
    }
    const hue = max === r
        ? ((g - b) / span + (g < b ? 6 : 0))
        : max === g
            ? (b - r) / span + 2
            : (r - g) / span + 4;
    return Math.round(hue * 60) % 360;
}

/**
 * The hue a character's marks are built from: the hue of the colour the author picked, else the hash
 * of their name.
 *
 * The manual colour is read for its HUE rather than used as the colour itself, which is what keeps
 * §3.3 (one character, one colour, everywhere) and §7 (every colour goes through a token that flips
 * with the theme) true at the same time. A hex pinned into the disc fill would be right on one theme
 * and wrong on the other — the disc's ink is derived from the fill, so an author's mid-tone pick
 * would leave an unreadable first letter on whichever theme it did not suit. Taking the hue keeps
 * their choice — the thing they actually chose — and lets the ladder in the stylesheet do the rest.
 */
export function storySpeakerHue(name: string, color?: string): number {
    const manual = color ? hexHue(color) : null;
    return manual ?? storySpeakerHash(name);
}

/**
 * The grapheme a faceless character's disc bears (§5): one CJK character, or up to two Latin letters.
 *
 * Verbatim from the name, with no romanisation anywhere: an author who writes 绫波丽 gets 绫. Turning
 * it into "L" would be the editor deciding it knows a better name for their character than they do.
 *
 * `Array.from` rather than `slice`, so an emoji or any other astral-plane first character survives
 * as one glyph instead of being cut in half into a replacement box.
 */
export function storySpeakerInitial(name: string): string {
    const graphemes = Array.from(name.trim());
    const first = graphemes[0];
    if (!first) {
        return UNNAMED_INITIAL;
    }
    // Latin runs narrow, so two letters fill the disc the way one CJK glyph does.
    return /[A-Za-z]/.test(first) ? graphemes.slice(0, 2).join("") : first;
}

/** The CSS custom property every speaker-coloured surface reads its hue from. */
export const STORY_SPEAKER_HUE_VAR = "--nl-speaker-h";

/**
 * The class that turns a hue into the four speaker colours (disc fill, disc ink, name ink, rule).
 *
 * The colours themselves live in `styles.css` and are chosen by a `prefers-color-scheme` media query,
 * NOT computed here. That is not a style preference: Electron updates the media query's value when
 * `nativeTheme.themeSource` changes but never dispatches a `change` event, so anything that mirrors
 * the theme in JS silently stops updating the first time the author switches it. Only the hue — which
 * is the same on both themes — crosses into JS.
 */
export const STORY_SPEAKER_CLASS = "nl-speaker";

/** Style carrying one speaker's hue to the marks and the name that share it. */
export function storySpeakerHueStyle(hue: number): CSSProperties {
    return { [STORY_SPEAKER_HUE_VAR]: hue } as CSSProperties;
}

/**
 * Everything the gutter and the nametag need about one speaker, resolved once per row.
 *
 * `kind` is the fill state (§3.1), and it is deliberately decided here rather than at each drawing
 * site: "portrait or disc" is a question about the SPEAKER (do they have artwork), and letting each
 * surface answer it for itself is exactly how a character ended up hollow in one place and solid in
 * another.
 */
export type StorySpeakerIdentity = {
    kind: "portrait" | "disc" | "ring";
    /** Display name — the disc's grapheme comes from it, and it is what the row's nametag prints. */
    name: string;
    /** `null` for the narrator, which takes neutral grey rather than competing for a hue (§4). */
    hue: number | null;
};

/** The identity of a named character, with or without artwork. */
export function characterSpeakerIdentity(name: string, options: { hasPortrait: boolean; color?: string }): StorySpeakerIdentity {
    return {
        kind: options.hasPortrait ? "portrait" : "disc",
        name,
        hue: storySpeakerHue(name, options.color),
    };
}

/** The narrator: hollow, neutral, and the only thing that is ever either. */
export function narratorSpeakerIdentity(name: string): StorySpeakerIdentity {
    return { kind: "ring", name, hue: null };
}
