/**
 * Brand - the project's own palette, and the one place a colour is decided.
 *
 * An author picks a colour once here and points at it from everywhere else, so that changing the
 * primary colour changes the buttons, the containers and the dialogue box together rather than
 * being twenty separate edits that drift apart. What a widget stores is a link
 * (`nlbrand:<id>`, see `@shared/brand/brandLink`) instead of a dead hex literal.
 *
 * Two decisions are worth knowing before touching this file:
 *
 * - **One id space, one array.** The control colours are not a second table; they are ordinary
 *   entries whose id carries a dot (`button.primary`), and the panel groups them by that prefix.
 *   A second table would mean a second resolution path, and the two would answer differently the
 *   first time one of them was extended.
 * - **`id` is the identity, `name` is decoration.** Links are stored by id, so renaming a colour
 *   can never break one. That is also why the seeded entries carry no name at all: their name is
 *   an i18n string the panel supplies, and burning an English word into the document would leave
 *   a zh project reading "Primary".
 *
 * Comments in English per project convention.
 */

/** Persisted document version for `editor/brand.json`. Independent of every other document. */
export const BRAND_SCHEMA_VERSION = 1;

export type BrandColor = {
  /**
   * Stable, and the only thing references hold.
   *
   * Seeded entries use the spelling in {@link BUILTIN_BRAND_COLORS}; an author's own colour gets
   * a generated short id. Both have to be addressable by a link, so a generator must stay inside
   * the grammar `@shared/brand/brandLink` accepts - each segment starting with a lower-case
   * letter, at most one dot. `brand.test.ts` asserts every seed does.
   */
  id: string;
  /**
   * What the author called it. Absent on the seeded entries, where the panel shows a translated
   * default instead.
   */
  name?: string;
  /**
   * A CSS literal (`#RRGGBB`, `rgba(...)`), or a link to another entry of this same palette.
   *
   * The link case is the whole point of the feature - `button.primary` is `nlbrand:primary`, so
   * a button follows the brand without anyone re-entering the colour. Depth is bounded and cycles
   * are refused when the palette is resolved, not here; see `@shared/brand/brandRegistry`.
   */
  value: string;
  /** Set on the seeded entries. Derived from {@link isBuiltinBrandColorId}, never authored. */
  builtin?: true;
};

/** The persisted document. An array because the seed order is the order the panel draws. */
export type ProjectBrandDocument = {
  schemaVersion: number;
  colors: BrandColor[];
};

function seedColor(id: string, value: string): BrandColor {
  return Object.freeze({ id, value, builtin: true as const });
}

/**
 * The palette every project starts with, seeded on first read and re-seeded if a document loses an
 * entry.
 *
 * **This array's order is the panel's order, and an id here is permanent.** A published id is what
 * every link in every project points at, so renaming one silently unpoints all of them; a new slot
 * is appended (or inserted in its group) rather than replacing an old one.
 *
 * Four flat semantic colours, then the control slots, each of which links back to one of the four.
 * The links are the default that makes "change the primary colour" mean anything: a fresh project
 * whose control slots all held their own literal would look identical and behave like seventeen
 * unrelated colours. The two shadows and `text.muted` are literals because there is no semantic
 * colour they are a shade of - a shadow is not the brand darkened, it is a shadow.
 */
export const BUILTIN_BRAND_COLORS: readonly BrandColor[] = Object.freeze([
  seedColor("primary", "#40A8C4"),
  seedColor("secondary", "#2E6E80"),
  seedColor("background", "#101317"),
  seedColor("foreground", "#F2F4F7"),

  seedColor("button.primary", "nlbrand:primary"),
  seedColor("button.secondary", "nlbrand:secondary"),
  seedColor("button.border", "nlbrand:secondary"),
  seedColor("button.text", "nlbrand:foreground"),
  seedColor("button.shadow", "rgba(0, 0, 0, 0.35)"),

  seedColor("container.background", "nlbrand:background"),
  seedColor("container.border", "nlbrand:secondary"),
  seedColor("container.shadow", "rgba(0, 0, 0, 0.35)"),

  seedColor("text.primary", "nlbrand:foreground"),
  seedColor("text.muted", "#9AA3AE"),

  seedColor("textInput.background", "nlbrand:background"),
  seedColor("textInput.border", "nlbrand:secondary"),
  seedColor("textInput.text", "nlbrand:foreground")
]) as readonly BrandColor[];

/** One accordion in the Brand panel: a widget, and the slots it consumes. */
export type BrandControlGroup = {
  id: string;
  slotIds: readonly string[];
};

