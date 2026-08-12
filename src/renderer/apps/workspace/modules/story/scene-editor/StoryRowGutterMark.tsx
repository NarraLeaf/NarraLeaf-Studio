import { Quote, type LucideIcon } from "lucide-react";
import { HeadThumbnail } from "@/apps/workspace/modules/characters/editors/components/HeadThumbnail";
import type { NormalizedCrop } from "@/lib/utils/headCrop";
import {
    storySpeakerInitial,
    storySpeakerPaint,
    type StorySpeakerIdentity,
} from "./storySpeakerIdentity";

/**
 * The gutter's mark vocabulary — every shape the "who is speaking" column can draw, and nothing else.
 *
 * The column answers one question (gutter 规范 §0): **有脸的是剧本，有图标的是机器.** Three material
 * channels carry it, and they may never trade places (§3.2):
 *
 *  - a character is a **picture** — a portrait, or a colour disc bearing their first grapheme;
 *  - the narrator is a **hollow ring** — around a quote, drawn by the same hand as everything else here;
 *  - a directive is a **bare line drawing** — no container at all, in its category's hue.
 *
 * What keeps the last two apart is the container, not the ink inside it: hollow is the narrator's and
 * nothing else's, and a directive is never given a container of any kind. That is what lets a
 * directive carry colour without joining the script — a coloured mark still has to be a picture or a
 * ring to read as a voice, and this one is neither.
 */

/**
 * The column's width, and the size every mark is drawn at (§6).
 *
 * Fixed rather than following the reading density, unlike the row's box height and type size. The
 * gutter is an alignment device: its whole value is that every mark in a scene sits on one vertical
 * line at one weight, and a column that resized would be re-tuning the optical centring the marks
 * are hand-aligned to at each tier. Density changes how much room the WORDS get; the column beside
 * them is furniture and holds still.
 */
export const STORY_MARK_PX = 26;

/**
 * A directive's glyph is drawn smaller than a face, on purpose.
 *
 * A face fills its box (it is a picture, and a picture cropped smaller is just a smaller picture); a
 * line icon at 26px in a column of 26px faces reads as the loudest thing on the screen, when it is
 * the thing that is *not* the script. 18px in a 26px slot gives it the same optical weight as a
 * portrait without giving it the same presence.
 */
const COMMAND_GLYPH_PX = 18;

/**
 * The stroke every drawn glyph in the column shares (§6) — **fix it now**.
 *
 * lucide's own default is 2. The number itself matters less than the fact that there is exactly one:
 * once a scene shows eight kinds of directive down one column, a single icon at a different weight
 * is visible as a defect in the column rather than as a property of that icon, and it is far cheaper
 * to pin the value than to notice the drift later and re-audit every command. The narrator's quote
 * takes it too — it is smaller than a directive's glyph, but it is the same hand.
 */
const COMMAND_STROKE = 1.6;

/**
 * The width of a paragraph's continuation rule.
 *
 * A hairline, the same weight as the nesting connector's (`w-px`). It was widened to 2 once, on the
 * argument that a line carrying a speaker's colour needs area before the hue reads as attribution
 * rather than as a suggestion — and that was overruled on sight: at 2 it is visibly the heaviest line
 * in the editor, and a column of them turns a page of dialogue into a page of bars. Every line in
 * this editor is one hairline; this one is not the exception. If the hue reads too faintly, spend it
 * on the rule's opacity, not on its width.
 *
 * Square ends, no radius: the rule is drawn per row but has to read as one line, so consecutive rows
 * butt flush. A radius on each segment pinches it at every row boundary — a seam per row, which is
 * exactly what a single line must not have.
 */
const CONTINUATION_RULE_PX = 1;

/**
 * The vertical padding a row's content column holds (`py-1`), in px.
 *
 * It lives here, next to the one thing that has to CANCEL it, and the row imports it back for its
 * connector maths — so the padding and the two things measured against it can never drift apart.
 *
 * The continuation rule is the only occupant of this column that spans rows, which makes it the only
 * one that can see this padding at all. Everything else sits inside one row and is glad of the air;
 * the rule was stopping 4px short at both ends of every row, so a run of three lines drew three
 * separate dashes instead of one line.
 */
export const STORY_ROW_CONTENT_PAD_PX = 4;

