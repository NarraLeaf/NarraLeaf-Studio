import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { getInterface } from "@/lib/app/bridge";
import type { StoryEditorDensity } from "./storyEditorSessionStore";
import {
    EDITOR_FONT_FAMILY_DEFAULT,
    EDITOR_FONT_SIZE_DEFAULT,
    EDITOR_FONT_SIZE_MAX,
    EDITOR_FONT_SIZE_MIN,
} from "@/lib/settings/editorFontOptions";

/**
 * Display font for authored story text (dialogue / narration / choice / note) in the scene editor.
 *
 * This is a Studio *preference* backed by global.json `editor.fontSize` / `editor.fontFamily`.
 * It is distinct from per-run `StoryTextMarks.fontSize`, which is story *content* compiled into the
 * runtime — content marks stay absolute and continue to override this base per run.
 */

// Font-family option key -> CSS font-family stack. "Default" inherits the surrounding Studio UI font
// (the app does not bundle a dedicated editor typeface, so "Default" is the honest baseline).
const FONT_FAMILY_STACKS: Record<string, string> = {
    "Default": "inherit",
    "Sans Serif": "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif",
    "Serif": "ui-serif, Georgia, \"Times New Roman\", serif",
    "Monospace": "ui-monospace, \"SF Mono\", \"Cascadia Code\", \"Fira Code\", Menlo, monospace",
};

function clampFontSize(value: unknown): number {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) {
        return EDITOR_FONT_SIZE_DEFAULT;
    }
    return Math.min(EDITOR_FONT_SIZE_MAX, Math.max(EDITOR_FONT_SIZE_MIN, Math.round(numeric)));
}

