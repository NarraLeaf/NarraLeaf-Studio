import type {
    UIComponentDefinition,
    UIDocument,
    UIElement,
    UISurface,
} from "@shared/types/ui-editor/document";
import {buildDocumentDiff, DocumentChange, DocumentDiff} from "../diff";
import {authoredName, byId, change, diffKeyed, fromToParams, sameJsonValue} from "./diffHelpers";
import {isJsonObject} from "./parseHelpers";

/**
 * What changed in the interface, in the units an author sees on the canvas: Surfaces and elements.
 *
 * # Addressing, which is the contract
 *
 * Every row's `path` names the thing it is about so that a consumer can find it **without reading a
 * word of display text**, because the surface this feeds draws a mask over the element that changed
 * and needs an id, not a sentence:
 *
 * ```
 * ["name"]                                            the document's own name
 * ["surfaces", <surfaceId>]                           a Surface appeared, went, or its own fields changed
 * ["surfaces", <surfaceId>, <field>]                  one of those fields
 * ["surfaces", <surfaceId>, "elements", <elementId>]  an element of that Surface
 * ["surfaces", <surfaceId>, "elements", <elementId>, <property>]
 * ["components", <componentId>]                       a component definition, on the same terms
 * ["components", <componentId>, "elements", <elementId>[, <property>]]
 * ["elements", <elementId>[, <property>]]             an element no Surface and no component can reach
 * ```
 *
 * Path length disambiguates: two segments under `surfaces` is the Surface itself, four is an element
 * of it. The last form is not a fallback for convenience - it is the literal shape of the document,
 * and it is where an element that has come loose from every root ends up.
 *
 * **The nesting under `surfaces` is not how the file is written, and that is deliberate.** On disk
 * `elements` is one flat map at the document root and a Surface holds only a `rootElementId`; an
 * element is attributed to a Surface here by walking the tree from that root. The flat address would
 * be honest about the bytes and useless to every consumer, all of which need to know which canvas to
 * draw on. Where the walk cannot answer - an element under no root at all - the row falls back to the
 * flat address rather than guessing an owner.
 *
 * **This is safe for a comparison and would not be safe for a merge**, which is worth knowing before
 * anyone adds `merge3` here. An element dragged from one Surface to another is addressed by whichever
 * side owns it, so the two sides name it differently - and `DocumentMergeDecision` is built on both
 * sides naming one thing the same way. A merge for this format has to settle its addressing first;
 * see the refusal at the foot of this module for why there is no merge to begin with.
 *
 * # Two rules the shape follows from
 *
 *  - **An element is the group, and a Surface is not.** One element that gained five properties is
 *    one group of five leaves, which is one mask with five reasons in it; five top-level rows would
 *    be five masks over one element. `DocumentChange.children` is one level deep and this is what
 *    that level is spent on.
 *  - **A whole new Surface is one row.** Adding a Surface adds twenty entries to the flat element
 *    map, and reporting those beside "a Surface was added" describes one act twenty-one times. The
 *    element rows for an added or removed Surface are folded into the Surface's own row, with the
 *    count in its label - the same treatment the story spec gives a new scene.
 *
 * Pure and non-throwing, per the `DocumentSpec.diff` contract, and defensive about every field: these
 * documents came out of a repository and may predate any schema this build knows (`uiDocumentSpec`
 * does not migrate), so nothing here may assume a field exists or holds the type it is declared with.
 */

