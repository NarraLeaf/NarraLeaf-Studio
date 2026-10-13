/**
 * The short form of the `.ui` text: what `show --compact` and the agent's `ui_show` leave out, and how
 * the compiler puts it back.
 *
 * A stored element carries every prop its widget was created with, default or not, and a container's
 * `appearance` restates each of those props once more as the default variant's base row. A title page
 * printed whole is some twenty kilobytes, nearly all of it repetition an agent pays for by the token
 * and reads past. Two things are left out, and each is marked so that the compiler can restore it
 * exactly - the short text applied back must give the same document, not one that merely renders the
 * same, or every show-edit-apply cycle would rewrite the page under the author:
 *
 * - **Props and layout keys at the widget's default.** An element whose header ends in `+defaults`
 *   starts from every default its widget declares, and its lines are applied on top. Most stored
 *   elements lack a few of those keys (they predate the prop, or were written sparsely), and filling
 *   those in would add keys the record never had, so a `without` line under the element names them.
 *   The marker is printed only where it saves more than that line costs.
 * - **Appearance groups that only repeat a prop.** A group whose single row is unconditional and
 *   holds the element's own value for that prop - or the widget's default, for a prop the element
 *   does not hold, which is what the widget draws - is printed as just its key (`"borderRadius"` in
 *   `propertyGroups`) and the compiler rebuilds it. Its place in the list is kept, because the list's
 *   order is part of the record. The rebuilt row follows the prop, so editing the prop in the short
 *   text edits the row with it, which is what the inspector does with a base row.
 *
 * Defaults whose value depends on a language (a new text's "Text") are never left out: the text may
 * be applied in a Studio whose words differ from the one it was printed in.
 *
 * Comments in English per project convention.
 */

import type { UIElement } from "@shared/types/ui-editor/document";
import { findWidgetModule } from "../catalog";
import type { UIWidgetDefaultWords, UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";

import { COMPACT_DEFAULTS_FLAG, COMPACT_WITHOUT_KEYWORD } from "./ast";
import { printValue } from "../../blueprint-cli/dsl/values";

/** The prop that holds an element's appearance variants. */
const APPEARANCE_PROP = "appearance";

/** Layout keys the header carries, which are never defaults. */
const HEADER_LAYOUT_KEYS = new Set(["x", "y", "width", "height"]);

type WidgetDefaults = {
    props: Readonly<Record<string, unknown>>;
    layout: Readonly<Record<string, unknown>>;
};

const SENTINEL = "\u0000nl-words\u0000";
/** Words that cannot be mistaken for any real ones, so a default built from words shows itself. */
const SENTINEL_WORDS: UIWidgetDefaultWords = { t: key => `${SENTINEL}${key}` };

/** By module rather than by type: a plugin's widget is a different module from one source to the next. */
const defaultsCache = new WeakMap<UIWidgetModule, WidgetDefaults | null>();

/**
 * The defaults of `type` that do not depend on a language, or null for a type this build does not
 * know. Read from the module's own new element, as the catalogue's prop defaults are.
 */
export function stableWidgetDefaults(type: string): WidgetDefaults | null {
    const module = findWidgetModule(type);
    if (!module) {
        return null;
    }
    if (defaultsCache.has(module)) {
        return defaultsCache.get(module) ?? null;
    }
    let defaults: WidgetDefaults | null = null;
    try {
        const element = module.createDefaultElement(SENTINEL_WORDS);
        defaults = {
            props: stableEntries(element.props as Record<string, unknown> | undefined),
            layout: Object.fromEntries(
                Object.entries(stableEntries(element.layout as Record<string, unknown> | undefined))
                    .filter(([key]) => !HEADER_LAYOUT_KEYS.has(key)),
            ),
        };
    } catch {
        defaults = null;
    }
    defaultsCache.set(module, defaults);
    return defaults;
}

function stableEntries(record: Record<string, unknown> | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record ?? {})) {
        if (value === undefined || JSON.stringify(value)?.includes(SENTINEL)) {
            continue;
        }
        out[key] = value;
    }
    return out;
}

