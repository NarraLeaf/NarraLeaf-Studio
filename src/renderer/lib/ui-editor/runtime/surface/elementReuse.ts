import type { ReactNode } from "react";
import type { UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";

/**
 * What one element of a surface was drawn as last time, and everything that drawing depended on.
 *
 * # Why the tree remembers its own output
 *
 * A surface re-renders for reasons that concern a handful of its widgets - a blueprint writing one
 * label, a value binding resolving, a page becoming interactive - and every one of those re-renders
 * used to rebuild all of them. `renderElementTree` is a plain recursive function, so it hands React a
 * brand-new description of every element on every pass, and nothing below it can bail out: a new
 * `element` object, a new style object, new children, new closures. Measured on a shipped build, a
 * page switch to a 287-element page rebuilt the whole page about a dozen times to change a few
 * elements, and that work - not asset loading, not layout - was where the time went.
 *
 * Handing React **the same description** it was given last time is what lets it skip a subtree
 * outright, so an element whose inputs have not moved returns the node it returned before. The
 * inputs are compared, not guessed: the element as it resolved on this pass (patches, bindings and
 * values already applied), the context it was drawn in, and its children's own nodes - so a child
 * that changed makes its whole ancestry rebuild, and nothing that did not change does.
 *
 * # What is never reused
 *
 * Anything whose output this walk cannot see all of - see {@link isReusableElementType}. Those are
 * rebuilt on every pass exactly as before, which is also what keeps what is under them live.
 */
export type ElementReuseEntry = {
    /** The snapshot the node was built from. Reused as-is when the element resolves the same again. */
    resolved: UIElement;
    /** Everything else the node read, compared element-wise with `Object.is`. */
    deps: readonly unknown[];
    /** The node of each child, which is what makes a child's change reach its ancestors. */
    children: readonly ReactNode[];
    node: ReactNode;
};

export type ElementReuseCache = {
    /** The inputs whose change makes every entry meaningless, rather than one of them. */
    document: UIDocument;
    surface: UISurface;
    rendererRegistry: ElementRendererRegistry;
    entries: Map<string, ElementReuseEntry>;
};

/**
 * The cache for this tree, started over when the tree is drawing something else.
 *
 * A hot reload hands over a new document, and a registry change means a different renderer may
 * now own a type - either makes every remembered node a description of something that is gone.
 */
export function resolveElementReuseCache(
    current: ElementReuseCache | null,
    input: { document: UIDocument; surface: UISurface; rendererRegistry: ElementRendererRegistry },
): ElementReuseCache {
    if (
        current
        && current.document === input.document
        && current.surface === input.surface
        && current.rendererRegistry === input.rendererRegistry
    ) {
        return current;
    }
    return { ...input, entries: new Map() };
}

/**
 * Types whose drawing depends on more than this walk passes them.
 *
 * - **Widgets that place their own children** (lists, sliders, switches) build them inside their
 *   own render, reading item data and bound state that no argument here describes; reusing their
 *   node would keep last pass's rows.
 * - **Frames** mount a whole nested surface with its own lifecycle and animation, which is a
 *   stabilised behaviour with nothing to gain here: there are a few per page.
 *
 * Unknown and plugin types are excluded by the caller, which only reuses built-in renderers.
 */
const NON_REUSABLE_TYPES: ReadonlySet<string> = new Set(["nl.list", "nl.slider", "nl.switch", "nl.frame"]);

export function isReusableElementType(type: string, rendersOwnChildren: boolean): boolean {
    return !rendersOwnChildren && !NON_REUSABLE_TYPES.has(type);
}

/**
 * The fields a render snapshot clones, which therefore differ in identity on every pass even when
 * nothing about them changed. Compared one level deep; every other field by identity.
 */
const CLONED_RECORD_FIELDS: ReadonlySet<string> = new Set(["layout", "props", "style", "valueBindings", "extra"]);

function sameRecord(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) {
        return true;
    }
    if (!a || !b || typeof a !== "object" || typeof b !== "object") {
        return false;
    }
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
        return false;
    }
    for (const key of aKeys) {
        if (!Object.prototype.hasOwnProperty.call(b, key)) {
            return false;
        }
        if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
            return false;
        }
    }
    return true;
}

function sameIdList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
    if (a === b) {
        return true;
    }
    if (!a || !b || a.length !== b.length) {
        return false;
    }
    for (let index = 0; index < a.length; index += 1) {
        if (a[index] !== b[index]) {
            return false;
        }
    }
    return true;
}

/**
 * Whether two resolutions of one element would draw the same.
 *
 * `previous` is a snapshot a renderer has already been handed. Renderers are not supposed to write to
 * it, but if one ever does, the comparison sees a difference and the element is simply rebuilt - the
 * safe direction to be wrong in.
 */
export function sameResolvedElement(previous: UIElement, next: UIElement): boolean {
    if (previous === next) {
        return true;
    }
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    for (const key of keys) {
        const a = (previous as Record<string, unknown>)[key];
        const b = (next as Record<string, unknown>)[key];
        if (key === "childrenIds") {
            if (!sameIdList(a as string[] | undefined, b as string[] | undefined)) {
                return false;
            }
            continue;
        }
        if (CLONED_RECORD_FIELDS.has(key)) {
            if (!sameRecord(a, b)) {
                return false;
            }
            continue;
        }
        if (!Object.is(a, b)) {
            return false;
        }
    }
    return true;
}

export function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let index = 0; index < a.length; index += 1) {
        if (!Object.is(a[index], b[index])) {
            return false;
        }
    }
    return true;
}

export function sameChildren(a: readonly ReactNode[], b: readonly ReactNode[]): boolean {
    return sameDeps(a, b);
}

/**
 * A component instance's param values, as one comparable value.
 *
 * Resolved into a fresh record on every pass, and small: a handful of strings an author typed.
 */
export function componentParamsKey(params: Record<string, string> | null): string {
    if (!params) {
        return "";
    }
    return Object.keys(params)
        .sort()
        .map(key => `${key}\u0000${params[key]}`)
        .join("\u0001");
}