function deriveControlGroups(colors: readonly BrandColor[]): readonly BrandControlGroup[] {
  const groups: { id: string; slotIds: string[] }[] = [];
  for (const color of colors) {
    const dot = color.id.indexOf(".");
    if (dot <= 0) {
      continue;
    }
    const groupId = color.id.slice(0, dot);
    const existing = groups.find((group) => group.id === groupId);
    if (existing) {
      existing.slotIds.push(color.id);
    } else {
      groups.push({ id: groupId, slotIds: [color.id] });
    }
  }
  return Object.freeze(
    groups.map((group) =>
      Object.freeze({
        id: group.id,
        slotIds: Object.freeze([...group.slotIds]) as readonly string[]
      })
    )
  ) as readonly BrandControlGroup[];
}

/**
 * The control slots, grouped by the prefix of their id, in seed order.
 *
 * **Structure only - no display text.** Both the group name and each slot's name are i18n strings
 * the panel owns; a label here would be an English word inside a shared model that a zh project
 * would read verbatim.
 *
 * The flat semantic colours (ids with no dot) are deliberately absent: the panel draws those above
 * the accordions, because they are what an author edits and the slots are what follows.
 *
 * Derived from {@link BUILTIN_BRAND_COLORS} rather than written out a second time. A hand-kept list
 * would drift the first time a slot was added, and the drift is invisible - the new slot simply
 * never appears in the panel, with nothing reporting why.
 */
export const BRAND_CONTROL_GROUPS: readonly BrandControlGroup[] =
  deriveControlGroups(BUILTIN_BRAND_COLORS);

export function isBuiltinBrandColorId(id: string): boolean {
  return BUILTIN_BRAND_COLORS.some((color) => color.id === id);
}

export function builtinBrandColor(id: string): BrandColor | undefined {
  return BUILTIN_BRAND_COLORS.find((color) => color.id === id);
}

/**
 * One entry, from whatever was on disk. `null` when there is nothing usable to keep.
 *
 * Two ways to be unusable, and both mean the same thing - a row that cannot be pointed at or cannot
 * be painted is not a colour:
 *
 * - no id, so no link could ever address it;
 * - no value, and no seed to borrow one from. A seeded entry whose value was blanked out comes back
 *   at its seeded value instead, which is the same re-seeding {@link normalizeProjectBrandColors}
 *   does for an entry that went missing entirely.
 *
 * Nothing here validates the *shape* of `value`. A literal Studio cannot parse and a link pointing
 * at nothing both resolve to null later and are reported by lint, which is a fixable state the
 * author can see - whereas dropping the row here would lose the name they typed.
 */
export function normalizeProjectBrandColor(raw: unknown): BrandColor | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) {
    return null;
  }
  const seeded = builtinBrandColor(id);
  const value =
    (typeof record.value === "string" ? record.value.trim() : "") || seeded?.value || "";
  if (!value) {
    return null;
  }
  const name = typeof record.name === "string" ? record.name.trim() : "";

  return {
    id,
    // Absent rather than empty. The panel falls back to a translated default for a nameless
    // entry, and `""` would draw an empty row instead of that default.
    ...(name ? { name } : {}),
    value,
    // Derived from the id and re-derived on every load, so a hand-written `builtin: true` on an
    // author's own colour cannot make it undeletable, and a stripped one cannot make `primary`
    // deletable.
    ...(seeded ? { builtin: true as const } : {})
  };
}

/**
 * The palette as the rest of Studio may assume it: every id unique, every entry paintable, and
 * every seeded colour present.
 *
 * Order is the author's, except that a missing seed is prepended in seed order - a document that
 * lost one comes back looking like a fresh project rather than like a project with a stray colour
 * appended at the bottom.
 */
export function normalizeProjectBrandColors(raw: unknown): BrandColor[] {
  const source = Array.isArray(raw) ? raw : [];
  const byId = new Map<string, BrandColor>();
  const order: string[] = [];

  for (const entry of source) {
    const color = normalizeProjectBrandColor(entry);
    if (!color || byId.has(color.id)) {
      // First wins. A duplicated id is one row on the surface either way, and taking the later
      // one would silently discard whichever of the two the author had been editing first.
      continue;
    }
    byId.set(color.id, color);
    order.push(color.id);
  }

  const missing = BUILTIN_BRAND_COLORS.filter((seed) => !byId.has(seed.id));
  for (const seed of missing) {
    byId.set(seed.id, { ...seed });
  }

  return [...missing.map((seed) => seed.id), ...order].map((id) => byId.get(id)!);
}

/**
 * Whatever was on disk, as a document of the current schema.
 *
 * There is nothing to migrate yet - v1 is the first version - but the function exists from the
 * start so the spec has one entry point and a v2 has one place to be written.
 */
export function migrateProjectBrandDocument(raw: unknown): ProjectBrandDocument {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  return {
    schemaVersion: BRAND_SCHEMA_VERSION,
    colors: normalizeProjectBrandColors(record.colors)
  };
}

/** An absent document is a project that has never had the Brand surface opened: the seeds, alone. */
export function createEmptyProjectBrandDocument(): ProjectBrandDocument {
  return {
    schemaVersion: BRAND_SCHEMA_VERSION,
    colors: normalizeProjectBrandColors([])
  };
}