/**
 * The hairline around a portrait.
 *
 * Wider than the narrator ring's, and that is an optical match rather than a mismatch. The ring
 * encloses empty space, so its stroke has the row's own background on both sides of it and reads at
 * its full weight; the portrait's has a photograph pressed against its inside edge — busy, and often
 * light — which eats into it from one side. The same number on both would leave the frame around a
 * face the fainter of the two.
 *
 * Spent from the inside under `border-box`, so the OUTER circle is still {@link STORY_MARK_PX} and
 * the column's alignment is not paid for by the frame.
 */
const PORTRAIT_STROKE_PX = 2;

/**
 * The gutter cell: one mark, held on the row's FIRST line, in a slot the row always reserves.
 *
 * Two rules meet here.
 *
 * §8 — **容器只作为状态存在.** At rest a mark wears nothing at all: no plate, no border, no tint. The
 * soft disc that surfaces under it on hover or selection is therefore never decoration; it is the
 * only thing that box ever says, and it says "you are here". A permanent container would have said
 * that on every row at once, which is to say nothing.
 *
 * §6 — a mark aligns to the first line, not to the middle of the row. A wrapped paragraph must keep
 * its face level with the words that name it rather than drifting to the centre of three lines, so
 * the mark is centred inside a box exactly one line tall and the cell grows below it.
 *
 * `stretch` is the continuation rule's exception, and the only one: it is a line rather than a mark,
 * and it has to run the full height of the row so consecutive rows meet with no seam. It also takes
 * no state backdrop — the disc exists to sit BEHIND a mark, and a continuation has none, so on those
 * rows it drew a circle floating in the middle of a line with nothing in it.
 */
export function StoryGutterCell(props: {
    children: React.ReactNode;
    /** Draw the state backdrop: the pointer is on this row, or it is the active one. */
    active?: boolean;
    /** Read by assistive tech as decoration when the row's words already say who is speaking. */
    decorative?: boolean;
    /** Let the content fill the row's height instead of sitting on its first line. */
    stretch?: boolean;
}) {
    return (
        <span
            aria-hidden={props.decorative}
            className="relative flex shrink-0 flex-col items-center self-stretch"
            style={{ width: STORY_MARK_PX, minHeight: "var(--nl-story-row-box)" }}
        >
            {props.active && !props.stretch ? (
                <span
                    aria-hidden
                    className="pointer-events-none absolute left-0 rounded-full bg-fill-subtle"
                    style={{
                        width: STORY_MARK_PX,
                        height: STORY_MARK_PX,
                        // Centred on the first line, exactly where the mark it sits behind is.
                        top: `calc((var(--nl-story-row-box) - ${STORY_MARK_PX}px) / 2)`,
                    }}
                />
            ) : null}
            {props.stretch ? props.children : (
                <span
                    className="relative flex w-full shrink-0 items-center justify-center"
                    style={{ height: "var(--nl-story-row-box)" }}
                >
                    {props.children}
                </span>
            )}
        </span>
    );
}

/**
 * A character with artwork: their portrait, cropped to a circle, inside the same hairline the
 * narrator's ring wears.
 *
 * The stroke is not what makes the narrator's mark hollow — being EMPTY is. A hairline around a
 * photograph reads as the edge of the crop, the way a rule under a caption reads as part of the
 * caption; what §3.1 rests on is that you can see through one mark and not the other, and a portrait
 * fills its circle completely. Sharing the stroke buys two things instead: a pale sprite (and half of
 * them are pale, being lit for a bright stage) stops bleeding into the editor surface and losing its
 * shape, and all three marks close on the same 26px silhouette rather than two hard edges and one
 * soft one.
 *
 * Its weight is {@link PORTRAIT_STROKE_PX}, and its colour is the SPEAKER'S — the same one their
 * disc would have been filled with, their name is printed in, and their paragraph's rule carries
 * (§3.3). A neutral hairline said only "this is a mark"; the row already knew that. Saying whose it
 * is instead means a portrait too small to recognise still identifies its speaker, and it puts the
 * one row type that had no colour anywhere on it back into the scheme.
 */
export function StorySpeakerPortraitMark(props: { identity: StorySpeakerIdentity; url: string; frame?: NormalizedCrop; showingSprite: boolean }) {
    const paint = storySpeakerPaint(props.identity.paint);
    return (
        <span
            className={`${paint.className} block shrink-0 overflow-hidden rounded-full bg-fill-subtle`}
            style={{
                ...paint.style,
                width: STORY_MARK_PX,
                height: STORY_MARK_PX,
                borderWidth: PORTRAIT_STROKE_PX,
                borderStyle: "solid",
                borderColor: "var(--nl-speaker-disc)",
            }}
            title={props.identity.name}
        >
            {props.showingSprite ? (
                <HeadThumbnail url={props.url} alt="" frame={props.frame} className="h-full w-full" iconClassName="h-3 w-3" />
            ) : (
                <img src={props.url} alt="" className="h-full w-full object-cover" draggable={false} />
            )}
        </span>
    );
}

