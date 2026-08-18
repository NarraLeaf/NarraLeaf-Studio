import { BUILTIN_BRAND_COLORS, type BrandColor } from "@shared/types/brand";
import { parseBrandLink } from "./brandLink";

/**
 * Resolving a brand palette, and the one palette that is currently live.
 *
 * Two halves, and they answer different questions:
 *
 * - {@link BrandPalette} is a pure reading of a list of colours. Give it a list, ask it what a
 *   stored value - or a bare id - paints as. Nothing about it is global, which is what lets the
 *   Brand panel resolve a palette the author has not saved yet - a preview of an edit is just
 *   another palette.
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
   * What a *stored value* paints as - the operation every caller of this class actually performs.
   *
   * A stored value is whatever sits in a colour field of the document: an ordinary literal, or a
   * `nlbrand:` link into this palette. A literal comes back as it stands; a link is followed to
   * the literal at the end of its chain.
   *
   * `null` for the ways there is no answer - an id nothing defines, a ring, a chain past
   * {@link BRAND_LINK_MAX_DEPTH}, an entry whose value is blank. **Null rather than a thrown
   * error, and rather than an invented fallback colour.** This runs on the paint path for every
   * colour on screen; a throw would take the surface down over one bad row, and a fallback baked
   * in here would put a colour on screen that no caller chose and that lint could not tell apart
   * from a real one. The caller supplies its own fallback, as it already does for every
   * unparseable colour it has ever been handed.
   *
   * ## Alpha: the outermost written segment wins, and it replaces
   *
   * Walking from the stored value inwards, the first `/<alpha>` segment actually written is the
   * final opacity, and it *replaces* the opacity of the literal the chain ends at. Segments
   * further in are ignored, and a chain with no segment at all paints the literal's own alpha.
   * With `button.shadow` = `rgba(0, 0, 0, 0.35)`:
   *
   * ```
   * nlbrand:button.shadow        rgba(0, 0, 0, 0.35)   the entry as it stands
   * nlbrand:button.shadow/0.5    rgba(0, 0, 0, 0.5)    replaced, not 0.5 * 0.35
   * ```
   *
   * **Not multiplied, which is what this used to do.** Every link in a chain is a number an author
   * set in an opacity slider - the Brand panel edits `button.primary` and its neighbours through
   * the same picker as any other field - and a slider has to write back the number it displays.
   * Under multiplication it cannot: an entry stored at 0.5 in front of a 0.35 literal resolves to
   * 17.5%, so a picker showing the resolved colour writes 0.175 back, which resolves to 6% the
   * next time it is opened. Each open-and-close fades the colour one notch, and nothing in the
   * document looks wrong on the way down. Replacing makes the slider's number and the stored
   * number the same number, which is the only version of this an author can reason about.
   *
   * The rule is one rule for the whole product: the canvas, the shipped game's first painted frame
   * and the shell's pre-boot background all reach it through this method, so a stored value cannot
   * mean two colours depending on who read it.
   *
   * The literal it lands on is handed back unexamined (beyond having an alpha put on it). Following
   * links is this method's whole job; whether `#gggggg` is paintable is the question the caller's
   * own colour parser already asks of every value it is given, and answering it twice would mean
   * two definitions of a valid colour.
   */
  public resolveValueCss(value: string): string | null {
    const link = parseBrandLink(value);
    if (!link) {
      // Not a link, so there is nothing to resolve: the field is holding its own colour. Blank
      // is not a colour, and reports as no answer rather than as an empty CSS string.
      return value.trim() || null;
    }
    return this.followLink(link.id, link.alphaExplicit ? link.alpha : null);
  }

  /**
   * What this id paints as - {@link resolveValueCss} for the value the entry itself holds.
   *
   * Kept for the callers that hold an id rather than a stored value: the panel's swatches, and the
   * lint rule that asks whether an id resolves at all.
   */
  public resolveCss(id: string): string | null {
    return this.followLink(id, null);
  }

  /**
   * The walk both public resolvers share.
   *
   * `alpha` is the opacity pinned by an outer link, or `null` when none has been written yet - the
   * first entry along the chain that writes one claims it, and the rest are passed over.
   */
  private followLink(id: string, alpha: number | null): string | null {
    const visited = new Set<string>();
    let cursor = id;
    let pinned = alpha;

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
        if (!literal) {
          return null;
        }
        return pinned === null ? literal : replaceCssAlpha(literal, pinned);
      }
      if (pinned === null && link.alphaExplicit) {
        pinned = link.alpha;
      }
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
 * A CSS literal with its opacity replaced by the one the link asked for.
 *
 * Replaced, not scaled - see {@link BrandPalette.resolveValueCss} for why the product of a chain is
 * the wrong number to paint.
 *
 * Only the spellings Studio itself writes are decomposed - `#RGB`, `#RRGGBB`, the eight-digit form,
 * and `rgb()` / `rgba()`. Anything else (a bare colour name, a `color-mix`, a gradient someone
 * pasted) is returned untouched: there is no correct way to apply an alpha to a string this cannot
 * read, and inventing one would paint a colour the author never chose. Losing the alpha leaves the
 * colour visible and obviously wrong, which is the failure a person can act on.
 */
