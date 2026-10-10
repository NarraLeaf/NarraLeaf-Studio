/**
 * How an agent names an element of a page, and how a dotted prop key becomes a nested write.
 *
 * An agent names an element the way the `.ui` text format prints it: by id, or by its path of names
 * from the page root down (`Title / Menu / Start`), with a bare name accepted when it is unique on
 * the page. Pure over an element pool, because the document holds every page's elements in one
 * table and the answer has to stay inside the page the call named.
 *
 * Comments in English per project convention.
 */

import type { UIElement, UIElementId } from "@shared/types/ui-editor/document";

export type UIElementPool = Readonly<Record<UIElementId, UIElement>>;

export type UIElementRefResult =
    | { kind: "found"; element: UIElement }
    | { kind: "missing" }
    | { kind: "ambiguous"; candidates: UIElement[] };

/** The names from the root down to `element`, a nameless element standing in by its type. */
export function uiElementPathSegments(pool: UIElementPool, element: UIElement): string[] {
    const names: string[] = [];
    let current: UIElement | undefined = element;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        names.unshift(current.name ?? current.type);
        current = current.parentId ? pool[current.parentId] : undefined;
    }
    return names;
}

/** The same path as one line, in the spelling the `.ui` format and `ui_surfaces` print. */
export function uiElementPath(pool: UIElementPool, element: UIElement): string {
    return uiElementPathSegments(pool, element).join(" / ");
}

/** Every element under `rootId`, the root first, depth first in child order. */
export function listUiSubtree(pool: UIElementPool, rootId: UIElementId): UIElement[] {
    const out: UIElement[] = [];
    const stack: UIElementId[] = [rootId];
    const seen = new Set<string>();
    while (stack.length > 0) {
        const id = stack.pop()!;
        if (seen.has(id)) {
            continue;
        }
        seen.add(id);
        const element = pool[id];
        if (!element) {
            continue;
        }
        out.push(element);
        for (const childId of [...(element.childrenIds ?? [])].reverse()) {
            stack.push(childId);
        }
    }
    return out;
}

/**
 * The element `ref` names under `rootId`.
 *
 * Tried in order: an id, a path (` / ` or `/` between names, with or without the root's own name
 * first), a bare name. A name two elements share is ambiguous rather than "the first one", because
 * an agent that edits the wrong `Button` has done something worse than fail.
 */
export function resolveUiElementRef(pool: UIElementPool, rootId: UIElementId, ref: string): UIElementRefResult {
    const wanted = ref.trim();
    if (!wanted) {
        return { kind: "missing" };
    }
    const subtree = listUiSubtree(pool, rootId);
    const byId = subtree.find(element => element.id === wanted);
    if (byId) {
        return { kind: "found", element: byId };
    }

    const segments = wanted.split("/").map(segment => segment.trim()).filter(Boolean);
    if (segments.length > 1) {
        const matches = subtree.filter(element => {
            const path = uiElementPathSegments(pool, element);
            return endsWithPath(path, segments) && (path.length === segments.length || path.length === segments.length + 1);
        });
        return pick(matches);
    }

    return pick(subtree.filter(element => (element.name ?? element.type) === wanted));
}

function endsWithPath(path: readonly string[], segments: readonly string[]): boolean {
    if (segments.length > path.length) {
        return false;
    }
    const offset = path.length - segments.length;
    return segments.every((segment, index) => path[offset + index] === segment);
}

function pick(matches: UIElement[]): UIElementRefResult {
    if (matches.length === 0) {
        return { kind: "missing" };
    }
    if (matches.length > 1) {
        return { kind: "ambiguous", candidates: matches };
    }
    return { kind: "found", element: matches[0] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Turn a props patch that may use `.ui` dotted keys into one keyed by top-level prop.
 *
 * `imageFill.assetId: "x"` merges into a copy of the element's current `imageFill` rather than
 * replacing it, so the fit and the position it already had survive; a plain key replaces its prop
 * whole, as a write to that prop always has. The result is what `updateElementProps` merges.
 */
export function buildUiPropsPatch(current: Readonly<Record<string, unknown>>, patch: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
        const segments = key.split(".").filter(Boolean);
        if (segments.length <= 1) {
            out[key] = value;
            continue;
        }
        const [top, ...rest] = segments;
        const base = top in out ? out[top] : current[top];
        const root: Record<string, unknown> = isPlainObject(base) ? JSON.parse(JSON.stringify(base)) : {};
        let cursor = root;
        for (const segment of rest.slice(0, -1)) {
            const next = cursor[segment];
            cursor[segment] = isPlainObject(next) ? { ...next } : {};
            cursor = cursor[segment] as Record<string, unknown>;
        }
        cursor[rest[rest.length - 1]] = value;
        out[top] = root;
    }
    return out;
}