const LABEL = {
    renamed: "documentDiff.uiDocument.renamed",
    surfaceAdded: "documentDiff.uiDocument.surfaceAdded",
    surfaceRemoved: "documentDiff.uiDocument.surfaceRemoved",
    surfaceChanged: "documentDiff.uiDocument.surfaceChanged",
    surfaceRenamed: "documentDiff.uiDocument.surfaceRenamed",
    surfaceDesignSize: "documentDiff.uiDocument.surfaceDesignSize",
    surfaceSettings: "documentDiff.uiDocument.surfaceSettings",
    surfaceRoot: "documentDiff.uiDocument.surfaceRoot",
    surfaceField: "documentDiff.uiDocument.surfaceField",
    componentAdded: "documentDiff.uiDocument.componentAdded",
    componentRemoved: "documentDiff.uiDocument.componentRemoved",
    componentChanged: "documentDiff.uiDocument.componentChanged",
    componentRenamed: "documentDiff.uiDocument.componentRenamed",
    componentField: "documentDiff.uiDocument.componentField",
    elementAdded: "documentDiff.uiDocument.elementAdded",
    elementRemoved: "documentDiff.uiDocument.elementRemoved",
    elementChanged: "documentDiff.uiDocument.elementChanged",
    elementRenamed: "documentDiff.uiDocument.elementRenamed",
    elementType: "documentDiff.uiDocument.elementType",
    elementMoved: "documentDiff.uiDocument.elementMoved",
    elementOrder: "documentDiff.uiDocument.elementOrder",
    elementLayout: "documentDiff.uiDocument.elementLayout",
    elementStyle: "documentDiff.uiDocument.elementStyle",
    elementProps: "documentDiff.uiDocument.elementProps",
    elementBehavior: "documentDiff.uiDocument.elementBehavior",
    elementBinding: "documentDiff.uiDocument.elementBinding",
    elementAnimation: "documentDiff.uiDocument.elementAnimation",
    elementField: "documentDiff.uiDocument.elementField",
} as const;

/** Surface fields with no label of their own; the raw identifier goes in the label's `{field}`. */
const SURFACE_FIELDS = ["host", "kind", "mount", "slots"] as const;

/** Element properties that get their own words, because each is a different kind of edit. */
const ELEMENT_PROPERTIES: readonly {readonly key: string; readonly label: string}[] = [
    {key: "layout", label: LABEL.elementLayout},
    {key: "style", label: LABEL.elementStyle},
    {key: "props", label: LABEL.elementProps},
    {key: "behavior", label: LABEL.elementBehavior},
    {key: "valueBindings", label: LABEL.elementBinding},
    {key: "animation", label: LABEL.elementAnimation},
];

/** The rest, reported by name. `extra` carries the component link among other things. */
const ELEMENT_FIELDS = ["extra"] as const;

/** Component definition fields worth a row. `elements` gets element rows; the timestamps get nothing. */
const COMPONENT_FIELDS = ["rootElementId", "params", "previewMeta"] as const;

export function diffUIDocument(
    base: UIDocument,
    head: UIDocument,
    options: {limit: number},
): DocumentDiff {
    const left = indexDocument(base);
    const right = indexDocument(head);
    const order = readingOrder(left, right);
    const rows = new RankedRows(order);

    if (!sameJsonValue(base?.name, head?.name)) {
        rows.push(DOCUMENT_SLOT, change(["name"], "changed", LABEL.renamed, {
            params: fromToParams(base?.name, head?.name),
            subject: authoredName(head?.name),
        }));
    }

    const gone = surfaceRows(left, right, rows);
    componentRows(left, right, rows);
    elementRows(left, right, rows, gone);

    return buildDocumentDiff(rows.sorted(), {tier: "semantic", limit: options.limit});
}

// ---------------------------------------------------------------------------
// Surfaces, components, elements
// ---------------------------------------------------------------------------

/** Surfaces present on one side only, whose elements are folded into the Surface's own row. */
interface FoldedSurfaces {
    readonly added: ReadonlySet<string>;
    readonly removed: ReadonlySet<string>;
}

function surfaceRows(left: DocumentIndex, right: DocumentIndex, rows: RankedRows): FoldedSurfaces {
    const added = new Set<string>();
    const removed = new Set<string>();

    for (const entry of diffKeyed(left.surfaces, right.surfaces)) {
        const path = ["surfaces", entry.key];
        const slot = surfaceSlot(entry.key);
        if (!entry.base || !entry.head) {
            const present = (entry.head ?? entry.base) as UISurface;
            const side = entry.head ? right : left;
            (entry.head ? added : removed).add(entry.key);
            rows.push(slot, change(path, entry.kind, entry.head ? LABEL.surfaceAdded : LABEL.surfaceRemoved, {
                subject: authoredName(present?.name),
                params: {elements: (side.treeOf.get(entry.key) ?? []).length},
            }));
            continue;
        }

        const subject = authoredName(entry.head.name) ?? authoredName(entry.base.name);
        const children = surfaceLeaves(path, entry.base, entry.head, subject);
        // A Surface record holds no elements, so it differs only when one of its own fields does -
        // but an unknown future field would leave `children` empty, and a childless group counts as
        // zero and would show the author nothing. The bare row says "this Surface changed", which is
        // less than the truth but never a silence.
        rows.push(slot, change(path, "changed", LABEL.surfaceChanged, {subject, children}));
    }

    return {added, removed};
}

