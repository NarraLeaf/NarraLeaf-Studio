import {
    BUILTIN_BRAND_COLORS,
    type BrandColor,
} from "@shared/types/brand";
import {parseBrandLink} from "./brandLink";

/**
 * Resolving a brand palette, and the one palette that is currently live.
 *
 * Two halves, and they answer different questions:
 *
 * - {@link BrandPalette} is a pure reading of a list of colours. Give it a list, ask it what an id
 *   paints as. Nothing about it is global, which is what lets the Brand panel resolve a palette the
 *   author has not saved yet - a preview of an edit is just another palette.
 * - The module-level active palette is what everything else reads, because the alternative is
 *   threading a palette through every colour field in Studio. Two hosts push into it and neither
 *   knows about the other: the editor (from `BrandService`) and the game runtime (from the pack it
 *   booted with). A host that has pushed nothing gets the seeds, which is the right answer for both
 *   a project being opened and a runtime built before the feature existed.
 *
 * Comments in English per project convention.
 */

/**
 * How many links a resolve will follow before giving up.
 *
 * Not a design limit - the palette a person builds is one or two links deep - but a guard on the
 * document. The chain is walked on every paint, and a hand-edited or merge-mangled file must not be
 * able to turn that walk into an unbounded one. The `visited` set already stops rings; this stops a
 * long chain that is not a ring, which is a file nobody meant to write either way.
 */
export const BRAND_LINK_MAX_DEPTH = 8;

export class BrandPalette {
    private readonly colors: readonly BrandColor[];
    private readonly byId: ReadonlyMap<string, BrandColor>;

    constructor(colors: readonly BrandColor[]) {
        // The array is copied so a caller mutating theirs afterwards cannot change what an already
        // published palette reports without a revision to go with it. The entries are treated as
        // immutable values and are not cloned.
        this.colors = [...colors];
        const byId = new Map<string, BrandColor>();
        for (const color of this.colors) {
            if (!byId.has(color.id)) {
                byId.set(color.id, color);
            }
        }
        this.byId = byId;
    }

    public get(id: string): BrandColor | undefined {
        return this.byId.get(id);
    }

    public list(): readonly BrandColor[] {
        return this.colors;
    }

    /**
     * What this id paints as, after following however many links its value goes through.
     *
     * `null` for the three ways there is no answer - an id nothing defines, a ring, and a chain past
     * {@link BRAND_LINK_MAX_DEPTH}. **Null rather than a thrown error, and rather than an invented
     * fallback colour.** This runs on the paint path for every colour on screen; a throw would take
     * the surface down over one bad row, and a fallback baked in here would put a colour on screen
     * that no caller chose and that lint could not tell apart from a real one. The caller supplies
     * its own fallback, as it already does for every unparseable colour it has ever been handed.
     *
     * Alpha compounds along the chain: `nlbrand:a/0.5` pointing at `nlbrand:b/0.5` is `b` at 0.25,
     * because each link means "that colour, at this much of it".
     *
     * The literal it lands on is handed back unexamined. Following links is this method's whole job;
     * whether `#gggggg` is paintable is the question the caller's own colour parser already asks of
     * every value it is given, and answering it twice would mean two definitions of a valid colour.
     */
    public resolveCss(id: string): string | null {
        const visited = new Set<string>();
        let cursor = id;
        let alpha = 1;

        for (let depth = 0; depth <= BRAND_LINK_MAX_DEPTH; depth += 1) {
            if (visited.has(cursor)) {
                return null;
            }
            visited.add(cursor);

            const color = this.byId.get(cursor);
            if (!color) {
                return null;
            }
            const link = parseBrandLink(color.value);
            if (!link) {
                const literal = color.value.trim();
                return literal ? applyAlphaToCss(literal, alpha) : null;
            }
            alpha *= link.alpha;
            cursor = link.id;
        }
        return null;
    }

    /**
     * The ids a resolve from `id` passes through, in order, `id` itself excluded.
     *
     * What the panel needs to know which entries it must not offer as a link target: setting `x` to
     * point at `y` closes a ring exactly when `y` is `x` or `chainOf(y)` contains `x`. Walking it
     * from the *candidate* rather than from the entry being edited is why the answer excludes its
     * own starting point.
     *
     * A ring stops the walk at the repeat rather than reporting it twice, and an id nothing defines
     * is included before the walk stops - the panel is choosing between ids, and an id that is only
     * reachable through a broken link is still an id this chain names.
     */
    public chainOf(id: string): string[] {
        const chain: string[] = [];
        const visited = new Set<string>([id]);
        let cursor = id;

        for (let depth = 0; depth < BRAND_LINK_MAX_DEPTH; depth += 1) {
            const link = parseBrandLink(this.byId.get(cursor)?.value);
            if (!link || visited.has(link.id)) {
                break;
            }
            visited.add(link.id);
            chain.push(link.id);
            cursor = link.id;
        }
        return chain;
    }
}

