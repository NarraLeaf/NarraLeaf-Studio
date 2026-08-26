import { encodeCanonicalJson } from "@shared/documents/canonicalJson";
import { fnv1a64BytesHex } from "@shared/utils/contentHash";
import type {
    UIComponentDefinition,
    UIComponentId,
    UIDocument,
    UIElement,
    UIElementId,
    UISurface,
    UISurfaceId,
} from "@shared/types/ui-editor/document";
import type { UIInputActionDef } from "@shared/types/ui-editor/inputAction";
import type { UIStructDef, UIStructId } from "@shared/types/ui-editor/struct";

/**
 * The interface document as a set of records, which is what a live session can carry of it.
 *
 * ## Why records, and not gestures
 *
 * Every editing gesture in the interface editor reaches the document through
 * `UIDocumentService.mutateDocument(mutator)`, and the mutator is an opaque closure. Above it sit
 * some forty named methods - `updateElementLayout`, `deleteElements`, `createComponentFromElements`
 * - and below it there is one door. So the finest thing the owning service can say **truthfully** at
 * the one point every edit passes through is not "a button moved": it is *which records the document
 * now holds differently*. That answer is reached by running the mutator against a copy and comparing
 * (see {@link diffUIParts}), and it has a property no enumeration of gestures has - **it is
 * exhaustive by construction**. The forty methods that exist today and the forty-first that lands
 * next month are all covered, and none of them has to know a session exists.
 *
 * The alternative - one verb per gesture - was rejected for the reason the whole vocabulary is
 * built on: a document is writable during a session exactly when the session can carry its changes,
 * and a partial list of verbs over a writable path is an edit that lands on one machine and nowhere
 * else, with no digest over it. Forty verbs would have to be complete on the day they were written
 * and stay complete for ever.
 *
 * ## What the records are
 *
 * The document is a handful of maps and two ordered lists, and every part below is addressed by an
 * id that outlives the edit:
 *
 *  - **elements** - the one flat map every Surface's tree is built out of. This is the unit the
 *    interface is actually authored in, and it is what a claim is over.
 *  - **component elements** - each component definition owns a *second* element map, keyed the same
 *    way but in its own address space. Held apart rather than merged, because a component's elements
 *    are not in `document.elements` and never resolve to a Surface.
 *  - **surfaces** and **components** - their records without the trees, so that carrying one costs
 *    a few hundred bytes rather than the whole screen.
 *  - **structs**, **actions** - the two document-level tables an element points into by id.
 *  - the document's own **name**.
 *
 * ⚠ **A component travels without its `elements`.** The largest component in the shipped skeleton is
 * 24 KB whole and 400 bytes without them, and the message cap is 16 KB - so a shell that carried its
 * tree would be a component nobody could rename inside a session. Its elements travel beside it
 * under {@link LiveUIParts.componentElements}, one record each, exactly as a Surface's do.
 */

/** A component's record with its element map taken off. See the note on {@link LiveUIParts}. */
export type LiveUIComponentShell = Omit<UIComponentDefinition, "elements">;

/**
 * Which records the interface document now holds differently, and which of them are gone.
 *
 * **`null` is "removed", an absent key is "unchanged".** The two have to be distinguishable: a
 * delta that spelled removal as absence would be unable to say anything about a deletion, and one
 * that carried every record would be a whole-document last-writer-wins - which is exactly what the
 * claim rule exists to prevent.
 *
 * ⚠ **The two ordered lists carry their order whole whenever they change at all.** `surfaces` and
 * `components` are arrays in the document and the panel draws them in that order, so a delta that
 * named only the changed entries would leave "where does a new Surface go" to each machine's own
 * guess. Carrying the id list costs a few dozen bytes and settles it.
 */