function surfaceLeaves(
    path: readonly string[],
    base: UISurface,
    head: UISurface,
    subject: string | undefined,
): DocumentChange[] {
    const leaves: DocumentChange[] = [];

    if (!sameJsonValue(base.name, head.name)) {
        leaves.push(change([...path, "name"], "changed", LABEL.surfaceRenamed, {
            params: fromToParams(base.name, head.name),
            subject: authoredName(head.name) ?? subject,
        }));
    }
    if (!sameJsonValue(base.designSize, head.designSize)) {
        // The four numbers only when all four are numbers: a template with a placeholder nothing
        // fills renders as `{fromWidth}` at the author, so a half-written design size falls back to
        // the generic row rather than to a broken sentence.
        const size = designSizeParams(base.designSize, head.designSize);
        leaves.push(size
            ? change([...path, "designSize"], "changed", LABEL.surfaceDesignSize, {params: size, subject})
            : change([...path, "designSize"], "changed", LABEL.surfaceField, {params: {field: "designSize"}, subject}));
    }
    if (!sameJsonValue(base.rootElementId, head.rootElementId)) {
        leaves.push(change([...path, "rootElementId"], "changed", LABEL.surfaceRoot, {subject}));
    }
    if (!sameJsonValue(base.settings, head.settings)) {
        leaves.push(change([...path, "settings"], "changed", LABEL.surfaceSettings, {subject}));
    }
    for (const field of SURFACE_FIELDS) {
        const was = (base as unknown as Record<string, unknown>)[field];
        const now = (head as unknown as Record<string, unknown>)[field];
        if (!sameJsonValue(was, now)) {
            leaves.push(change([...path, field], "changed", LABEL.surfaceField, {params: {field}, subject}));
        }
    }
    return leaves;
}

function componentRows(left: DocumentIndex, right: DocumentIndex, rows: RankedRows): void {
    for (const entry of diffKeyed(left.components, right.components)) {
        const path = ["components", entry.key];
        const slot = componentSlot(entry.key);
        if (!entry.base || !entry.head) {
            const present = (entry.head ?? entry.base) as UIComponentDefinition;
            rows.push(slot, change(path, entry.kind, entry.head ? LABEL.componentAdded : LABEL.componentRemoved, {
                subject: authoredName(present?.name),
                params: {elements: Object.keys(elementsOf(present)).length},
            }));
            continue;
        }

        const subject = authoredName(entry.head.name) ?? authoredName(entry.base.name);
        const children: DocumentChange[] = [];
        if (!sameJsonValue(entry.base.name, entry.head.name)) {
            children.push(change([...path, "name"], "changed", LABEL.componentRenamed, {
                params: fromToParams(entry.base.name, entry.head.name),
                subject: authoredName(entry.head.name) ?? subject,
            }));
        }
        for (const field of COMPONENT_FIELDS) {
            const was = (entry.base as unknown as Record<string, unknown>)[field];
            const now = (entry.head as unknown as Record<string, unknown>)[field];
            if (!sameJsonValue(was, now)) {
                children.push(change([...path, field], "changed", LABEL.componentField, {params: {field}, subject}));
            }
        }
        // Unlike a Surface, a component's record CONTAINS its elements - so it differs whenever any
        // of them does, and a bare "the component changed" row beside the element rows would be the
        // same news twice. Only the component's own fields earn a row here.
        if (children.length > 0) {
            rows.push(slot, change(path, "changed", LABEL.componentChanged, {subject, children}));
        }

        const shared = sharedKeys(elementsOf(entry.base), elementsOf(entry.head));
        for (const element of diffKeyed(elementsOf(entry.base), elementsOf(entry.head))) {
            rows.push(
                componentElementSlot(entry.key, element.key),
                elementRow(["components", entry.key, "elements", element.key], element.base, element.head, shared),
            );
        }
    }
}

