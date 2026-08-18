import { BrandPalette } from "@shared/brand/brandRegistry";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import type { BrandColor } from "@shared/types/brand";

/**
 * The decisions behind a palette comparison, with no React in them.
 *
 * **Read from the document exactly as it stands, and never through the normalizer.**
 * `migrateProjectBrandDocument` seeds every built-in entry a document is missing, which is the
 * right thing to do on the way into the editor and the wrong thing here: a comparison that seeds
 * both sides can never show that an entry went away, because it puts it back first.
 */

/** Whether this presenter draws that file. The palette is a document, so its kind is the test. */
export function isBrandEntry(entry: DocumentDiffEntry): boolean {
  return entry.documentKind === "brand";
}

/** One side of one row: what the document stores, and what that paints as. */
export interface SwatchSide {
  /** The stored value: a CSS literal, or a `nlbrand:` link into this same palette. */
  readonly value: string;
  /** What the author called it, where they called it anything. */
  readonly name: string | null;
  /** The colour at the end of the chain, or null where the value does not land on one. */
  readonly css: string | null;
}

export interface SwatchRow {
  readonly id: string;
  readonly state: "added" | "removed" | "changed";
  readonly before: SwatchSide | null;
  readonly after: SwatchSide | null;
}

export interface PaletteComparison {
  readonly rows: readonly SwatchRow[];
  /** Entries both sides store identically. Counted rather than listed; see {@link comparePalettes}. */
  readonly unchanged: number;
}

/**
 * The palette a document holds, or null when these bytes are not one.
 *
 * Null covers every way this can fail at once - not JSON, not an object, no `colors` array,
 * entries that are not colours - because the caller does exactly the same thing for all of them
 * and a taxonomy of parse failures is not something to put in front of an author.
 */
export function readPalette(bytes: Uint8Array): readonly BrandColor[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const colors = (parsed as { colors?: unknown }).colors;
  if (!Array.isArray(colors)) {
    return null;
  }
  const out: BrandColor[] = [];
  for (const entry of colors) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const { id, value, name } = entry as { id?: unknown; value?: unknown; name?: unknown };
    if (typeof id !== "string" || typeof value !== "string") {
      continue;
    }
    out.push({ id, value, ...(typeof name === "string" ? { name } : {}) });
  }
  return out;
}

/**
 * Both palettes, aligned by id.
 *
 * **What counts as a change is what the DOCUMENT stores**, which is the value and the name, and
 * deliberately not the colour the value resolves to. A palette is mostly links: thirteen of the
 * seventeen seeded entries point at one of the other four, so an author who changes the primary
 * colour changes what every one of them paints as. Reporting all thirteen would bury the one edit
 * they made under twelve consequences of it - and the consequences are the point of the feature
 * rather than a change to the file. The swatch beside each row still shows the resolved colour, so
 * the cascade is visible where an author looks for it.
 *
 * The order is the newer side's own, which is the order the Brand panel draws; entries that only
 * the older side has follow, in its order. Both are the document's array order rather than
 * anything sorted here, so a row sits where the author expects to find it.
 *
 * Unchanged entries are counted rather than listed. A palette carries seventeen seeded entries
 * before an author adds one of their own, and a comparison that lists every one of them puts the
 * single row that differs somewhere in the middle of a screenful that does not.
 */
export function comparePalettes(
  before: readonly BrandColor[] | null,
  after: readonly BrandColor[] | null
): PaletteComparison {
  const beforeSides = sidesOf(before);
  const afterSides = sidesOf(after);
  const rows: SwatchRow[] = [];
  let unchanged = 0;

  for (const [id, side] of afterSides) {
    const was = beforeSides.get(id);
    if (!was) {
      rows.push({ id, state: "added", before: null, after: side });
      continue;
    }
    if (was.value === side.value && was.name === side.name) {
      unchanged += 1;
      continue;
    }
    rows.push({ id, state: "changed", before: was, after: side });
  }
  for (const [id, side] of beforeSides) {
    if (!afterSides.has(id)) {
      rows.push({ id, state: "removed", before: side, after: null });
    }
  }
  return { rows, unchanged };
}

/**
 * One side's entries by id, each already resolved against its OWN palette.
 *
 * Its own, and that is the whole reason the resolution happens here rather than at the call site:
 * a link is resolved against the palette it was stored in, so the older side's `nlbrand:primary`
 * paints the older primary. Resolving both against one palette would draw the new colour under the
 * old version and hide the change completely.
 *
 * A duplicate id keeps its first entry, which is what {@link BrandPalette} does with one.
 */
function sidesOf(colors: readonly BrandColor[] | null): Map<string, SwatchSide> {
  const out = new Map<string, SwatchSide>();
  if (!colors) {
    return out;
  }
  const palette = new BrandPalette(colors);
  for (const color of colors) {
    if (out.has(color.id)) {
      continue;
    }
    out.set(color.id, {
      value: color.value,
      name: color.name ?? null,
      css: palette.resolveValueCss(color.value)
    });
  }
  return out;
}