function resolveFontFamily(value: unknown): string {
    if (typeof value === "string" && value in FONT_FAMILY_STACKS) {
        return FONT_FAMILY_STACKS[value];
    }
    return FONT_FAMILY_STACKS[EDITOR_FONT_FAMILY_DEFAULT];
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
 * `lineHeight` is deliberately absent for `compact`: that档 inherits the Tailwind `text-sm` leading it
 * has always had, and pinning a number here would silently change the status quo.
 *
 * `avatar` is the speaker portrait's box on a dialogue row (U1). It was a flat 24px — 1.7% of the
 * editor's width, at which nothing the differential/crop work produces is legible. It is the one
 * number that separates the three tiers structurally: `comfortable` gives the portrait a column of
 * its own (U1 WI-3), which only pays off at a size a face survives.
 */
export const STORY_DENSITY_METRICS: Record<StoryEditorDensity, { rowBox: number; fontScale: number; lineHeight?: number; avatar: number }> = {
    // 28, not the historical 27: a dialogue row's speaker nametag is `min-h-[28px]` and was already
    // driving those rows one pixel taller than narration rows. Matching it here makes every compact row
    // the same height (the rhythm the 27 was meant to give) and lands the three columns on the same
    // centre line, instead of half a pixel apart.
    compact: { rowBox: 28, fontScale: 1, avatar: 28 },
    standard: { rowBox: 32, fontScale: 1.08, lineHeight: 1.55, avatar: 32 },
    comfortable: { rowBox: 38, fontScale: 1.15, lineHeight: 1.7, avatar: 40 },
};

/**
 * The box a NON-dialogue row's category badge occupies — constant across the tiers.
 *
 * It rides with `compact`'s avatar rather than with the density, because a `/bg` row's category glyph
 * is a 14px icon: growing its plate to the comfortable portrait size would put a 40px tile of empty
 * chrome on every stage/sound/flow row and buy nothing. Only faces gain from the extra pixels.
 */
export const STORY_BADGE_PX = 28;

/** The CSS variable the row chrome sizes its single-line boxes from. */
export const STORY_ROW_BOX_VAR = "--nl-story-row-box";
/** The CSS variable the row grid sizes its line-number gutter from. */
export const STORY_GUTTER_VAR = "--nl-story-gutter";
/** The CSS variable a dialogue row sizes its speaker portrait (and a group member's rail slot) from. */
export const STORY_AVATAR_VAR = "--nl-story-avatar";
/** The CSS variable the row grid sizes its speaker-name column from. */
export const STORY_NAME_VAR = "--nl-story-name";

/**
 * The drag-handle column is gone: the grip now rides in the line-number box and swaps with the number
 * on hover, so the two anchors that only ever matter one at a time stop each holding their own column.
 * That is 20px of chrome the words get back on every row of the document.
 *
 * Nothing else moved into the gap — the badge column starts where the handle used to.
 */

/**
 * The speaker-name column: names hang right-aligned against the body edge, so `[icon][gap][name][text]`
 * puts every row's words — dialogue, narration and action alike — on ONE x.
 *
 * This is not a walk-back of U1's "one baseline" ruling, it is that ruling applied correctly. What U1
 * banned was an edge that floats with *content*: the nametag used to sit inline in front of the first
 * line, so the words started after the name and therefore at a different x for every speaker — five
 * left edges on one screen, four of them accidental. A column whose width is a property of the SCENE
 * rather than of the row is deterministic: two fixed edges, both of which mean something.
 *
 * The width is measured from the scene's own cast (see `StoryNameColumnProbe`) rather than pinned at a
 * constant, because a constant is wrong in both directions at once — 100px truncates "Mysterious
 * Voice" and wastes 60px on a cast of Nattou / YouKi / 澪. It is clamped at both ends so a single
 * absurd name cannot eat the line, and it never changes while scrolling: collapsing a container hides
 * rows, but the cast is read from `scene.blocks`, not from what is on screen.
 */
export const STORY_NAME_MIN_PX = 56;
/** Ceiling for the name column. Past this a name truncates rather than taking the line with it. */
export const STORY_NAME_MAX_PX = 176;
/**
 * Breathing room between a name's last glyph and the speech bar it hangs against.
 *
 * The probe measures bare glyphs, but the tag renders inside a hover chip whose `px-1` is pulled back
 * out by a negative margin — the padding contributes nothing to layout, yet it still counts against
 * the chip's `max-w-full`, so a column sized to the glyphs alone truncates the very name it was
 * measured from. 14 = the chip's 8px of padding plus 6px that reads as a gap.
 */
const STORY_NAME_PAD_PX = 14;

/** The name column's width for a cast whose widest name measures `measuredPx`. */
export function storyNameWidth(measuredPx: number): number {
    return Math.round(Math.min(STORY_NAME_MAX_PX, Math.max(STORY_NAME_MIN_PX, measuredPx + STORY_NAME_PAD_PX)));
}

/**
 * Gutter at two digits — chevron (14) + gap (2) + two tabular digits at the line number's 11px type.
 *
 * Was 36 with a 4px gap and 12px digits. The line number is an anchor, not a reading surface (U1
 * WI-2): it keeps its column, one size smaller and tighter to the fold chevron, and the 6px it gives
 * up goes to the words — as does the handle column's 8px next to it.
 */
const GUTTER_BASE_PX = 30;
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
 * Root style for the scene editor: publishes the density's box height and the line-number gutter width
 * to the rows below. Applied alongside `data-story-density`, which stays as the attribute selectors
 * and the tests read.
 */
export function storyEditorRootStyle(density: StoryEditorDensity, rowCount: number, nameWidth = STORY_NAME_MIN_PX): CSSProperties {
    return {
        [STORY_ROW_BOX_VAR]: `${STORY_DENSITY_METRICS[density].rowBox}px`,
        [STORY_GUTTER_VAR]: `${storyGutterWidth(rowCount)}px`,
        [STORY_AVATAR_VAR]: `${STORY_DENSITY_METRICS[density].avatar}px`,
        [STORY_NAME_VAR]: `${nameWidth}px`,
    } as CSSProperties;
}

function toStyle(fontSize: number, fontFamily: string, density: StoryEditorDensity | undefined): CSSProperties {
    const metrics = STORY_DENSITY_METRICS[density ?? "compact"] ?? STORY_DENSITY_METRICS.compact;
    const scaled = metrics.fontScale === 1 ? fontSize : Math.round(fontSize * metrics.fontScale);
    return metrics.lineHeight === undefined
        ? { fontSize: scaled, fontFamily }
        : { fontSize: scaled, fontFamily, lineHeight: metrics.lineHeight };
}

const DEFAULT_STYLE = toStyle(EDITOR_FONT_SIZE_DEFAULT, resolveFontFamily(EDITOR_FONT_FAMILY_DEFAULT), undefined);

const StoryEditorTextStyleContext = createContext<CSSProperties>(DEFAULT_STYLE);

/**
 * The inline style to spread onto story text surfaces (`fontSize` + `fontFamily`). Defaults to the
 * baseline when used outside a provider, so components render sensibly in isolation.
 */
export function useStoryEditorTextStyle(): CSSProperties {
    return useContext(StoryEditorTextStyleContext);
}

/**
 * Reads the editor font preference once and shares it with every story text surface below. Re-reads
 * when the workspace window regains focus, so a change made in the (separate) Settings window
 * applies as soon as the author returns to the editor — without any cross-window IPC push.
 */
export function StoryEditorTextStyleProvider({ children, density }: { children: ReactNode; density?: StoryEditorDensity }) {
    const [fontSize, setFontSize] = useState(EDITOR_FONT_SIZE_DEFAULT);
    const [fontFamily, setFontFamily] = useState(() => resolveFontFamily(EDITOR_FONT_FAMILY_DEFAULT));

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [sizeResult, familyResult] = await Promise.all([
                    getInterface().app.state.getGlobalState("editor.fontSize"),
                    getInterface().app.state.getGlobalState("editor.fontFamily"),
                ]);
                if (cancelled) {
                    return;
                }
                setFontSize(clampFontSize(sizeResult.success ? sizeResult.data.value : undefined));
                setFontFamily(resolveFontFamily(familyResult.success ? familyResult.data.value : undefined));
            } catch {
                // Keep the last known-good values on transient IPC failures.
            }
        };
        void load();
        const onFocus = () => { void load(); };
        window.addEventListener("focus", onFocus);
        return () => {
            cancelled = true;
            window.removeEventListener("focus", onFocus);
        };
    }, []);

    const style = useMemo(() => toStyle(fontSize, fontFamily, density), [fontSize, fontFamily, density]);
    return (
        <StoryEditorTextStyleContext.Provider value={style}>
            {children}
        </StoryEditorTextStyleContext.Provider>
    );
}