export type CompactElementPlan = {
    /** Whether the element is printed with {@link COMPACT_DEFAULTS_FLAG}. */
    defaults: boolean;
    /** Props not printed, because they are at their default. */
    omittedProps: ReadonlySet<string>;
    /** Layout keys not printed, for the same reason. */
    omittedLayout: ReadonlySet<string>;
    /**
     * Defaults the element does not hold, for its `without` line: filling them in on the way back
     * would add keys the record never had. Props by key, layout keys as `layout.<key>`.
     */
    without: readonly string[];
    /** The appearance to print in place of the stored one, or undefined to print it as stored. */
    appearance?: unknown;
};

/** What of `element` the short form leaves out. */
export function planCompactElement(element: UIElement): CompactElementPlan {
    const props = (element.props ?? {}) as Record<string, unknown>;
    const layout = (element.layout ?? {}) as unknown as Record<string, unknown>;
    const defaults = stableWidgetDefaults(element.type);
    const appearance = compactAppearance(props[APPEARANCE_PROP], props, defaults);
    const none: CompactElementPlan = {
        defaults: false,
        omittedProps: new Set(),
        omittedLayout: new Set(),
        without: [],
        ...(appearance !== undefined ? { appearance } : {}),
    };
    if (!defaults) {
        return none;
    }
    const omittedProps = new Set<string>();
    const omittedLayout = new Set<string>();
    // What the marker saves, against what it costs: an element holding few of its defaults would
    // need a `without` line longer than the lines it spares.
    let saved = 0;
    for (const [key, value] of Object.entries(defaults.props)) {
        if (key !== APPEARANCE_PROP && key in props && deepEqual(props[key], value)) {
            omittedProps.add(key);
            saved += lineCost(key, value);
        }
    }
    for (const [key, value] of Object.entries(defaults.layout)) {
        if (key in layout && deepEqual(layout[key], value)) {
            omittedLayout.add(key);
            saved += lineCost(`layout.${key}`, value);
        }
    }
    const without = [
        ...Object.keys(defaults.props).filter(key => !(key in props)),
        ...Object.keys(defaults.layout).filter(key => !(key in layout)).map(key => `layout.${key}`),
    ];
    const cost = COMPACT_DEFAULTS_FLAG.length + 1
        + (without.length > 0 ? LINE_OVERHEAD + COMPACT_WITHOUT_KEYWORD.length + without.reduce((sum, key) => sum + key.length + 1, 0) : 0);
    if (saved <= cost) {
        return none;
    }
    return { ...none, defaults: true, omittedProps, omittedLayout, without };
}

/** Indentation and line break, roughly, which every printed line pays besides its text. */
const LINE_OVERHEAD = 13;

function lineCost(key: string, value: unknown): number {
    return LINE_OVERHEAD + key.length + 3 + printValue(value).length;
}

/**
 * The value a bare appearance group stands for: the element's own prop, or - for a prop the element
 * does not hold - the widget's default, which is what the widget draws in its place. Null when there
 * is neither.
 */
function ownValue(key: string, props: Record<string, unknown>, defaults: WidgetDefaults | null): { value: unknown } | null {
    if (key in props) {
        return { value: props[key] };
    }
    if (defaults && key in defaults.props) {
        return { value: defaults.props[key] };
    }
    return null;
}

/**
 * The appearance with each group that only repeats its prop replaced by the prop's key, or undefined
 * when there is nothing to shorten (or the value is not shaped like an appearance at all).
 */
function compactAppearance(appearance: unknown, props: Record<string, unknown>, defaults: WidgetDefaults | null): unknown {
    if (!isRecord(appearance) || !Array.isArray(appearance.variants)) {
        return undefined;
    }
    let changed = false;
    const variants = appearance.variants.map(variant => {
        if (!isRecord(variant) || !Array.isArray(variant.propertyGroups)) {
            return variant;
        }
        const groups = variant.propertyGroups.map(group => {
            if (isRestorableGroup(group, props, defaults)) {
                changed = true;
                return group.key;
            }
            return group;
        });
        return { ...variant, propertyGroups: groups };
    });
    return changed ? { ...appearance, variants } : undefined;
}