/**
 * A character with no artwork: a solid disc of their colour, bearing their first grapheme (§3.1).
 *
 * **Solid, never hollow.** This is the rule the whole vocabulary rests on: a character is a specific
 * person whether or not anyone has drawn them yet, so they keep the filled shape and only lose the
 * picture inside it. The moment a faceless character falls back to the narrator's ring, "hollow = a
 * voice with no face" stops being true and the column stops carrying information.
 *
 * The letter is a deep tone of the disc's own hue rather than white (§4): the light theme's discs are
 * pale, and white ink on a pale disc is a smudge.
 */
export function StorySpeakerDiscMark(props: { identity: StorySpeakerIdentity }) {
    const { identity } = props;
    const paint = storySpeakerPaint(identity.paint);
    return (
        <span
            className={`${paint.className} flex shrink-0 select-none items-center justify-center rounded-full font-medium leading-none`}
            style={{
                ...paint.style,
                width: STORY_MARK_PX,
                height: STORY_MARK_PX,
                // A hair under half the disc, which is where one CJK glyph and two Latin letters both
                // sit inside the circle rather than against it.
                fontSize: 12.5,
                backgroundColor: "var(--nl-speaker-disc)",
                color: "var(--nl-speaker-ink)",
            }}
            title={identity.name}
        >
            {storySpeakerInitial(identity.name)}
        </span>
    );
}

/**
 * The size of the quote inside the narrator's ring.
 *
 * Much smaller than a directive's glyph, because it is not doing a directive's job. A command icon
 * has to be told apart from seven other command icons and needs the room to be legible as a specific
 * drawing; this one only has to say "quote" inside a shape that has already said "a voice with no
 * face". Sized up it fills the ring, and a full ring stops reading as hollow — which is the one thing
 * the narrator's mark is actually made of. Judged in the ring against the alternatives rather than
 * derived: 11 keeps a clear band of air all the way round, and the mark still reads at a glance.
 */
const NARRATOR_GLYPH_PX = 11;

/**
 * The narrator: a hollow ring around a quote (§2, §3.1).
 *
 * Hollow is its one and only occupant — nothing else in the editor is ever drawn this way — which is
 * what lets "there is nobody behind this line" be legible without a label.
 *
 * The quote is the ICON LIBRARY'S, not a typographic one. §3.2 reserves line drawing for directives
 * and would have this be a letterform, and the first version was: a Georgia left double quote, hand
 * nudged by half a pixel across and four and a half down, because that character sits high and left
 * in its em box and is not symmetric about its own centre. That is the tell. A glyph borrowed from a
 * text font is a glyph nobody drew for this box — it arrives at whatever size, weight and optical
 * centre its typeface happened to give it, none of which are the ring's, and every one of which
 * drifts the moment the editor font preference changes. lucide's quote is drawn on the same 24 grid
 * at the same stroke as every other mark in the column, so it is centred by construction and stays
 * centred. What separates it from a directive is not the material any more — it is the ring around
 * it, which no directive ever wears.
 *
 * It is turned to face the way an OPENING quote faces (`“`). lucide draws the closing form — body at
 * the top, tail descending, the shape of a `”` — and a line is about to be spoken, not just finished.
 * A half-turn rather than a mirror, because these marks are commas: a `9` reflected is a backwards
 * `9`, and only a `9` rotated is a `6`.
 *
 * `glyph` stays a STRING for the case it exists for: a second narrator (dream, memory, a framing
 * voice) wearing a single character of the author's choosing. That is a name, not an icon, so it is
 * the one thing here that should still be type.
 */
export function StoryNarratorRingMark(props: { glyph?: string; label: string }) {
    return (
        <span
            className="flex shrink-0 select-none items-center justify-center rounded-full border border-edge-strong text-fg-muted"
            style={{ width: STORY_MARK_PX, height: STORY_MARK_PX }}
            title={props.label}
        >
            {props.glyph ? (
                <span className="text-[12.5px] leading-none">{props.glyph}</span>
            ) : (
                <Quote
                    aria-hidden
                    className="shrink-0"
                    style={{ width: NARRATOR_GLYPH_PX, height: NARRATOR_GLYPH_PX, transform: "rotate(180deg)" }}
                    strokeWidth={COMMAND_STROKE}
                />
            )}
        </span>
    );
}

