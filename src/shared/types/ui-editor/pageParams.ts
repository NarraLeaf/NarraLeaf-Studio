/**
 * Page parameters: the values a page is opened with, declared on the page (`UIPageParam`).
 *
 * Two halves. The first is the declaration read off a document - normalised, typed, and laid over
 * whatever props a page was actually opened with, so every reader of a page's props sees the
 * declared defaults and the declared types. The second is the live table pin resolution reads it from.
 *
 * Comments in English per project convention.
 */

import type { UIPageParam, UIPageParamType, UISurface } from "./document";

/** The kinds a page parameter may be, in the order an inspector offers them. */
export const UI_PAGE_PARAM_TYPES: readonly UIPageParamType[] = ["string", "number", "boolean", "json"];

export function isUIPageParamType(value: unknown): value is UIPageParamType {
    return typeof value === "string" && (UI_PAGE_PARAM_TYPES as readonly string[]).includes(value);
}

/** The blueprint pin type a parameter of this kind is carried on. */
export function uiPageParamBlueprintValueType(type: UIPageParamType): "string" | "float" | "boolean" | "json" {
    switch (type) {
        case "number":
            return "float";
        case "boolean":
            return "boolean";
        case "json":
            return "json";
        default:
            return "string";
    }
}

/**
 * `raw`, as a parameter of `type` holds it.
 *
 * Forgiving on purpose, and in the directions an author would expect: a number typed as text reads as
 * the number, "true" reads as true. A props object is filled by whoever opened the page - a blueprint
 * pin, a script, a JSON literal - and the reader on the other side asked for a type, so the value is
 * turned into one rather than handed over as something its pin does not carry. What cannot be turned
 * into the type at all reads as the type's empty value.
 */
export function coerceUIPageParamValue(type: UIPageParamType, raw: unknown): unknown {
    switch (type) {
        case "string":
            if (typeof raw === "string") {
                return raw;
            }
            return typeof raw === "number" || typeof raw === "boolean" ? String(raw) : "";
        case "number": {
            if (typeof raw === "number") {
                return Number.isFinite(raw) ? raw : 0;
            }
            if (typeof raw === "string" && raw.trim() !== "") {
                const parsed = Number(raw);
                return Number.isFinite(parsed) ? parsed : 0;
            }
            return typeof raw === "boolean" ? (raw ? 1 : 0) : 0;
        }
        case "boolean":
            if (typeof raw === "boolean") {
                return raw;
            }
            if (typeof raw === "string") {
                return raw.trim().toLowerCase() === "true";
            }
            return typeof raw === "number" ? raw !== 0 : false;
        default:
            return raw === undefined ? null : raw;
    }
}

/** What a parameter reads when nothing was given for it: its declared default, or the type's empty value. */
export function uiPageParamDefaultValue(param: Pick<UIPageParam, "type" | "defaultValue">): unknown {
    return coerceUIPageParamValue(param.type, param.defaultValue);
}

/**
 * `raw` as a list of declarations a page may carry, or empty.
 *
 * Every entry is kept to the shape this build reads: an id and a name, both trimmed and both unique
 * on the page - the first of two wins - a known type (an unknown one reads as `string`, the kind that
 * holds anything a text field gives), and a default in that type. An entry without an id or a name
 * is dropped: the id is what a node points at and the name is the key the value travels under, so
 * either one missing leaves nothing to read it by. So is one whose id is not a plain word
 * ({@link isUIPageParamId}).
 */
/**
 * Whether `id` can name a page parameter: letters, digits, `_` and `-`.
 *
 * The id becomes part of an input's id on every node that opens the page (`param_<id>`), and a `.bp`
 * file names that input on a line of its own and as `<node>.<port>` in a wire, where a dot, a colon
 * or a space would be read as the line's own punctuation.
 */
export function isUIPageParamId(id: string): boolean {
    return /^[A-Za-z0-9_-]+$/.test(id);
}

export function normalizeUIPageParams(raw: unknown): UIPageParam[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const ids = new Set<string>();
    const names = new Set<string>();
    const out: UIPageParam[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            continue;
        }
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id.trim() : "";
        const name = typeof record.name === "string" ? record.name.trim() : "";
        if (!id || !name || !isUIPageParamId(id) || ids.has(id) || names.has(name)) {
            continue;
        }
        ids.add(id);
        names.add(name);
        const type = isUIPageParamType(record.type) ? record.type : "string";
        out.push({
            id,
            name,
            type,
            ...(record.defaultValue === undefined ? {} : { defaultValue: coerceUIPageParamValue(type, record.defaultValue) }),
        });
    }
    return out;
}