function replaceCssAlpha(css: string, alpha: number): string {
  const channels = readCssChannels(css);
  if (!channels) {
    return css;
  }
  const [r, g, b, ownAlpha] = channels;
  const wanted = Math.round(Math.max(0, Math.min(1, alpha)) * 1000) / 1000;
  // Asking for the opacity the literal already has is not an edit, and answering it in the
  // author's own spelling keeps `#40A8C4` from becoming `rgba(64, 168, 196, 1)` for nothing.
  if (Math.abs(wanted - ownAlpha) < 1e-6) {
    return css;
  }
  return `rgba(${r}, ${g}, ${b}, ${wanted})`;
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
      return expand([...hex].map((char) => char + char).join(""));
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
  const parts = (fn[1] ?? "").split(",").map((part) => Number(part.trim()));
  if (parts.length < 3 || parts.length > 4 || parts.some((part) => !Number.isFinite(part))) {
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

/**
 * One stored colour value, resolved against the live palette into something that can be painted.
 *
 * `getActiveBrandPalette().resolveValueCss(...)` with the two conveniences every caller was writing
 * for itself: a nullable input (a colour field that is optional hands over `undefined`), and a name
 * that says at the call site which of the three things is happening. A value that is not a link
 * comes back as it stands; a broken link, a ring, or a chain past {@link BRAND_LINK_MAX_DEPTH}
 * comes back `null`, as does a blank or absent value.
 *
 * **It exists so that a link can be unwrapped *before* a caller's own colour guard runs.** Studio is
 * full of guards that ask "is this a hex I can draw" - `isReadableAccentColor`, `CHARACTER_ACCENT_HEX`,
 * `normalizeHex` - and every one of them correctly answers "no" for `nlbrand:primary`. That is the
 * safety net a half-adopted project is rolled out behind (see `brandLink.ts`), and it must stay
 * intact: teaching a guard about links would give the product two definitions of a valid colour.
 * Teaching a *reader* to resolve first is the other half, and this is the one call it makes.
 *
 * Reading the module-level palette rather than taking one is the point: the callers are surfaces
 * (story rows, a character list, the compiler's nametag config) that would otherwise each need a
 * palette threaded down to them.
 */
export function resolveBrandColorValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return getActiveBrandPalette().resolveValueCss(value);
}

function sameBrandColors(left: readonly BrandColor[], right: readonly BrandColor[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((color, index) => {
    const other = right[index]!;
    return (
      color.id === other.id &&
      color.value === other.value &&
      color.name === other.name &&
      color.builtin === other.builtin
    );
  });
}