export type LiveUIParts = {
    /** Records of the shared element map. */
    elements?: Readonly<Record<UIElementId, UIElement | null>>;
    /** Records of one component's own element map, by component id. */
    componentElements?: Readonly<Record<UIComponentId, Readonly<Record<UIElementId, UIElement | null>>>>;
    /** Surface records. Their trees are in {@link elements}. */
    surfaces?: Readonly<Record<UISurfaceId, UISurface | null>>;
    /** Every Surface id, in the order the document lists them. Present whenever {@link surfaces} is. */
    surfaceOrder?: readonly UISurfaceId[];
    /** Component records without their elements. See {@link LiveUIComponentShell}. */
    components?: Readonly<Record<UIComponentId, LiveUIComponentShell | null>>;
    /** Every component id, in document order. Present whenever {@link components} is. */
    componentOrder?: readonly UIComponentId[];
    /** The shapes widgets describe their data with. */
    structs?: Readonly<Record<UIStructId, UIStructDef | null>>;
    /** What the gestures of this project mean. */
    actions?: Readonly<Record<string, UIInputActionDef | null>>;
    /** The document's own name, when it changed. */
    name?: string;
};

/** One element, and which map it lives in. `componentId` is null for a Surface's own elements. */
export type LiveUIElementRef = {
    componentId: UIComponentId | null;
    elementId: UIElementId;
};

/* ------------------------------------------------------------------------ diff */

/**
 * What changed between two states of the document, or null when nothing did.
 *
 * **Called with the document as it stands and a copy the mutator has just run against.** Nothing
 * here reads the gesture: the comparison is the statement, which is what makes it impossible for a
 * new gesture to slip past the vocabulary.
 *
 * Null rather than an empty delta because a mutation that changed nothing must not become a message.
 * Several of the service's methods are no-ops against the wrong element, and a room full of empty
 * operations would cost a broadcast, a sequence number and an undo step each.
 */
export function diffUIParts(before: UIDocument, after: UIDocument): LiveUIParts | null {
    const parts: LiveUIParts = {};
    let changed = false;

    const elements = diffRecordMap(before.elements, after.elements);
    if (elements) {
        parts.elements = elements;
        changed = true;
    }

    const componentElements: Record<UIComponentId, Record<UIElementId, UIElement | null>> = {};
    const beforeComponents = indexById(before.components);
    const afterComponents = indexById(after.components);
    for (const [componentId, component] of Object.entries(afterComponents)) {
        // A component that has just appeared brings its whole tree, because none of it is anywhere
        // else. One that was already here brings only what moved.
        const previous = beforeComponents[componentId]?.elements ?? {};
        const delta = diffRecordMap(previous, component.elements ?? {});
        if (delta) {
            componentElements[componentId] = delta;
        }
    }
    // Nothing is emitted for a component that is gone: its elements went with it, and naming them
    // would be a second statement of a removal the component record already makes.
    if (Object.keys(componentElements).length > 0) {
        parts.componentElements = componentElements;
        changed = true;
    }

    const surfaces = diffRecordMap(indexById(before.surfaces), indexById(after.surfaces));
    if (surfaces) {
        parts.surfaces = surfaces;
        parts.surfaceOrder = after.surfaces.map(surface => surface.id);
        changed = true;
    } else if (!sameOrder(before.surfaces, after.surfaces)) {
        parts.surfaces = {};
        parts.surfaceOrder = after.surfaces.map(surface => surface.id);
        changed = true;
    }

    const components = diffRecordMap(
        shellsById(before.components),
        shellsById(after.components),
    );
    if (components) {
        parts.components = components;
        parts.componentOrder = (after.components ?? []).map(component => component.id);
        changed = true;
    } else if (!sameOrder(before.components ?? [], after.components ?? [])) {
        parts.components = {};
        parts.componentOrder = (after.components ?? []).map(component => component.id);
        changed = true;
    }

    const structs = diffRecordMap(before.structs ?? {}, after.structs ?? {});
    if (structs) {
        parts.structs = structs;
        changed = true;
    }

    const actions = diffRecordMap(before.actions ?? {}, after.actions ?? {});
    if (actions) {
        parts.actions = actions;
        changed = true;
    }

    if (before.name !== after.name) {
        parts.name = after.name;
        changed = true;
    }

    return changed ? parts : null;
}

/* ----------------------------------------------------------------------- apply */