function isRestorableGroup(group: unknown, props: Record<string, unknown>, defaults: WidgetDefaults | null): group is { key: string } {
    if (!isRecord(group) || typeof group.key !== "string" || !hasExactlyKeys(group, ["key", "rows"])) {
        return false;
    }
    const rows = group.rows;
    if (!Array.isArray(rows) || rows.length !== 1) {
        return false;
    }
    const row = rows[0];
    if (!isRecord(row) || !hasExactlyKeys(row, ["conditions", "value"]) || row.conditions !== null) {
        return false;
    }
    const own = ownValue(group.key, props, defaults);
    return own !== null && deepEqual(row.value, own.value);
}

/**
 * What a `+defaults` element's props and layout start from before its lines are applied: the widget's
 * defaults, copied, less the ones its `without` line names. Starting from them rather than filling
 * gaps afterwards is what lets a dotted line (`imageFill.assetId = …`) change one field of a default
 * record and keep the rest of it. Returns the `without` keys that name no default, for a warning.
 */
export function compactBase(type: string, without: readonly string[]): {
    props: Record<string, unknown>;
    layout: Record<string, unknown>;
    unknownWithout: string[];
} {
    const defaults = stableWidgetDefaults(type);
    const props = clone({ ...(defaults?.props ?? {}) });
    const layout = clone({ ...(defaults?.layout ?? {}) });
    // The default appearance restates every default prop as a base row, and the renderer reads the
    // row over the prop. Kept verbatim, a line that changes the prop (`imageFill.assetId = …`) would
    // leave the row holding the default, and the element would draw as though the line were not
    // there. So its rows that only repeat a default start as bare keys, which
    // `expandAppearanceGroups` rebuilds from the element's props once its lines are applied - the
    // row follows the prop, as it does in the inspector. An element whose text states its own
    // `appearance` replaces this one whole.
    if (defaults && isRecord(props[APPEARANCE_PROP])) {
        const shortened = compactAppearance(props[APPEARANCE_PROP], defaults.props as Record<string, unknown>, defaults);
        if (shortened !== undefined) {
            props[APPEARANCE_PROP] = shortened;
        }
    }
    const unknownWithout: string[] = [];
    for (const key of without) {
        const layoutKey = key.startsWith("layout.") ? key.slice("layout.".length) : null;
        if (layoutKey !== null && layoutKey in layout) {
            delete layout[layoutKey];
        } else if (layoutKey === null && key in props) {
            delete props[key];
        } else {
            unknownWithout.push(key);
        }
    }
    return { props, layout, unknownWithout };
}

/**
 * Rebuild every appearance group written as a bare key from the value it stands for (see
 * {@link ownValue}), in place. Returns the keys that stand for nothing, for the compiler to report.
 */
export function expandAppearanceGroups(type: string, props: Record<string, unknown>): string[] {
    const unresolved: string[] = [];
    const appearance = props[APPEARANCE_PROP];
    if (!isRecord(appearance) || !Array.isArray(appearance.variants)) {
        return unresolved;
    }
    const defaults = stableWidgetDefaults(type);
    for (const variant of appearance.variants) {
        if (!isRecord(variant) || !Array.isArray(variant.propertyGroups)) {
            continue;
        }
        variant.propertyGroups = variant.propertyGroups.flatMap(group => {
            if (typeof group !== "string") {
                return [group];
            }
            const own = ownValue(group, props, defaults);
            if (!own) {
                unresolved.push(group);
                return [];
            }
            return [{ key: group, rows: [{ conditions: null, value: clone(own.value) }] }];
        });
    }
    return unresolved;
}

function clone<T>(value: T): T {
    return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
    const own = Object.keys(record);
    return own.length === keys.length && keys.every(key => key in record);
}

/** Structural equality of JSON-shaped values; key order does not matter, array order does. */
export function deepEqual(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) {
        return true;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
        return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
    }
    if (isRecord(a) && isRecord(b)) {
        const keys = Object.keys(a);
        return keys.length === Object.keys(b).length && keys.every(key => key in b && deepEqual(a[key], b[key]));
    }
    return false;
}