function elementRows(left: DocumentIndex, right: DocumentIndex, rows: RankedRows, gone: FoldedSurfaces): void {
    const shared = sharedKeys(left.elements, right.elements);

    for (const entry of diffKeyed(left.elements, right.elements)) {
        // The head's owner wins, so an element dragged from one Surface to another is addressed
        // where it is now; a deleted one keeps the address it had.
        const owner = right.surfaceOf.get(entry.key) ?? left.surfaceOf.get(entry.key);
        if (entry.head && !entry.base && owner !== undefined && gone.added.has(owner)) {
            continue;
        }
        if (entry.base && !entry.head && owner !== undefined && gone.removed.has(owner)) {
            continue;
        }

        const path = owner === undefined
            ? ["elements", entry.key]
            : ["surfaces", owner, "elements", entry.key];
        rows.push(elementSlot(entry.key), elementRow(path, entry.base, entry.head, shared));
    }
}

function elementRow(
    path: readonly string[],
    base: UIElement | undefined,
    head: UIElement | undefined,
    shared: ReadonlySet<string>,
): DocumentChange {
    if (!base || !head) {
        const present = (head ?? base) as UIElement;
        return change(path, head ? "added" : "removed", head ? LABEL.elementAdded : LABEL.elementRemoved, {
            subject: authoredName(present?.name),
        });
    }

    const subject = authoredName(head.name) ?? authoredName(base.name);
    return change(path, "changed", LABEL.elementChanged, {
        subject,
        children: elementLeaves(path, base, head, subject, shared),
    });
}

function elementLeaves(
    path: readonly string[],
    base: UIElement,
    head: UIElement,
    subject: string | undefined,
    shared: ReadonlySet<string>,
): DocumentChange[] {
    const leaves: DocumentChange[] = [];

    if (!sameJsonValue(base.name, head.name)) {
        leaves.push(change([...path, "name"], "changed", LABEL.elementRenamed, {
            params: fromToParams(base.name, head.name),
            subject: authoredName(head.name) ?? subject,
        }));
    }
    if (!sameJsonValue(base.type, head.type)) {
        leaves.push(change([...path, "type"], "changed", LABEL.elementType, {
            params: fromToParams(base.type, head.type),
            subject,
        }));
    }
    // Re-parenting and re-ordering are the two ways an element travels, and both are `moved`: the
    // consumer draws them differently from an edit to what the element IS.
    if (!sameJsonValue(base.parentId, head.parentId)) {
        leaves.push(change([...path, "parentId"], "moved", LABEL.elementMoved, {subject}));
    }
    // Compared over the children both sides hold. Inserting a button changes its parent's list, and
    // reporting "the children were reordered" beside "an element was added" describes one act twice -
    // what survives the filter is the author really having rearranged this element's children.
    const wasChildren = childIdsIn(base, shared);
    const nowChildren = childIdsIn(head, shared);
    if (!sameJsonValue(wasChildren, nowChildren)) {
        leaves.push(change([...path, "childrenIds"], "moved", LABEL.elementOrder, {subject}));
    }
    for (const property of ELEMENT_PROPERTIES) {
        const was = (base as unknown as Record<string, unknown>)[property.key];
        const now = (head as unknown as Record<string, unknown>)[property.key];
        if (!sameJsonValue(was, now)) {
            leaves.push(change([...path, property.key], "changed", property.label, {subject}));
        }
    }
    for (const field of ELEMENT_FIELDS) {
        const was = (base as unknown as Record<string, unknown>)[field];
        const now = (head as unknown as Record<string, unknown>)[field];
        if (!sameJsonValue(was, now)) {
            leaves.push(change([...path, field], "changed", LABEL.elementField, {params: {field}, subject}));
        }
    }
    return leaves;
}

// ---------------------------------------------------------------------------
// Reading the document
// ---------------------------------------------------------------------------

/** One side of the comparison, with the tree walked once so nothing below has to walk it again. */
interface DocumentIndex {
    readonly surfaces: Record<string, UISurface>;
    /** Surface ids in the order the document lists them - the order the panel shows. */
    readonly surfaceOrder: readonly string[];
    readonly components: Record<string, UIComponentDefinition>;
    readonly componentOrder: readonly string[];
    readonly elements: Record<string, UIElement>;
    /** Element id to the Surface whose root reaches it. Absent for an element no root reaches. */
    readonly surfaceOf: ReadonlyMap<string, string>;
    /** Surface id to its elements, depth first from the root - the order an author reads the tree. */
    readonly treeOf: ReadonlyMap<string, readonly string[]>;
    readonly componentTreeOf: ReadonlyMap<string, readonly string[]>;
    /** Elements in the flat map that no Surface root reaches, sorted so the order is stable. */
    readonly orphans: readonly string[];
}

