import type { DocumentChange } from "@shared/documents/diff";
import type { UIDocument, UISurface } from "@shared/types/ui-editor/document";
import { changeLeafCount, changeMaskTone, maskColumns, type ChangeMaskTone } from "./changeMask";

/**
 * Which mark goes on which element of which page, worked out before anything is drawn.
 *
 * Every decision here is one that can be quietly wrong on screen and obvious in a test - which page
 * to open on, which of the two columns a mark belongs in, what a group of five property edits
 * counts as - so none of them is made inside a component. What is left for the component is the one
 * thing a test cannot check: where on screen the marked element actually is (see
 * `UIDocumentChangeDetail`, which measures it).
 *
 * # It reads paths, never labels
 *
 * `uiDocumentDiff.ts` states its addressing as the contract and this is the consumer that contract
 * exists for. A row about an element is `["surfaces", <surfaceId>, "elements", <elementId>]` - four
 * segments, fixed positions - and nothing here parses a display string to find an id. The two are
 * pinned together by `surfaceDiffPlan.test.ts` running the real spec's diff over two documents.
 *
 * # Every change is accounted for
 *
 * A change either gets a mark or is named in {@link SurfaceDiffPlan.offCanvas}, and the two together
 * are the whole list. That is the property an author has to be able to trust: the index says twelve
 * changes, and twelve is what the canvas and the line under it add up to. A change dropped in
 * silence would make the canvas look like an answer when it is a subset - so there is no branch here
 * that discards one.
 *
 * Three kinds of change genuinely cannot be drawn on a page, and they are the reasons the off-canvas
 * list carries:
 *
 *  - **`component`** - an edit inside a component DEFINITION. Its instances are on the page, but the
 *    elements inside an instance carry no `data-ui-element-id` (every instance of one definition
 *    shares the ids inside it, so if that content were addressable there would be no telling six
 *    placements apart), and marking the whole instance would claim the placement changed when the
 *    definition did.
 *  - **`detached`** - an element no Surface root reaches. It is in the document and on no page.
 *  - **`document`** - the file's own name.
 */

/** A page's size in the coordinates its elements are laid out in. */
export interface CanvasSize {
    readonly width: number;
    readonly height: number;
}

/** What a mark is drawn on. A page's own row marks the frame rather than anything inside it. */
export type SurfaceMaskTarget =
    | { readonly kind: "element"; readonly surfaceId: string; readonly elementId: string }
    | { readonly kind: "surface"; readonly surfaceId: string };

export interface SurfaceMask {
    /**
     * The change's index in `DocumentDiff.changes`.
     *
     * The handle a click hands back, rather than the change object: a selection compared by
     * identity survives nothing, and the path is an array. One index names one row for as long as
     * the diff is the same diff, which is exactly as long as this pane is open.
     */
    readonly index: number;
    readonly change: DocumentChange;
    readonly target: SurfaceMaskTarget;
    readonly tone: ChangeMaskTone;
    /** Changes this one mark stands for - a group of five property edits is one mark and five. */
    readonly leaves: number;
    readonly onBase: boolean;
    readonly onHead: boolean;
}

export type OffCanvasReason = "component" | "detached" | "document";

export interface OffCanvasChange {
    readonly index: number;
    readonly change: DocumentChange;
    readonly reason: OffCanvasReason;
    readonly leaves: number;
}

/** One page an author can look at, on either side of the comparison. */
export interface SurfaceOption {
    readonly id: string;
    /** The author's own name for it, or null when it has none or the page is gone from both sides. */
    readonly name: string | null;
    readonly designSize: CanvasSize | null;
    readonly baseSize: CanvasSize | null;
    readonly headSize: CanvasSize | null;
    readonly inBase: boolean;
    readonly inHead: boolean;
    /** Changes on this page, counted by leaf, so it is the same unit the index shows. */
    readonly changes: number;
}

export interface SurfaceDiffPlan {
    readonly surfaces: readonly SurfaceOption[];
    readonly masks: readonly SurfaceMask[];
    readonly offCanvas: readonly OffCanvasChange[];
    /** The page to open on: the one with the most changes. Null when there are no pages at all. */
    readonly defaultSurfaceId: string | null;
}

export function buildSurfaceDiffPlan(
    changes: readonly DocumentChange[],
    base: UIDocument | null,
    head: UIDocument | null,
): SurfaceDiffPlan {
    const baseSurfaces = readSurfaces(base);
    const headSurfaces = readSurfaces(head);

    const masks: SurfaceMask[] = [];
    const offCanvas: OffCanvasChange[] = [];
    const changesBySurface = new Map<string, number>();

    changes.forEach((change, index) => {
        const leaves = changeLeafCount(change);
        const target = surfaceMaskTarget(change.path);
        if (!target) {
            offCanvas.push({ index, change, reason: offCanvasReason(change.path), leaves });
            return;
        }
        masks.push({
            index,
            change,
            target,
            tone: changeMaskTone(change),
            leaves,
            ...maskColumns(change.kind),
        });
        changesBySurface.set(target.surfaceId, (changesBySurface.get(target.surfaceId) ?? 0) + leaves);
    });

    // Head's pages first and in the order that document lists them, then the ones only the older
    // side had, then any a change names that neither document holds. Head first because it is what
    // the author is looking at now; a deleted page still appears, after them, rather than nowhere.
    const ids: string[] = [];
    const take = (id: string): void => {
        if (!ids.includes(id)) {
            ids.push(id);
        }
    };
    for (const surface of headSurfaces.values()) take(surface.id);
    for (const surface of baseSurfaces.values()) take(surface.id);
    for (const id of changesBySurface.keys()) take(id);

    const surfaces = ids.map<SurfaceOption>(id => {
        const inHead = headSurfaces.get(id);
        const inBase = baseSurfaces.get(id);
        return {
            id,
            name: inHead?.name ?? inBase?.name ?? null,
            // The page is drawn at the size the side it is being drawn FOR declares, and the
            // fallback is the other side rather than nothing: a page whose design size changed is
            // two different boxes, and that difference is a thing the author came here to see.
            designSize: inHead?.designSize ?? inBase?.designSize ?? null,
            baseSize: inBase?.designSize ?? null,
            headSize: inHead?.designSize ?? null,
            inBase: inBase !== undefined,
            inHead: inHead !== undefined,
            changes: changesBySurface.get(id) ?? 0,
        };
    });

    return { surfaces, masks, offCanvas, defaultSurfaceId: busiestSurfaceId(surfaces) };
}