/** The parameters a surface declares, in author order. A Game UI declares none. */
export function getUIPageParams(surface: Pick<UISurface, "kind"> & { params?: unknown } | null | undefined): UIPageParam[] {
    if (!surface || surface.kind !== "appSurface") {
        return [];
    }
    return normalizeUIPageParams(surface.params);
}

/**
 * A fresh parameter id for a page that already declares `existing`.
 *
 * Generated rather than typed, as a component's are: the id is what the nodes that open the page and
 * read it point at, and an editable one would let a rename unpoint them. Short and readable rather
 * than a uuid, because a `.bp` file names a node's inputs by it.
 */
export function nextUIPageParamId(existing: readonly Pick<UIPageParam, "id">[]): string {
    const taken = new Set(existing.map(param => param.id));
    for (let index = 1; ; index++) {
        const id = `param${index}`;
        if (!taken.has(id)) {
            return id;
        }
    }
}

/**
 * The props a page reads: what it was opened with, over its declared defaults.
 *
 * Laid over once, where a page's host is built, rather than at each reader - a script's
 * `getPageProps()`, a list bound to a page prop, `Get Page Props`, `Get Page Param` - so they cannot
 * disagree about what an unset parameter holds. A declared name that was given is turned into the
 * declared type; a name the page does not declare is passed through untouched, which is what keeps a
 * page opened with props it never declared working exactly as it did.
 */
export function withUIPageParamDefaults(
    surface: Pick<UISurface, "kind"> & { params?: unknown } | null | undefined,
    props: unknown,
): Record<string, unknown> {
    const given = props && typeof props === "object" && !Array.isArray(props) ? (props as Record<string, unknown>) : {};
    const params = getUIPageParams(surface);
    if (params.length === 0) {
        return given;
    }
    const out: Record<string, unknown> = { ...given };
    for (const param of params) {
        out[param.name] = Object.prototype.hasOwnProperty.call(given, param.name) && given[param.name] !== undefined
            ? coerceUIPageParamValue(param.type, given[param.name])
            : uiPageParamDefaultValue(param);
    }
    return out;
}

// ---------------------------------------------------------------------------
// The live declarations
// ---------------------------------------------------------------------------

/*
 * Module-level state, for the reason the save schema's is (`@shared/saves/saveSchemaRegistry`): the
 * readers are pin resolution and node execution, called from the flow canvas, the validator, the
 * linter, the command-line tools and the graph runtime alike, and a document handed down through all
 * of them would be a parameter on every one of those signatures. Each host that holds the interface
 * document publishes it - the editor on every change, Dev Mode and the game from the document they
 * run, the command-line tools from the project they read - and a host that has published nothing
 * reads every page as declaring nothing, which is what an older project is.
 */

let activeParams: ReadonlyMap<string, readonly UIPageParam[]> = new Map();
let activeSignature = "";
let activeRevision = 0;
const listeners = new Set<() => void>();

/**
 * Publish the declarations of `surfaces`.
 *
 * **A publish whose content matches the current one changes nothing** - no revision, no
 * notification. The editor publishes from a subscription that fires for every edit anywhere in the
 * interface, and a bumped revision re-renders every node that opens a page.
 */
export function setActiveUIPageParams(surfaces: readonly (Pick<UISurface, "id" | "kind"> & { params?: unknown })[]): void {
    const next = new Map<string, readonly UIPageParam[]>();
    for (const surface of surfaces) {
        const params = getUIPageParams(surface);
        if (params.length > 0) {
            next.set(surface.id, params);
        }
    }
    const signature = JSON.stringify([...next.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    if (signature === activeSignature) {
        return;
    }
    activeParams = next;
    activeSignature = signature;
    activeRevision += 1;
    // Over a copy: a listener may unsubscribe from inside its own callback.
    for (const listener of [...listeners]) {
        listener();
    }
}

/** The parameters the page `surfaceId` declares, as last published. Empty for any other id. */
export function getActiveUIPageParams(surfaceId: string | null | undefined): readonly UIPageParam[] {
    return surfaceId ? activeParams.get(surfaceId) ?? [] : [];
}

/** One parameter of one page, as last published. */
export function getActiveUIPageParam(surfaceId: string | null | undefined, paramId: string): UIPageParam | undefined {
    return getActiveUIPageParams(surfaceId).find(param => param.id === paramId);
}

/** Bumped by every publish that changed something. */
export function getActiveUIPageParamsRevision(): number {
    return activeRevision;
}

export function subscribeActiveUIPageParams(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
