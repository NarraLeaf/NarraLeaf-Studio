import { parseBrandLink } from "./brandLink";

/**
 * Who is pointing at the project's palette, and from where.
 *
 * Two callers, asking the same question for different reasons:
 *
 * - the delete confirmation, which needs a count ("3 places use this colour") before it lets an
 *   author remove an entry out from under them;
 * - the `brand/broken-link` lint rule, which needs the site spelled out so a finding names something
 *   the author can go and open.
 *
 * **Every string in the document is tested, rather than a list of props known to hold colours.** The
 * set of fields that may carry a link grows every time another inspector is taught about the palette,
 * and a whitelist here would be a second list that has to grow with it - silently missing references
 * (and so under-counting a delete) for as long as nobody noticed. Reading a value the walk had no
 * business reading costs nothing: `parseBrandLink` refuses everything that is not a link, and the
 * documents involved are small enough that scanning all of one is not worth a subtree filter that
 * could be wrong.
 *
 * Every input is `unknown` and read defensively. These documents are on disk, they are versioned, and
 * a merge or a hand-edit can put anything at all in them - and the one place a broken document must
 * not throw is the code whose whole job is to report broken documents.
 *
 * Comments in English per project convention.
 */

export type BrandLinkReference = {
    /** The brand id the link names, whether or not the palette has an entry for it. */
    id: string;
    /**
     * The site as a reader would name it: `Main Menu › Start › style.backgroundColor`.
     *
     * Breadcrumb segments and then the path within the object, which is the same shape the workspace
     * spells a location in elsewhere. **Names only, no nouns** - no "surface"/"element" labels - so
     * that the string can be dropped into a zh sentence without carrying English words into it. The
     * trailing prop path stays in its document spelling because that *is* its name; there is no
     * translated word for `style.backgroundColor`.
     */
    where: string;
    /** The same site, structured - what a caller navigates or groups by. */
    location: { surfaceId?: string; elementId?: string; characterId?: string; propPath: string };
};

/** Joins the breadcrumb segments of {@link BrandLinkReference.where}. */
export const BRAND_REFERENCE_SEPARATOR = " › ";

/**
 * How deep the walk goes before it stops descending.
 *
 * Not a shape limit - a UI element nests a handful of levels - but a guard on a document nobody meant
 * to write. Together with the ancestor set below it means no input can turn this into an unbounded
 * walk or a stack overflow.
 */
const MAX_WALK_DEPTH = 32;

/** What a reference is filed under, before the prop path is appended. */
type ReferenceSite = {
    /** Breadcrumb segments, outermost first. */
    trail: readonly string[];
    surfaceId?: string;
    elementId?: string;
    characterId?: string;
};

export function collectBrandLinkReferences(input: {
    uidoc?: unknown;
    characters?: unknown;
    // A named object rather than positional parameters: the sources this has to cover grow with the
    // feature (scene settings and plugin documents are both expected), and a caller that only has one
    // of them should not have to spell the others.
}): BrandLinkReference[] {
    const references: BrandLinkReference[] = [];
    collectFromUiDocument(input.uidoc, references);
    collectFromCharacters(input.characters, references);
    return references;
}

