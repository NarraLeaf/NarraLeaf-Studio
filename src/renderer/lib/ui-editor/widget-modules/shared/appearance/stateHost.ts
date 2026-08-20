import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import type { UIEditorEnteredState } from "@/lib/workspace/services/services";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";

/** One state a widget can be shown in. `id: null` is the state it rests in. */
export type ElementStateOption = { id: string | null; name: string };

/**
 * The widget whose states everything below it is shown in.
 *
 * A widget that declares states owns them for its whole subtree: its parts do not carry states of
 * their own, they are drawn the way the widget says it is. That is what keeps the design matrix from
 * multiplying - a switch has two states, not two per part - and it is why a part's appearance model
 * holds exactly one variant per state of its host.
 */
export type StateHost = {
    element: UIElement;
    states: ElementStateOption[];
};

/**
 * Every element table a document holds: the surfaces' own, plus one per component definition.
 *
 * A component's elements are not in `document.elements`. An ancestor walk that reads only that table
 * answers "no host" for everything authored inside a component, and answers it silently - the failure
 * that made the first version of this rule collapse the moment an author opened one.
 */
function elementTableFor(document: UIDocument, elementId: string): Record<string, UIElement> | null {
    if (document.elements[elementId]) {
        return document.elements;
    }
    for (const component of document.components ?? []) {
        if (component.elements[elementId]) {
            return component.elements;
        }
    }
    return null;
}

function declaredStatesOf(element: UIElement): ElementStateOption[] | null {
    const states = widgetModuleRegistry.get(element.type)?.listEditorStates?.(element) ?? null;
    return states && states.length > 0 ? states : null;
}

/** The states this element declares itself, if it is a widget that has any. */
export function ownDeclaredStates(element: UIElement | undefined | null): ElementStateOption[] | null {
    return element ? declaredStatesOf(element) : null;
}

/**
 * The nearest ancestor that declares states, or null when this element is nobody's part.
 *
 * Ancestors only: a widget declaring states is the host of its subtree, not of itself.
 */
export function findStateHost(document: UIDocument, elementId: string): StateHost | null {
    const table = elementTableFor(document, elementId);
    if (!table) {
        return null;
    }
    const seen = new Set<string>([elementId]);
    let current = table[elementId]?.parentId ?? null;
    while (current && !seen.has(current)) {
        seen.add(current);
        const ancestor = table[current];
        if (!ancestor) {
            return null;
        }
        const states = declaredStatesOf(ancestor);
        if (states) {
            return { element: ancestor, states };
        }
        current = ancestor.parentId ?? null;
    }
    return null;
}

/**
 * The state this element is being shown in, or `undefined` when nothing above it was entered.
 *
 * `undefined` and `null` are different answers: the first means no state is entered over this
 * element and its geometry is simply its own, the second means the author is looking at the state it
 * rests in - which *is* its own geometry, so both end up writing the layout.
 */
export function enteredVariantIdFor(
    document: UIDocument,
    entered: UIEditorEnteredState | null,
    elementId: string,
): string | null | undefined {
    if (!entered) {
        return undefined;
    }
    const table = elementTableFor(document, elementId);
    if (!table) {
        return undefined;
    }
    const seen = new Set<string>();
    let current: string | null | undefined = elementId;
    while (current && !seen.has(current)) {
        if (current === entered.elementId) {
            return entered.variantId;
        }
        seen.add(current);
        current = table[current]?.parentId ?? null;
    }
    return undefined;
}

/**
 * Whether a move made on this element right now belongs to a state rather than to its own geometry.
 *
 * True only inside a widget that declares states, and only while one that is not the resting state is
 * entered: everywhere else a drag means what it has always meant.
 */
export function stateScopedMoveTarget(
    document: UIDocument,
    entered: UIEditorEnteredState | null,
    elementId: string,
): { variantId: string; host: StateHost } | null {
    const variantId = enteredVariantIdFor(document, entered, elementId);
    if (typeof variantId !== "string") {
        return null;
    }
    const host = findStateHost(document, elementId);
    if (!host || !host.states.some(state => state.id === variantId)) {
        return null;
    }
    return { variantId, host };
}
