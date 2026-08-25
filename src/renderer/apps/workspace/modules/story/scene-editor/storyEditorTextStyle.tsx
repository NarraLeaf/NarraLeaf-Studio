import { createContext, useContext, useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { STORY_MARK_PX } from "./StoryRowGutterMark";
import { useGlobalSetting } from "@/lib/settings/useGlobalSetting";
import type { StoryEditorDensity } from "./storyEditorSessionStore";
import {
    EDITOR_FONT_FAMILY_DEFAULT,
    EDITOR_FONT_SIZE_DEFAULT,
    EDITOR_FONT_SIZE_MAX,
    EDITOR_FONT_SIZE_MIN,
    editorFontCssFamily,
} from "@/lib/settings/editorFontOptions";

/**
 * Display font for authored story text (dialogue / narration / choice / note) in the scene editor.
 *
 * This is a Studio *preference* backed by global.json `editor.fontSize` / `editor.fontFamily`.
 * It is distinct from per-run `StoryTextMarks.fontSize`, which is story *content* compiled into the
 * runtime — content marks stay absolute and continue to override this base per run.
 */

function clampFontSize(value: unknown): number {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) {
        return EDITOR_FONT_SIZE_DEFAULT;
    }
    return Math.min(EDITOR_FONT_SIZE_MAX, Math.max(EDITOR_FONT_SIZE_MIN, Math.round(numeric)));
}

/**
 * The reading-density table — **the only place** the density numbers live.
 *
 * `rowBox` is the height of the single-line content box a row centres its text, its line number and its
 * drag handle inside. It used to be a flat `min-height` on the row itself (a rule in styles.css), which
 * grew the row but left all three columns pinned to its top (the grid is `items-start`, deliberately —
 * a wrapped line must keep its FIRST line aligned with the badge, not float to the middle). The extra
 * height therefore landed entirely below the text: 10.8px of dead space per row in comfortable, with the
 * drag handle — which did centre, over the full row — visibly out of line with it.
 *
 * Publishing the box height as a CSS variable instead lets every column size the same box and centre
 * inside it, so single-line rows are exactly centred and wrapped rows still align on their first line.
 *
 * `lineHeight` is a MULTIPLE of the font size in every density, `compact` included, and it may never
 * be a length again. The size is a preference and the leading has to follow it: a leading pinned in
 * `rem` holds the line box still while the glyphs grow, and a line box shorter than the glyphs in it
 * is clipped top and bottom by any ancestor that hides its overflow — which is every action row,
 * because a command line truncates. Compact used to have no entry here and inherited the fixed
 * `1.25rem` that Tailwind's `text-sm` puts on those boxes, so at a large `editor.fontSize` the
 * directive rows were shaved off above and below while the dialogue beside them — inheriting the
 * page's unitless 1.5 instead — grew correctly. 1.5 IS that inherited number, written down: the
 * leading compact has always drawn its prose at, now stated so the boxes that clip get it as well.
 *
 * There is no per-density mark size. The gutter's marks are fixed at {@link STORY_MARK_PX} (gutter
 * 规范 §6): density decides how much room the WORDS get, and the identity column beside them is
 * furniture that holds still. It used to scale 28/32/40 to give a portrait "a column of its own" at
 * the loosest tier — which the mark vocabulary explicitly rejects. A face in the gutter is an
 * identity token, not a picture to be looked at, and a 40px one only made the machine rows beside it
 * look like they were missing something.
 */
export const STORY_DENSITY_METRICS: Record<StoryEditorDensity, { rowBox: number; fontScale: number; lineHeight: number }> = {
    // 28, not the historical 27: a dialogue row's speaker nametag is `min-h-[28px]` and was already
    // driving those rows one pixel taller than narration rows. Matching it here makes every compact row
    // the same height (the rhythm the 27 was meant to give) and lands the three columns on the same
    // centre line, instead of half a pixel apart.
    compact: { rowBox: 28, fontScale: 1, lineHeight: 1.5 },
    standard: { rowBox: 32, fontScale: 1.08, lineHeight: 1.55 },
    comfortable: { rowBox: 38, fontScale: 1.15, lineHeight: 1.7 },
};

/** The CSS variable the row chrome sizes its single-line boxes from. */
export const STORY_ROW_BOX_VAR = "--nl-story-row-box";
/** The CSS variable the row grid sizes its line-number gutter from. */
export const STORY_GUTTER_VAR = "--nl-story-gutter";
/** The CSS variable the row grid sizes its speaker-mark column from. */
export const STORY_MARK_VAR = "--nl-story-mark";