/**
 * Write one delta into the document, in place.
 *
 * The one applier both roles use: the host runs it on the copy that counts and every guest runs it
 * on its own, so an arrival and a local edit change the document in exactly one way. It is
 * deliberately total - there is no "if this record is still here" anywhere below - because the
 * decisions about what may be applied were made before this was reached, by the host.
 *
 * ⚠ **The values are written as given, not cloned here.** The caller owns that: a record taken
 * straight out of a message the sender may still be holding has to be copied, and a record produced
 * by this machine's own diff does not.
 */
export function applyUIParts(document: UIDocument, parts: LiveUIParts): void {
    if (parts.elements) {
        writeRecordMap(document.elements, parts.elements);
    }
    // ⚠ The component records first, then their elements. A component that has just appeared has
    // nowhere to put its tree until its own record is there, and a component whose record is being
    // written keeps whatever elements this machine already holds - the shell travels without them.
    if (parts.components) {
        const existing = indexById(document.components);
        const shells = parts.components;
        const order = parts.componentOrder ?? Object.keys(shells);
        const next: UIComponentDefinition[] = [];
        for (const componentId of order) {
            const shell = Object.prototype.hasOwnProperty.call(shells, componentId)
                ? shells[componentId]
                : undefined;
            if (shell === null) {
                continue;
            }
            const previous = existing[componentId];
            if (shell === undefined) {
                if (previous) {
                    next.push(previous);
                }
                continue;
            }
            next.push({ ...shell, elements: previous?.elements ?? {} });
        }
        document.components = next;
    }
    if (parts.componentElements) {
        for (const [componentId, delta] of Object.entries(parts.componentElements)) {
            const component = (document.components ?? []).find(entry => entry.id === componentId);
            if (!component) {
                // A delta naming a component nobody has is applied as far as it can be rather than
                // thrown: an applier that threw would leave every machine holding half a message.
                continue;
            }
            component.elements = component.elements ?? {};
            writeRecordMap(component.elements, delta);
        }
    }
    if (parts.surfaces) {
        const existing = indexById(document.surfaces);
        const records = parts.surfaces;
        const order = parts.surfaceOrder ?? Object.keys(records);
        const next: UISurface[] = [];
        for (const surfaceId of order) {
            const record = Object.prototype.hasOwnProperty.call(records, surfaceId)
                ? records[surfaceId]
                : undefined;
            if (record === null) {
                continue;
            }
            const resolved = record ?? existing[surfaceId];
            if (resolved) {
                next.push(resolved);
            }
        }
        document.surfaces = next;
    }
    if (parts.structs) {
        document.structs = document.structs ?? {};
        writeRecordMap(document.structs, parts.structs);
    }
    if (parts.actions) {
        document.actions = document.actions ?? {};
        writeRecordMap(document.actions, parts.actions);
    }
    if (parts.name !== undefined) {
        document.name = parts.name;
    }
}

/* ---------------------------------------------------------------------- claims */

/**
 * Every element a delta writes or removes, in the order it names them.
 *
 * What a claim check asks. **A claim is over an element**, because that is what has a draft layer
 * behind it: the properties panel keeps a half-typed label in its own state and reaches the document
 * on a throttle or on blur, so the loser of a race loses a sentence they have just written and
 * nothing on any screen reports it. The Surface list, a Surface's name and the component library's
 * order are last-writer-wins for the reason a scene name is - losing one costs a word.
 *
 * ⚠ **A delta about a drag names the elements it re-parented, so a drag asks for their claims too.**
 * That is deliberately stricter than the ruling that a drag is not worth *holding* a claim for: a
 * claim is only ever held while somebody has an inspector field focused, so the only gesture this
 * refuses is one that would have overwritten that field's record while they were typing into it -
 * which is the injury the rule is about.
 */
export function uiPartsElements(parts: LiveUIParts): readonly LiveUIElementRef[] {
    const refs: LiveUIElementRef[] = [];
    for (const elementId of Object.keys(parts.elements ?? {})) {
        refs.push({ componentId: null, elementId });
    }
    for (const [componentId, delta] of Object.entries(parts.componentElements ?? {})) {
        for (const elementId of Object.keys(delta)) {
            refs.push({ componentId, elementId });
        }
    }
    return refs;
}