/** How many references each id has, ids nothing points at absent rather than zero. */
export function countBrandLinkReferences(refs: readonly BrandLinkReference[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const ref of refs) {
        counts.set(ref.id, (counts.get(ref.id) ?? 0) + 1);
    }
    return counts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * Every string under `node`, with the path it was found at.
 *
 * The ancestor set is added to on the way down and removed on the way back up, so a ring stops the
 * walk while a value that merely appears twice is still visited twice. A parsed JSON document has
 * neither, but this is fed `unknown` - including, in tests and in a caller that hands over live
 * service state, an object graph that was built rather than parsed.
 */
function walkStrings(
    node: unknown,
    path: string,
    visit: (value: string, path: string) => void,
    ancestors: Set<object>,
    depth: number,
): void {
    if (typeof node === "string") {
        visit(node, path);
        return;
    }
    if (typeof node !== "object" || node === null || depth > MAX_WALK_DEPTH || ancestors.has(node)) {
        return;
    }
    ancestors.add(node);
    if (Array.isArray(node)) {
        node.forEach((item, index) => walkStrings(item, `${path}[${index}]`, visit, ancestors, depth + 1));
    } else {
        for (const [key, value] of Object.entries(node)) {
            walkStrings(value, path ? `${path}.${key}` : key, visit, ancestors, depth + 1);
        }
    }
    ancestors.delete(node);
}

function pushReferences(node: unknown, basePath: string, site: ReferenceSite, out: BrandLinkReference[]): void {
    walkStrings(node, basePath, (value, propPath) => {
        const link = parseBrandLink(value);
        if (!link) {
            return;
        }
        out.push({
            id: link.id,
            where: [...site.trail, propPath].filter(Boolean).join(BRAND_REFERENCE_SEPARATOR),
            location: {
                ...(site.surfaceId ? { surfaceId: site.surfaceId } : {}),
                ...(site.elementId ? { elementId: site.elementId } : {}),
                ...(site.characterId ? { characterId: site.characterId } : {}),
                propPath,
            },
        });
    }, new Set<object>(), 0);
}

/**
 * What to call an element in a breadcrumb.
 *
 * Name, then type, then id - which is how the UI editor's own layer list names it
 * (`UISurfaceEditorTab.tsx`: `element.name || element.type`). Most elements are never renamed, so
 * falling straight from the name to the id would spell nearly every finding as a uuid; `nl.button`
 * under a named surface is a thing the author can actually find.
 */
function elementLabel(element: Record<string, unknown>, elementId: string): string {
    return text(element.name) || text(element.type) || elementId;
}

/** The element ids a surface owns directly: its root, plus a stage surface's slot roots. */
function surfaceRootIds(surface: Record<string, unknown>): string[] {
    const roots = [text(surface.rootElementId)];
    if (isRecord(surface.slots)) {
        for (const slot of Object.values(surface.slots)) {
            if (isRecord(slot)) {
                roots.push(text(slot.rootElementId));
            }
        }
    }
    return roots.filter(Boolean);
}

/**
 * Mark every element reachable from `rootId` as belonging to `owner`.
 *
 * First claim wins, which is also what stops a `childrenIds` ring: an id already in the map is not
 * descended into a second time.
 */
function claimSubtree(
    rootId: string,
    elements: Record<string, unknown>,
    owner: { id: string; label: string },
    into: Map<string, { id: string; label: string }>,
): void {
    const stack = [rootId];
    while (stack.length > 0) {
        const id = stack.pop();
        if (!id || into.has(id)) {
            continue;
        }
        into.set(id, owner);
        const element = elements[id];
        const children = isRecord(element) && Array.isArray(element.childrenIds) ? element.childrenIds : [];
        for (const child of children) {
            if (typeof child === "string") {
                stack.push(child);
            }
        }
    }
}

function collectFromUiDocument(raw: unknown, out: BrandLinkReference[]): void {
    if (!isRecord(raw)) {
        return;
    }
    const elements = isRecord(raw.elements) ? raw.elements : {};
    const surfaces = Array.isArray(raw.surfaces) ? raw.surfaces : [];

    // The elements record is flat and document-wide, so which surface an element belongs to is only
    // knowable by walking down from each surface's root. Worth the walk: "Main Menu › Start" is a
    // place an author can open, and an element id on its own is not.
    const ownerByElementId = new Map<string, { id: string; label: string }>();

    for (const entry of surfaces) {
        if (!isRecord(entry)) {
            continue;
        }
        const surfaceId = text(entry.id);
        const owner = { id: surfaceId, label: text(entry.name) || surfaceId };
        // The surface's own settings - `backgroundColor` lives here rather than on any element.
        pushReferences(entry.settings, "settings", { trail: [owner.label], surfaceId }, out);
        for (const rootId of surfaceRootIds(entry)) {
            claimSubtree(rootId, elements, owner, ownerByElementId);
        }
    }

    for (const [elementId, entry] of Object.entries(elements)) {
        if (!isRecord(entry)) {
            continue;
        }
        const owner = ownerByElementId.get(elementId);
        const label = elementLabel(entry, elementId);
        pushReferences(entry, "", {
            // An element no surface reaches is still reported - it is still a reference, and an
            // orphan is exactly the sort of row a delete count must not quietly leave out.
            trail: owner ? [owner.label, label] : [label],
            ...(owner ? { surfaceId: owner.id } : {}),
            elementId,
        }, out);
    }

    // A component keeps its own element table, and its instances are drawn from it - a link in there
    // paints on every surface that uses the component, so missing it would under-count badly.
    const components = Array.isArray(raw.components) ? raw.components : [];
    for (const entry of components) {
        if (!isRecord(entry)) {
            continue;
        }
        const label = text(entry.name) || text(entry.id);
        const owned = isRecord(entry.elements) ? entry.elements : {};
        for (const [elementId, element] of Object.entries(owned)) {
            if (!isRecord(element)) {
                continue;
            }
            // No surfaceId: a component is not a surface, and pretending it were would hand the lint
            // report a jump target that opens the wrong editor.
            pushReferences(element, "", { trail: [label, elementLabel(element, elementId)], elementId }, out);
        }
    }
}

function collectFromCharacters(raw: unknown, out: BrandLinkReference[]): void {
    // A list, a map keyed by id, or the document that wraps one - the three shapes a caller might
    // reasonably hand over, none of which is worth making a caller normalize first.
    const wrapped = isRecord(raw) && "characters" in raw ? raw.characters : raw;
    const entries = Array.isArray(wrapped)
        ? wrapped
        : isRecord(wrapped)
            ? Object.values(wrapped)
            : [];

    for (const entry of entries) {
        if (!isRecord(entry)) {
            continue;
        }
        const characterId = text(entry.id);
        pushReferences(entry, "", {
            trail: [text(entry.name) || characterId],
            characterId,
        }, out);
    }
}