/**
 * Measures the widest name in a scene's cast and reports the column width that fits it.
 *
 * Rendered rather than computed: the nametag's font is a *preference* — family "Default" resolves to
 * whatever the surrounding Studio UI inherits, and the size is scaled by the density — so any attempt
 * to rebuild the font string for `canvas.measureText` is a second copy of the cascade that will drift
 * from the first one. Laying the names out in the same tree, under the same style the tag itself uses,
 * cannot drift: it IS the cascade.
 *
 * Off-screen at a negative x rather than `visibility: hidden` inside the flow — a hidden element still
 * takes part in layout, and this one must not widen the row list. Negative x creates no scroll in LTR.
 */
export function StoryNameColumnProbe({ labels, onMeasure }: { labels: string[]; onMeasure: (width: number) => void }) {
    const ref = useRef<HTMLDivElement | null>(null);
    const style = useStoryEditorTextStyle();
    // The cast as a dependency. A fresh array identity every render would re-run the effect on every
    // render; the joined text changes exactly when the names do.
    const key = labels.join(" ");
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) {
            return;
        }
        const measure = () => {
            let widest = 0;
            for (const child of Array.from(element.children)) {
                widest = Math.max(widest, child.getBoundingClientRect().width);
            }
            // A hidden tree measures zero on every child. Publishing that would pin the column at its
            // floor and — because nothing about the cast has changed — never correct itself, which is
            // exactly the bug this guard exists for: the tab mounts while its editor group still has it
            // hidden, the layout effect runs there, and every name in the scene truncates for the rest
            // of the session. The observer below is what re-measures once the tree is real.
            if (widest > 0) {
                onMeasure(storyNameWidth(widest));
            }
        };
        measure();
        // Fires when the probe first gets a box (hidden becomes shown), and again whenever the resolved
        // font changes the glyphs' width — including a typeface change made in another window.
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [key, style.fontSize, style.fontFamily, onMeasure]);
    return (
        <div
            ref={ref}
            aria-hidden
            className="pointer-events-none absolute top-0 h-0 overflow-hidden whitespace-nowrap font-medium"
            style={{ ...style, left: -9999 }}
        >
            {labels.map(label => <span key={label} className="inline-block">{label}</span>)}
        </div>
    );
}