/**
 * The speaker-name column is gone (gutter 规范 §2).
 *
 * It was a fixed-width column that held every row's words to one x, and the reasoning for it was
 * sound as far as it went: a nametag printed inline in front of the first line gives a screen as many
 * left edges as it has speakers. What that reasoning did not have was the paragraph rule — a run of
 * lines by one voice is named ONCE, at its head, and joined to the rest by the gutter's continuation
 * rule. A scene is then mostly continuations, all of which start on the one edge, and the name that
 * opens a paragraph reads as the first words of it rather than as a label filed beside it.
 *
 * What the column cost was the gutter: two identity columns side by side, one of which could never be
 * filled by narration or by any directive, so both the widest kinds of row in a scene carried a
 * permanent void where a name would go.
 */

/**
 * The drag-handle column is gone: the grip now rides in the line-number box and swaps with the number
 * on hover, so the two anchors that only ever matter one at a time stop each holding their own column.
 * That is 20px of chrome the words get back on every row of the document.
 *
 * Nothing else moved into the gap — the badge column starts where the handle used to.
 */

/**
 * The line-number column at two digits — chevron (14) + gap (2) + two tabular digits at 11px + the
 * 12px boundary that separates it from the mark column (规范 §6).
 *
 * 规范 §6 pins this column at 22px, which is the width of the digits alone. Studio's number column
 * also holds the fold chevron and hands its box over to the drag grip on hover — two controls the
 * static specimen has no equivalent of — so it is the digits' 22 plus what those cost. The rule the
 * spec is actually making (one fixed edge, 12px of air before the marks) is kept exactly.
 */
const GUTTER_BASE_PX = 38;
/** One tabular digit at the gutter's 11px type. */
const GUTTER_DIGIT_PX = 6;

/**
 * Width of the line-number column for a scene of `rowCount` rows. Fixed at 36px, four digits would
 * collide with the fold chevron, which is exactly what a 1000-line chapter has.
 */
export function storyGutterWidth(rowCount: number): number {
    const digits = String(Math.max(1, rowCount)).length;
    return GUTTER_BASE_PX + Math.max(0, digits - 2) * GUTTER_DIGIT_PX;
}

/**
 * Root style for the scene editor: publishes the density's box height, the line-number gutter width
 * and the fixed mark column to the rows below. Applied alongside `data-story-density`, which stays as
 * the attribute selectors and the tests read.
 */
export function storyEditorRootStyle(density: StoryEditorDensity, rowCount: number): CSSProperties {
    return {
        [STORY_ROW_BOX_VAR]: `${STORY_DENSITY_METRICS[density].rowBox}px`,
        [STORY_GUTTER_VAR]: `${storyGutterWidth(rowCount)}px`,
        [STORY_MARK_VAR]: `${STORY_MARK_PX}px`,
    } as CSSProperties;
}

/**
 * The composition story text is set in at one size, family and density — exported so the density
 * table can be tested through the style it actually produces, rather than field by field.
 */
export function storyEditorTextStyleFor(fontSize: number, fontFamily: string, density: StoryEditorDensity | undefined): CSSProperties {
    const metrics = STORY_DENSITY_METRICS[density ?? "compact"] ?? STORY_DENSITY_METRICS.compact;
    const scaled = metrics.fontScale === 1 ? fontSize : Math.round(fontSize * metrics.fontScale);
    // The leading travels with the size, always: it is what outranks the `text-sm` a row's line box
    // wears, and a box that truncates clips whatever its leading does not cover. See the table above.
    return { fontSize: scaled, fontFamily, lineHeight: metrics.lineHeight };
}

const DEFAULT_STYLE = storyEditorTextStyleFor(EDITOR_FONT_SIZE_DEFAULT, editorFontCssFamily(EDITOR_FONT_FAMILY_DEFAULT), undefined);

const StoryEditorTextStyleContext = createContext<CSSProperties>(DEFAULT_STYLE);

/**
 * The inline style to spread onto story text surfaces (`fontSize` + `fontFamily`). Defaults to the
 * baseline when used outside a provider, so components render sensibly in isolation.
 */
export function useStoryEditorTextStyle(): CSSProperties {
    return useContext(StoryEditorTextStyleContext);
}

/**
 * Reads the editor font preference and shares it with every story text surface below.
 *
 * Both keys follow the global-state broadcast (see {@link useGlobalSetting}), so a size or family
 * picked in the (separate) Settings window re-types the scene behind it as it is picked, rather
 * than waiting for the author to click back into the editor.
 */
export function StoryEditorTextStyleProvider({ children, density }: { children: ReactNode; density?: StoryEditorDensity }) {
    const fontSize = useGlobalSetting("editor.fontSize", clampFontSize);
    const fontFamily = useGlobalSetting("editor.fontFamily", editorFontCssFamily);

    const style = useMemo(() => storyEditorTextStyleFor(fontSize, fontFamily, density), [fontSize, fontFamily, density]);
    return (
        <StoryEditorTextStyleContext.Provider value={style}>
            {children}
        </StoryEditorTextStyleContext.Provider>
    );
}