/**
 * Which page to open on: the one with the most changes on it.
 *
 * Ties go to the earlier page in the list, which is head's own order - so a comparison that touched
 * two pages equally opens on the one the author's document lists first rather than on whichever id
 * sorted early. A comparison with no page-level changes at all opens on the first page instead of on
 * nothing, because an empty pane is a worse answer than a page with no marks on it.
 */
function busiestSurfaceId(surfaces: readonly SurfaceOption[]): string | null {
    let best: SurfaceOption | null = null;
    for (const surface of surfaces) {
        if (!best || surface.changes > best.changes) {
            best = surface;
        }
    }
    return best?.id ?? null;
}

/**
 * The element or page one row is about, or null for a row that is about neither.
 *
 * Length and fixed positions decide it, per the addressing contract at the top of
 * `uiDocumentDiff.ts`. A path longer than four under `surfaces` is a leaf that has been handed here
 * on its own - which the tab does not do today, since it selects whole files - and it is read as
 * being about its element rather than refused, because the element is still the thing to mark.
 */
export function surfaceMaskTarget(path: readonly string[]): SurfaceMaskTarget | null {
    if (path[0] !== "surfaces" || typeof path[1] !== "string") {
        return null;
    }
    if (path[2] === "elements" && typeof path[3] === "string") {
        return { kind: "element", surfaceId: path[1], elementId: path[3] };
    }
    return { kind: "surface", surfaceId: path[1] };
}

function offCanvasReason(path: readonly string[]): OffCanvasReason {
    if (path[0] === "components") {
        return "component";
    }
    return path[0] === "elements" ? "detached" : "document";
}

/**
 * The pages one side holds, defensively.
 *
 * These documents came out of a repository and may predate any schema this build knows - the spec
 * that parsed them is a shape gate and runs no migration - so every field is checked rather than
 * assumed, on the same terms the diff itself is written.
 */
export function readSurfaces(document: UIDocument | null): Map<string, {
    id: string;
    name: string | null;
    designSize: CanvasSize | null;
}> {
    const out = new Map<string, { id: string; name: string | null; designSize: CanvasSize | null }>();
    const surfaces = Array.isArray(document?.surfaces) ? (document?.surfaces as UISurface[]) : [];
    for (const surface of surfaces) {
        const id = (surface as { id?: unknown } | null)?.id;
        if (typeof id !== "string" || id.length === 0 || out.has(id)) {
            continue;
        }
        const name = (surface as { name?: unknown }).name;
        out.set(id, {
            id,
            name: typeof name === "string" && name.trim().length > 0 ? name : null,
            designSize: readCanvasSize((surface as { designSize?: unknown }).designSize),
        });
    }
    return out;
}

function readCanvasSize(value: unknown): CanvasSize | null {
    const size = value as { width?: unknown; height?: unknown } | null;
    const width = size?.width;
    const height = size?.height;
    if (typeof width !== "number" || typeof height !== "number") {
        return null;
    }
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
    }
    return { width, height };
}

/**
 * The one scale both columns are drawn at.
 *
 * **Shared, and that is the whole point of computing it here.** Fitting each page to its own column
 * would draw a 1920-wide page and a 1280-wide page at the same width on screen, and a design size
 * that changed - which is a thing that breaks every layout in a project - would look like nothing
 * happened. One scale, taken from whichever side is larger, so the smaller one is smaller.
 *
 * Never above 1: a page is a design in pixels, and magnifying it past its own size would show the
 * author an interface at a size that exists nowhere.
 */
export function sharedSurfaceScale(
    sizes: readonly (CanvasSize | null)[],
    viewport: { readonly width: number; readonly height: number },
): number {
    const present = sizes.filter((size): size is CanvasSize => size !== null);
    if (present.length === 0 || viewport.width <= 0 || viewport.height <= 0) {
        return 1;
    }
    const width = Math.max(...present.map(size => size.width));
    const height = Math.max(...present.map(size => size.height));
    return Math.min(1, viewport.width / width, viewport.height / height);
}

/**
 * What the canvas and the off-canvas line add up to, for the test that pins them to the index.
 *
 * A number rather than an assertion so the failure reads as two numbers rather than as a boolean:
 * "11 accounted for, 12 in the diff" says where to look.
 */
export function accountedChanges(plan: SurfaceDiffPlan): { rows: number; leaves: number } {
    const rows = plan.masks.length + plan.offCanvas.length;
    const leaves = [...plan.masks, ...plan.offCanvas].reduce((total, entry) => total + entry.leaves, 0);
    return { rows, leaves };
}