/**
 * A CSS literal at a fraction of its opacity.
 *
 * Only the spellings Studio itself writes are decomposed - `#RGB`, `#RRGGBB`, the eight-digit form,
 * and `rgb()` / `rgba()`. Anything else (a bare colour name, a `color-mix`, a gradient someone
 * pasted) is returned untouched: there is no correct way to apply an alpha to a string this cannot
 * read, and inventing one would paint a colour the author never chose. Losing the alpha leaves the
 * colour visible and obviously wrong, which is the failure a person can act on.
 */
function applyAlphaToCss(css: string, alpha: number): string {
    if (alpha >= 1) {
        return css;
    }
    const channels = readCssChannels(css);
    if (!channels) {
        return css;
    }
    const [r, g, b, ownAlpha] = channels;
    const combined = Math.round(Math.max(0, Math.min(1, ownAlpha * alpha)) * 1000) / 1000;
    return `rgba(${r}, ${g}, ${b}, ${combined})`;
}

/** `[r, g, b, alpha]` for the literals above, or null. */
function readCssChannels(css: string): [number, number, number, number] | null {
    const color = css.trim().toLowerCase();

    const hex = /^#([0-9a-f]{3,8})$/.exec(color)?.[1];
    if (hex) {
        const expand = (body: string): [number, number, number, number] | null => {
            const pair = (index: number) => Number.parseInt(body.slice(index * 2, index * 2 + 2), 16);
            return [pair(0), pair(1), pair(2), body.length === 8 ? pair(3) / 255 : 1];
        };
        if (hex.length === 3 || hex.length === 4) {
            return expand([...hex].map(char => char + char).join(""));
        }
        if (hex.length === 6 || hex.length === 8) {
            return expand(hex);
        }
        return null;
    }

    const fn = /^rgba?\(([^)]*)\)$/.exec(color);
    if (!fn) {
        return null;
    }
    const parts = (fn[1] ?? "").split(",").map(part => Number(part.trim()));
    if (parts.length < 3 || parts.length > 4 || parts.some(part => !Number.isFinite(part))) {
        return null;
    }
    const [r, g, b, a] = parts;
    return [Math.round(r!), Math.round(g!), Math.round(b!), parts.length === 4 ? a! : 1];
}

/**
 * The palette the two hosts push into, and everything else reads.
 *
 * Module-level state rather than a context, because the readers are the colour fields themselves -
 * a hundred call sites deep in widget inspectors and runtime CSS mappers - and a palette threaded
 * through all of them would be a prop on every one. The revision is what makes that legible to
 * React: a canvas subscribes with `useSyncExternalStore` and takes the number as a prop, which is
 * enough to defeat the memo that would otherwise keep the old colours on screen.
 */
let activeColors: readonly BrandColor[] = BUILTIN_BRAND_COLORS;
let activePalette: BrandPalette | null = null;
let activeRevision = 0;
const listeners = new Set<() => void>();

/**
 * Publish a palette.
 *
 * **A push whose content matches the current one changes nothing** - no revision, no notification.
 * The hosts push from a document-changed subscription, which fires for every edit anywhere in the
 * project, and a bumped revision repaints the whole canvas. Comparing here is what keeps that cost
 * at "when the author actually changed a colour" instead of "on every keystroke in the story
 * editor".
 */
export function setActiveBrandPalette(colors: readonly BrandColor[]): void {
    if (sameBrandColors(activeColors, colors)) {
        return;
    }
    activeColors = [...colors];
    activePalette = null;
    activeRevision += 1;
    // Iterated over a copy: a listener is allowed to unsubscribe from inside its own callback, and
    // deleting from the live set mid-iteration skips whichever listener came next.
    for (const listener of [...listeners]) {
        listener();
    }
}

/** The live palette. Never null - a host that has published nothing reads the seeds. */
export function getActiveBrandPalette(): BrandPalette {
    if (!activePalette) {
        activePalette = new BrandPalette(activeColors);
    }
    return activePalette;
}

// Module-level function declarations so the references stay stable across renders, which is what
// `useSyncExternalStore` needs to avoid re-subscribing on every one.
export function subscribeActiveBrandPalette(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getActiveBrandPaletteRevision(): number {
    return activeRevision;
}

function sameBrandColors(left: readonly BrandColor[], right: readonly BrandColor[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    return left.every((color, index) => {
        const other = right[index]!;
        return color.id === other.id
            && color.value === other.value
            && color.name === other.name
            && color.builtin === other.builtin;
    });
}