function indexDocument(document: UIDocument | undefined): DocumentIndex {
    const surfaceList = Array.isArray(document?.surfaces) ? (document?.surfaces as UISurface[]) : [];
    const componentList = Array.isArray(document?.components)
        ? (document?.components as UIComponentDefinition[])
        : [];
    const surfaces = byId<UISurface>(surfaceList);
    const components = byId<UIComponentDefinition>(componentList);
    const elements: Record<string, UIElement> = isJsonObject(document?.elements)
        ? (document?.elements as Record<string, UIElement>)
        : {};

    const surfaceOf = new Map<string, string>();
    const treeOf = new Map<string, readonly string[]>();
    const surfaceOrder = surfaceList
        .map(surface => surface?.id)
        .filter((id): id is string => typeof id === "string" && Object.prototype.hasOwnProperty.call(surfaces, id));
    for (const surfaceId of surfaceOrder) {
        const tree = walkTree(elements, surfaces[surfaceId]?.rootElementId, surfaceOf.has.bind(surfaceOf));
        treeOf.set(surfaceId, tree);
        for (const elementId of tree) {
            surfaceOf.set(elementId, surfaceId);
        }
    }

    const componentTreeOf = new Map<string, readonly string[]>();
    const componentOrder = componentList
        .map(component => component?.id)
        .filter((id): id is string => typeof id === "string" && Object.prototype.hasOwnProperty.call(components, id));
    for (const componentId of componentOrder) {
        const own = elementsOf(components[componentId]);
        componentTreeOf.set(componentId, walkTree(own, components[componentId]?.rootElementId, () => false));
    }

    const orphans = Object.keys(elements).filter(id => !surfaceOf.has(id)).sort();
    return {surfaces, surfaceOrder, components, componentOrder, elements, surfaceOf, treeOf, componentTreeOf, orphans};
}

/**
 * Depth first from `rootId`, in the author's child order, over the elements that really exist.
 *
 * `claimed` keeps an element that two roots both reach with the first of them, and the local `seen`
 * set keeps a cycle from being an infinite walk - neither is reachable through the editor, and both
 * are reachable through a repository holding a document some other build wrote.
 */
function walkTree(
    elements: Readonly<Record<string, UIElement>>,
    rootId: unknown,
    claimed: (id: string) => boolean,
): string[] {
    if (typeof rootId !== "string" || rootId.length === 0) {
        return [];
    }
    const out: string[] = [];
    const seen = new Set<string>();
    const stack: string[] = [rootId];
    while (stack.length > 0) {
        const id = stack.pop() as string;
        if (seen.has(id) || claimed(id) || !Object.prototype.hasOwnProperty.call(elements, id)) {
            continue;
        }
        seen.add(id);
        out.push(id);
        const children = elements[id]?.childrenIds;
        if (Array.isArray(children)) {
            // Pushed backwards so `pop` hands them back in the order the author arranged them.
            for (let index = children.length - 1; index >= 0; index -= 1) {
                const child = children[index];
                if (typeof child === "string") {
                    stack.push(child);
                }
            }
        }
    }
    return out;
}

function elementsOf(component: UIComponentDefinition | undefined): Record<string, UIElement> {
    const elements = (component as {elements?: unknown} | undefined)?.elements;
    return isJsonObject(elements) ? (elements as Record<string, UIElement>) : {};
}

function childIdsIn(element: UIElement, shared: ReadonlySet<string>): string[] {
    const children = element?.childrenIds;
    return Array.isArray(children) ? children.filter(id => typeof id === "string" && shared.has(id)) : [];
}

/** The keys both sides hold - the only ones an ordering can be compared over. */
function sharedKeys(base: Readonly<Record<string, unknown>>, head: Readonly<Record<string, unknown>>): Set<string> {
    return new Set(Object.keys(head).filter(key => Object.prototype.hasOwnProperty.call(base, key)));
}