/**
 * A directive: a bare stroke icon in its category's hue, and nothing around it (§2, §3.2).
 *
 * **No container**, and that half is not negotiable: the container is what made a directive look like
 * a speaker whose portrait had failed to load, and it is the container — not the ink — that the
 * "有脸的是剧本" reading rests on.
 *
 * **Colour** is the command manual's category hue, the same value the manual's own list, the `/` menu
 * and the property card paint the very same command with. It was dropped once, when a directive's
 * glyph came from its badge id and was therefore shared by a whole category: colour and glyph then
 * said the identical thing twice, at the volume of the loudest thing on screen, so removing the louder
 * copy cost nothing. It costs something now — the glyph names the VERB and the hue names the SUBJECT,
 * which are two different halves of the line — and a column that carries both is a column an author
 * can scan for "the sound rows" without reading a word.
 *
 * It stays quiet by the two properties that were doing the work all along, neither of which is
 * greyness: the hues are the design system's low-saturation set, and the glyph is drawn small
 * ({@link COMMAND_GLYPH_PX}) at a light stroke ({@link COMMAND_STROKE}) with no fill anywhere near it.
 *
 * The icon comes from the app's own family (lucide) at the family's own 24 grid, so a command added
 * next year is automatically the same drawing as the ones here.
 */
export function StoryCommandGlyphMark(props: { icon: LucideIcon; label: string; color: string }) {
    const Icon = props.icon;
    return (
        <Icon
            className="shrink-0"
            style={{ width: COMMAND_GLYPH_PX, height: COMMAND_GLYPH_PX, color: props.color }}
            strokeWidth={COMMAND_STROKE}
            aria-label={props.label}
        />
    );
}

/**
 * A continuation: a 1px rule down the gutter, in the colour of the mark that opened the paragraph (§2).
 *
 * One rule for every kind of speech — narration, dialogue, monologue, a second narrator — because §2
 * makes a point of it: 不做特例. A run of lines by one voice is named once, at its head, and joined
 * to the rest by this. Repeating the name on every line cannot say the same thing however quietly it
 * is printed: it says "and now, again, Anyo", when what is true is that Anyo never stopped.
 *
 * It fills the row's full height rather than stopping at the text, so consecutive continuations meet
 * with no seam and read as one line rather than as one line per row. Its weight is
 * {@link CONTINUATION_RULE_PX}.
 *
 * The negative margins are what make "no seam" true rather than merely intended: they cancel the row
 * content column's own {@link STORY_ROW_CONTENT_PAD_PX} so the rule reaches the row's real top and
 * bottom edges and butts flush against its neighbours. As a flex item its margins count toward the
 * space `flex-1` distributes, so pulling them negative grows the drawn line by exactly the padding
 * it is cancelling — no absolute positioning, and no number that has to be kept in step by hand.
 */
export function StoryContinuationRule(props: { identity: StorySpeakerIdentity }) {
    const paint = storySpeakerPaint(props.identity.paint);
    return (
        <span
            aria-hidden
            className={`${paint.className} flex-1`}
            style={{
                ...paint.style,
                width: CONTINUATION_RULE_PX,
                marginTop: -STORY_ROW_CONTENT_PAD_PX,
                marginBottom: -STORY_ROW_CONTENT_PAD_PX,
                minHeight: STORY_MARK_PX,
                backgroundColor: "var(--nl-speaker-disc)",
                // The rule is an aside about a line the eye has already read: present enough to join
                // the run, quiet enough that a page of dialogue is not a page of coloured bars.
                opacity: 0.55,
            }}
        />
    );
}

/**
 * The nametag: the speaker's name, in the speaker's colour, in front of the words they say.
 *
 * Inline rather than in a column of its own, and printed once per paragraph. It is part of the
 * sentence — 「Anyo：大家好啊」 is one utterance read left to right, not a label filed beside a
 * quotation.
 */
export function StorySpeakerName(props: { identity: StorySpeakerIdentity; children?: React.ReactNode; className?: string; style?: React.CSSProperties }) {
    const paint = storySpeakerPaint(props.identity.paint);
    return (
        <span
            className={`${paint.className} ${props.className ?? ""}`}
            style={{ ...paint.style, color: "var(--nl-speaker-name)", ...props.style }}
        >
            {props.children ?? props.identity.name}
        </span>
    );
}
