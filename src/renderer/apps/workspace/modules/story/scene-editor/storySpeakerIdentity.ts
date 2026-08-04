import type { CSSProperties } from "react";
import { accentForeground } from "@shared/constants/accent";

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
 * The narrator deliberately takes no colour (§4): it is a voice, not a member of the cast, and a
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

/**
 * Where a speaker's colour comes from — and the reason this is a union rather than one hex.
 *
 * `"author"` is a colour somebody chose for this character in the project, and it is used **exactly
 * as chosen**, on both themes. That is the whole point of the field existing: an author has an
 * opinion about their lead's colour, and an editor that answers a chosen `#c94f7c` with its own
 * idea of what that hue should look like has not honoured the choice, it has taken a hint from it.
 *
 * `"name"` is the fallback for the (many) characters nobody has coloured: the name hash, run through
 * the fixed saturation/lightness ladder in `styles.css` so an uncoloured cast still reads as one
 * family and still flips with the theme.
 *
 * `"none"` is the narrator and the unresolvable — neutral grey by rule (§4).
 */
export type StorySpeakerPaint =
    | { source: "author"; hex: string }
    | { source: "name"; hue: number }
    | { source: "none" };

/** The CSS custom property a name-derived speaker publishes its hue on. */
export const STORY_SPEAKER_HUE_VAR = "--nl-speaker-h";

/**
 * The class that turns a hue into the three speaker colours (disc fill, disc ink, name ink).
 *
 * Those colours live in `styles.css` and are chosen by a `prefers-color-scheme` media query, NOT
 * computed here. That is not a style preference: Electron updates the media query's value when
 * `nativeTheme.themeSource` changes but never dispatches a `change` event, so anything that mirrors
 * the theme in JS silently stops updating the first time the author switches it. Only the hue —
 * which is the same on both themes — crosses into JS.
 *
 * An author's own colour is a different case entirely and IS written from JS, because it does not
 * vary by theme: it is one colour, chosen once, and the same on both. It arrives as an inline
 * override of the same three variables, so every surface below goes on reading one set of names and
 * never has to ask where the colour came from.
 */
export const STORY_SPEAKER_CLASS = "nl-speaker";

/** Marks a speaker that takes the neutral ramp instead of a colour of its own. */
const STORY_SPEAKER_NEUTRAL_CLASS = "nl-speaker-neutral";

/**
 * The class + style that paint one speaker — the single seam every coloured surface goes through.
 *
 * Returning both together is what stops the three call sites (disc, rule, nametag) from each
 * re-deriving "hue or hex or neutral" and drifting: §3.3 promises one character is one colour in
 * every position, and the cheapest way to keep a promise like that is to leave only one place where
 * it can be broken.
 */
export function storySpeakerPaint(paint: StorySpeakerPaint): { className: string; style: CSSProperties } {
    if (paint.source === "author") {
        return {
            className: STORY_SPEAKER_CLASS,
            style: {
                "--nl-speaker-disc": paint.hex,
                // Ink derived from the chosen colour's own luminance, not from the theme — a pale
                // pick needs dark ink on both themes and a deep one needs light ink on both. This is
                // the same rescue `--nl-on-primary` performs for the user's accent, and for the same
                // reason: "any colour" is only nominally true if the glyph on it can vanish.
                "--nl-speaker-ink": `rgb(${accentForeground(paint.hex)})`,
                "--nl-speaker-name": paint.hex,
            } as CSSProperties,
        };
    }
    if (paint.source === "name") {
        return {
            className: STORY_SPEAKER_CLASS,
            style: { [STORY_SPEAKER_HUE_VAR]: paint.hue } as CSSProperties,
        };
    }
    return { className: `${STORY_SPEAKER_CLASS} ${STORY_SPEAKER_NEUTRAL_CLASS}`, style: {} };
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
    paint: StorySpeakerPaint;
};

/**
 * The identity of a named character, with or without artwork.
 *
 * `color` is the project's own — passed only when it is one the editor can actually paint with (see
 * `isReadableAccentColor`, applied by the caller). When it is absent the name hash stands in, so a
 * cast nobody has coloured still reads as a cast rather than as a column of grey.
 */
export function characterSpeakerIdentity(name: string, options: { hasPortrait: boolean; color?: string }): StorySpeakerIdentity {
    return {
        kind: options.hasPortrait ? "portrait" : "disc",
        name,
        paint: options.color
            ? { source: "author", hex: options.color }
            : { source: "name", hue: storySpeakerHash(name) },
    };
}

/** The narrator: hollow, neutral, and the only thing that is ever either. */
export function narratorSpeakerIdentity(name: string): StorySpeakerIdentity {
    return { kind: "ring", name, paint: { source: "none" } };
}

/** A speaker nothing is known about yet — a dialogue row with no one assigned, or a dangling id. */
export function unknownSpeakerIdentity(name: string): StorySpeakerIdentity {
    return { kind: "disc", name, paint: { source: "none" } };
}