/**
 * The elements a delta CHANGES rather than creates, as the state it was computed against had them.
 *
 * **What the host checks before applying, and the interface document's answer to `row-gone`.** A
 * delta states what the document now holds, so nothing in its shape distinguishes "here is a new
 * button" from "here is a button somebody deleted while I was dragging it" - and applied blind, the
 * second of those puts a deleted element back on everybody's screen with every machine agreeing
 * about it, which is the one failure a digest cannot see. The sender knows which of the two it meant,
 * because it knows what its own copy held, so it says.
 *
 * Only elements: they are what an author looks at. A Surface or a component that comes back is
 * visible in a list somebody is looking at, and refusing there would cost more than it saved.
 */
export function uiPartsUpdates(before: UIDocument, parts: LiveUIParts): readonly LiveUIElementRef[] {
    const updates: LiveUIElementRef[] = [];
    for (const [elementId, record] of Object.entries(parts.elements ?? {})) {
        if (record !== null && before.elements[elementId]) {
            updates.push({ componentId: null, elementId });
        }
    }
    const components = indexById(before.components);
    for (const [componentId, delta] of Object.entries(parts.componentElements ?? {})) {
        const held = components[componentId]?.elements ?? {};
        for (const [elementId, record] of Object.entries(delta)) {
            if (record !== null && held[elementId]) {
                updates.push({ componentId, elementId });
            }
        }
    }
    return updates;
}

/**
 * The same records as this delta names, as the document holds them **now**.
 *
 * What an inverse is built out of. A delta states what the document is about to hold and nothing
 * about what it held, exactly as `update-block` carries the new payload and not the old one, so undo
 * needs the other half read off the document immediately before the operation lands.
 *
 * Every value is copied. The document is mutated in place, and a record that pointed into it would
 * describe the state *after* the operation - which is the one mistake an inverse must not make.
 */
export function uiPartsBefore(document: UIDocument, parts: LiveUIParts): LiveUIParts {
    const before: LiveUIParts = {};
    if (parts.elements) {
        const elements: Record<UIElementId, UIElement | null> = {};
        for (const elementId of Object.keys(parts.elements)) {
            elements[elementId] = copy(document.elements[elementId] ?? null);
        }
        before.elements = elements;
    }
    if (parts.componentElements) {
        const components = indexById(document.components);
        const componentElements: Record<UIComponentId, Record<UIElementId, UIElement | null>> = {};
        for (const [componentId, delta] of Object.entries(parts.componentElements)) {
            const held = components[componentId]?.elements ?? {};
            const elements: Record<UIElementId, UIElement | null> = {};
            for (const elementId of Object.keys(delta)) {
                elements[elementId] = copy(held[elementId] ?? null);
            }
            componentElements[componentId] = elements;
        }
        before.componentElements = componentElements;
    }
    if (parts.surfaces) {
        const held = indexById(document.surfaces);
        const surfaces: Record<UISurfaceId, UISurface | null> = {};
        for (const surfaceId of Object.keys(parts.surfaces)) {
            surfaces[surfaceId] = copy(held[surfaceId] ?? null);
        }
        before.surfaces = surfaces;
        before.surfaceOrder = document.surfaces.map(surface => surface.id);
    }
    if (parts.components) {
        const held = shellsById(document.components);
        const components: Record<UIComponentId, LiveUIComponentShell | null> = {};
        for (const componentId of Object.keys(parts.components)) {
            components[componentId] = copy(held[componentId] ?? null);
        }
        before.components = components;
        before.componentOrder = (document.components ?? []).map(component => component.id);
    }
    if (parts.structs) {
        const structs: Record<UIStructId, UIStructDef | null> = {};
        for (const structId of Object.keys(parts.structs)) {
            structs[structId] = copy(document.structs?.[structId] ?? null);
        }
        before.structs = structs;
    }
    if (parts.actions) {
        const actions: Record<string, UIInputActionDef | null> = {};
        for (const actionId of Object.keys(parts.actions)) {
            actions[actionId] = copy(document.actions?.[actionId] ?? null);
        }
        before.actions = actions;
    }
    if (parts.name !== undefined) {
        before.name = document.name;
    }
    return before;
}