function designSizeParams(base: unknown, head: unknown): Record<string, number> | undefined {
    const was = base as {width?: unknown; height?: unknown} | undefined;
    const now = head as {width?: unknown; height?: unknown} | undefined;
    const numbers = [was?.width, was?.height, now?.width, now?.height];
    if (!numbers.every(value => typeof value === "number" && Number.isFinite(value))) {
        return undefined;
    }
    const [fromWidth, fromHeight, toWidth, toHeight] = numbers as number[];
    return {fromWidth, fromHeight, toWidth, toHeight};
}

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

/**
 * Separator for the composite keys below: a control character, because an authored id may
 * contain anything a name may contain and a printable separator would eventually collide.
 *
 * SOH rather than NUL, and that is not a detail. Git decides a file is binary by looking for a
 * NUL byte in its first few kilobytes, so one NUL here takes the whole module out of every diff
 * and every review it will ever appear in, silently. SOH gives the same guarantee and keeps the
 * file text.
 */
const SLOT_SEPARATOR = String.fromCharCode(1);

const DOCUMENT_SLOT = "";

const surfaceSlot = (surfaceId: string): string => `s${SLOT_SEPARATOR}${surfaceId}`;
const elementSlot = (elementId: string): string => `e${SLOT_SEPARATOR}${elementId}`;
const componentSlot = (componentId: string): string => `c${SLOT_SEPARATOR}${componentId}`;
const componentElementSlot = (componentId: string, elementId: string): string => `x${SLOT_SEPARATOR}${componentId}${SLOT_SEPARATOR}${elementId}`;

/**
 * Every place a row can sit, in the order an author would read them, head first and then base.
 *
 * Head first so the list matches what the author is looking at now; base afterwards so a Surface or
 * an element that was DELETED still lands near where it used to be rather than at the end. This has
 * to exist before anything is truncated - the discipline `buildDocumentDiff` documents - because the
 * rows come out of keyed maps in id order, and generated ids are exactly the ordering that means
 * nothing to the person reading the list.
 */
function readingOrder(left: DocumentIndex, right: DocumentIndex): Map<string, number> {
    const order = new Map<string, number>();
    const at = (slot: string): void => {
        if (!order.has(slot)) {
            order.set(slot, order.size);
        }
    };

    at(DOCUMENT_SLOT);
    for (const side of [right, left]) {
        for (const surfaceId of side.surfaceOrder) {
            at(surfaceSlot(surfaceId));
            for (const elementId of side.treeOf.get(surfaceId) ?? []) {
                at(elementSlot(elementId));
            }
        }
        for (const componentId of side.componentOrder) {
            at(componentSlot(componentId));
            for (const elementId of side.componentTreeOf.get(componentId) ?? []) {
                at(componentElementSlot(componentId, elementId));
            }
            for (const elementId of Object.keys(elementsOf(side.components[componentId])).sort()) {
                at(componentElementSlot(componentId, elementId));
            }
        }
        for (const elementId of side.orphans) {
            at(elementSlot(elementId));
        }
    }
    return order;
}

/** Rows plus where they belong, so the list can be ordered once at the end and never after truncating. */
class RankedRows {
    private readonly entries: {row: DocumentChange; rank: number; built: number}[] = [];

    constructor(private readonly order: ReadonlyMap<string, number>) {}

    public push(slot: string, row: DocumentChange): void {
        this.entries.push({
            row,
            rank: this.order.get(slot) ?? Number.MAX_SAFE_INTEGER,
            built: this.entries.length,
        });
    }

    /** Build order is the tie-break, so rows sharing a slot keep the order they were produced in. */
    public sorted(): DocumentChange[] {
        return [...this.entries]
            .sort((a, b) => (a.rank - b.rank) || (a.built - b.built))
            .map(entry => entry.row);
    }
}

/**
 * There is no `merge3` here, and its absence is the answer rather than a gap.
 *
 * A Surface's tree is one arrangement, held in `childrenIds` arrays and absolute coordinates that
 * only mean anything relative to each other. Two authors who both rearranged one Surface can be
 * interleaved into a layout that parses, renders, and was written by neither of them - overlapping
 * elements, a button inside a panel it was never meant to be in - with nothing on screen saying a
 * decision was taken. That is the failure `DocumentMergeRefusal` exists for, and the story spec's
 * merge takes the same view of a restructured scene.
 *
 * So the first tier answers instead: the author takes the whole file from one side, which is a
 * choice they can see the result of. Declaring `merge3` only to refuse from inside it would buy the
 * same outcome and one more thing that has to be kept true.
 */