/**
 * Every element a delta puts back rather than removes, which is what its own precondition names.
 *
 * The inverse's counterpart to {@link uiPartsUpdates}, and it needs no document: a record that was
 * there before the operation is there after it too - the operation either changed it or left it - so
 * every non-null element in a captured "before" is an update rather than a creation.
 */
export function uiPartsRestored(parts: LiveUIParts): readonly LiveUIElementRef[] {
    const refs: LiveUIElementRef[] = [];
    for (const [elementId, record] of Object.entries(parts.elements ?? {})) {
        if (record !== null) {
            refs.push({ componentId: null, elementId });
        }
    }
    for (const [componentId, delta] of Object.entries(parts.componentElements ?? {})) {
        for (const [elementId, record] of Object.entries(delta)) {
            if (record !== null) {
                refs.push({ componentId, elementId });
            }
        }
    }
    return refs;
}

function copy<T>(value: T): T {
    return value === null || value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** Whether one element is in the document a delta would be applied to. What the host asks. */
export function uiHasElement(document: UIDocument | null, ref: LiveUIElementRef): boolean {
    if (!document) {
        return false;
    }
    if (ref.componentId === null) {
        return Boolean(document.elements[ref.elementId]);
    }
    const component = (document.components ?? []).find(entry => entry.id === ref.componentId);
    return Boolean(component?.elements?.[ref.elementId]);
}

/* --------------------------------------------------------------------- digests */

/**
 * Which units a delta changed, so that each of them can be fingerprinted.
 *
 * **Answered against both states of the document rather than from the delta alone**, and that is why
 * it is not `opDigestScope`'s job. Which Surface an element belongs to is a question about the tree,
 * and for an element that has just been deleted the only place left to ask is the state before -
 * so a scope derived from the message alone would fingerprint everything except the Surface the
 * author just changed.
 *
 * ⚠ The "before" side is the **owner map** rather than the whole document, and deliberately: this
 * runs on every machine for every interface effect, and a copy of the document taken so that it
 * could be walked twice would put a clone of the largest document a project has on the critical
 * path of every nudge of every element. The map is all that is read of it.
 *
 * The shell is reported whenever the delta touches anything the Surface and component digests do not
 * cover: the two ordered lists, the structs, the actions, the document's name, and any element that
 * belongs to no Surface at all.
 */
export function uiPartsTouched(
    ownersBefore: ReadonlyMap<UIElementId, UISurfaceId>,
    after: UIDocument,
    parts: LiveUIParts,
): { surfaces: readonly UISurfaceId[]; components: readonly UIComponentId[]; shell: boolean } {
    const surfaces = new Set<UISurfaceId>();
    const components = new Set<UIComponentId>();
    let shell = Boolean(
        parts.surfaces || parts.components || parts.structs || parts.actions || parts.name !== undefined,
    );

    if (parts.elements) {
        const ownersAfter = uiOwningSurfaceIds(after);
        for (const elementId of Object.keys(parts.elements)) {
            const wasIn = ownersBefore.get(elementId);
            const isIn = ownersAfter.get(elementId);
            if (wasIn) {
                surfaces.add(wasIn);
            }
            if (isIn) {
                surfaces.add(isIn);
            }
            if (!wasIn && !isIn) {
                // An element under no Surface - a tree being assembled, or one left behind. The
                // shell digest covers those, so that no record a delta names goes unfingerprinted.
                shell = true;
            }
        }
    }
    for (const componentId of Object.keys(parts.componentElements ?? {})) {
        components.add(componentId);
    }
    for (const componentId of Object.keys(parts.components ?? {})) {
        components.add(componentId);
    }
    return { surfaces: [...surfaces], components: [...components], shell };
}

/**
 * One Surface's record and its whole tree, or the fact that this machine has no such Surface.
 *
 * **Absence is a value rather than no digest**, with the cast's record digest and against the scene
 * digest: deleting a Surface is an operation like any other, and a machine that failed to apply one
 * has to be caught. Answering null there would rule `unproven` on exactly the effect that proves the
 * two copies parted company.
 */
export function uiSurfaceDigest(document: UIDocument | null, surfaceId: UISurfaceId): string {
    const surface = document?.surfaces.find(entry => entry.id === surfaceId) ?? null;
    if (!document || !surface) {
        return hash({ absent: true });
    }
    const owners = uiOwningSurfaceIds(document);
    const elements: Record<UIElementId, UIElement> = {};
    for (const [elementId, owner] of owners) {
        if (owner === surfaceId) {
            elements[elementId] = document.elements[elementId];
        }
    }
    return hash({ surface, elements: pruneUndefined(elements) });
}

/** One component definition, whole - its record and its own element map. */
export function uiComponentDigest(document: UIDocument | null, componentId: UIComponentId): string {
    const component = (document?.components ?? []).find(entry => entry.id === componentId) ?? null;
    return hash(component === null ? { absent: true } : { component: pruneUndefined(component) });
}

/**
 * Everything about the document that no Surface and no component covers.
 *
 * The two ordered lists as ids, the two document-level tables, the name, and the elements that
 * belong to no Surface. **Cheap on purpose**: it carries no element bodies except the orphans, so it
 * can be computed on every effect without the cost the per-document digest this design refuses would
 * have - one `JSON.stringify` of a large interface document is milliseconds, and it would be paid on
 * every nudge of every element on every machine in the room.
 */
export function uiShellDigest(document: UIDocument | null): string {
    if (!document) {
        return hash({ absent: true });
    }
    const owners = uiOwningSurfaceIds(document);
    const orphans: Record<UIElementId, UIElement> = {};
    for (const elementId of Object.keys(document.elements)) {
        if (!owners.has(elementId)) {
            orphans[elementId] = document.elements[elementId];
        }
    }
    return hash({
        name: document.name,
        surfaceOrder: document.surfaces.map(surface => surface.id),
        componentOrder: (document.components ?? []).map(component => component.id),
        structs: pruneUndefined(document.structs ?? {}),
        actions: pruneUndefined(document.actions ?? {}),
        orphans: pruneUndefined(orphans),
    });
}

/* ------------------------------------------------------------------------ tree */

/**
 * The Surface every element belongs to, for the whole document, in one pass.
 *
 * Each parent chain is walked at most once: the walk stops as soon as it reaches an element whose
 * answer is already known, then writes that answer back down the chain it came up. Elements that
 * reach no Surface - orphans, and a parent cycle if a document is ever damaged - are simply absent.
 *
 * Shared rather than owned by the blueprint coordinator that used to hold it, because a session's
 * digests and that reconciliation have to agree about which Surface an element is under: two walks
 * would be two answers, and the one a digest disagreed over would eject a machine from the room.
 */
export function uiOwningSurfaceIds(document: UIDocument): Map<UIElementId, UISurfaceId> {
    const surfaceIdByRootElementId = new Map<UIElementId, UISurfaceId>();
    for (const surface of document.surfaces) {
        surfaceIdByRootElementId.set(surface.rootElementId, surface.id);
    }

    const resolved = new Map<UIElementId, UISurfaceId | null>();
    for (const startId of Object.keys(document.elements)) {
        if (resolved.has(startId)) {
            continue;
        }
        const chain: UIElementId[] = [];
        const onChain = new Set<UIElementId>();
        let cursor: UIElementId | null = startId;
        let answer: UISurfaceId | null = null;
        while (cursor) {
            if (resolved.has(cursor)) {
                answer = resolved.get(cursor) ?? null;
                break;
            }
            if (onChain.has(cursor)) {
                // A parentId cycle: nothing here belongs to a Surface.
                break;
            }
            const element: UIElement | undefined = document.elements[cursor];
            if (!element) {
                break;
            }
            chain.push(cursor);
            onChain.add(cursor);
            if (element.parentId === null) {
                answer = surfaceIdByRootElementId.get(cursor) ?? null;
                break;
            }
            cursor = element.parentId;
        }
        for (const elementId of chain) {
            resolved.set(elementId, answer);
        }
    }

    const owners = new Map<UIElementId, UISurfaceId>();
    for (const [elementId, surfaceId] of resolved) {
        if (surfaceId) {
            owners.set(elementId, surfaceId);
        }
    }
    return owners;
}

/* --------------------------------------------------------------------- helpers */

/**
 * What changed between two maps of records, or null when nothing did.
 *
 * The comparison is structural rather than by reference, and it has to be: the service mutates its
 * records in place, so the copy a mutator ran against holds different objects throughout even where
 * nothing was touched. Reference equality would report the whole document on every keystroke.
 */
function diffRecordMap<T>(
    before: Readonly<Record<string, T>>,
    after: Readonly<Record<string, T>>,
): Record<string, T | null> | null {
    const delta: Record<string, T | null> = {};
    let changed = false;
    for (const [id, record] of Object.entries(after)) {
        if (!sameJsonValue(before[id], record)) {
            delta[id] = record;
            changed = true;
        }
    }
    for (const id of Object.keys(before)) {
        if (!Object.prototype.hasOwnProperty.call(after, id)) {
            delta[id] = null;
            changed = true;
        }
    }
    return changed ? delta : null;
}

/** Write one delta into one map, in place. `null` removes. */
function writeRecordMap<T>(target: Record<string, T>, delta: Readonly<Record<string, T | null>>): void {
    for (const [id, record] of Object.entries(delta)) {
        if (record === null) {
            delete target[id];
        } else {
            target[id] = record;
        }
    }
}

function indexById<T extends { id: string }>(list: readonly T[] | undefined): Record<string, T> {
    const index: Record<string, T> = {};
    for (const entry of list ?? []) {
        index[entry.id] = entry;
    }
    return index;
}

function shellsById(list: readonly UIComponentDefinition[] | undefined): Record<string, LiveUIComponentShell> {
    const index: Record<string, LiveUIComponentShell> = {};
    for (const entry of list ?? []) {
        const { elements: _elements, ...shell } = entry;
        index[entry.id] = shell;
    }
    return index;
}

function sameOrder(before: readonly { id: string }[], after: readonly { id: string }[]): boolean {
    return before.length === after.length && before.every((entry, index) => entry.id === after[index].id);
}

/**
 * Whether two values would be written to disk identically.
 *
 * `undefined` and an absent key are the same thing here, for the reason `assets` prunes before
 * hashing: a record spread through `{ ...element, name: undefined }` holds a key a record parsed off
 * disk does not, and `JSON.stringify` writes neither. Calling those two different would put an
 * operation on the wire for an edit that changed nothing.
 */
function sameJsonValue(left: unknown, right: unknown): boolean {
    if (left === right) {
        return true;
    }
    if (left === undefined || right === undefined || left === null || right === null) {
        return false;
    }
    if (typeof left !== "object" || typeof right !== "object") {
        return false;
    }
    if (Array.isArray(left) !== Array.isArray(right)) {
        return false;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length && left.every((entry, index) => sameJsonValue(entry, right[index]));
    }
    const leftEntries = definedEntries(left as Record<string, unknown>);
    const rightEntries = definedEntries(right as Record<string, unknown>);
    if (leftEntries.length !== rightEntries.length) {
        return false;
    }
    for (const key of leftEntries) {
        if (!sameJsonValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key])) {
            return false;
        }
    }
    return true;
}

function definedEntries(value: Record<string, unknown>): string[] {
    return Object.keys(value).filter(key => value[key] !== undefined);
}

/**
 * The same value with every `undefined`-valued property dropped, at any depth.
 *
 * The canonical encoder rejects an `undefined` property by name, and the interface services produce
 * them freely - a record spread through `{ ...element, extra: undefined }` holds a key whose value is
 * `undefined` where a record parsed off disk has no key at all. Those two are the same document, so
 * hashing them differently would eject a machine from the room over a difference no file can hold.
 */
function pruneUndefined(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(pruneUndefined);
    }
    if (value === null || typeof value !== "object") {
        return value;
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (entry !== undefined) {
            out[key] = pruneUndefined(entry);
        }
    }
    return out;
}

function hash(content: unknown): string {
    return fnv1a64BytesHex(new TextEncoder().encode(encodeCanonicalJson(content)));
}
