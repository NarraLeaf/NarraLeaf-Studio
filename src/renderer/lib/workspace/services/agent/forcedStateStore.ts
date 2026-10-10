/**
 * A widget runtime store that shows chosen elements in one interaction state, for `ui_screenshot`'s
 * `state` argument.
 *
 * An offscreen page has no pointer and no focus, so a photograph of it is always the resting look,
 * and an agent asked to give every button a hover and a pressed look had no way to see either. The
 * appearance rows a widget resolves read their conditions from the runtime store
 * (`useWidgetRuntimeElementState` asks `getSignalsForElement`), so answering that one question
 * differently for the chosen elements draws them exactly as the game would in that state - the same
 * rows, the same resolution - without touching the document or the live canvas.
 *
 * The state covers the element and everything drawn inside it, as a pointer over a button is over
 * its label too: a label with its own hover row changes with the button, as it does in the game.
 *
 * Comments in English per project convention.
 */

import type { UIDocument, UIElement, UIElementId } from "@shared/types/ui-editor/document";
import { getUIComponentLink } from "@shared/types/ui-editor/document";
import type { SystemInteractionSignals } from "@/lib/ui-editor/runtime/appearance/SystemInteractionState";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { listUiSubtree, type UIElementPool } from "./uiElementRefs";

export const FORCEABLE_UI_STATES = ["hovered", "active", "focused", "selected", "disabled"] as const;
export type ForceableUIState = (typeof FORCEABLE_UI_STATES)[number];

/**
 * The ids drawn under `elementId`: its own subtree, and the insides of every component placed in it
 * (a placement draws its definition's elements, under the definition's ids).
 */
export function forcedStateElementIds(document: UIDocument, pool: UIElementPool, elementId: UIElementId): Set<string> {
    const ids = new Set<string>();
    const visit = (from: UIElementPool, rootId: UIElementId, seenComponents: Set<string>) => {
        for (const element of listUiSubtree(from, rootId)) {
            ids.add(element.id);
            const componentId = getUIComponentLink(element as UIElement)?.componentId;
            if (!componentId || seenComponents.has(componentId)) {
                continue;
            }
            const component = (document.components ?? []).find(item => item.id === componentId);
            if (component) {
                visit(component.elements, component.rootElementId, new Set([...seenComponents, componentId]));
            }
        }
    };
    visit(pool, elementId, new Set());
    return ids;
}

/**
 * Whether a runtime key names one of `ids`. A key is `[scope \0] elementId [\0 instance]` (see
 * `useWidgetRuntimeElementKey`), so any of its segments may be the element.
 */
function keyNamesOneOf(key: string, ids: ReadonlySet<string>): boolean {
    return key.split("\0").some(segment => ids.has(segment));
}

export class ForcedStateStore extends WidgetRuntimeStateStore {
    constructor(
        private readonly ids: ReadonlySet<string>,
        private readonly state: ForceableUIState,
    ) {
        super();
    }

    override getSignalsForElement(elementId: string, interactionDisabled: boolean | undefined): SystemInteractionSignals {
        const signals = super.getSignalsForElement(elementId, interactionDisabled);
        return keyNamesOneOf(elementId, this.ids) ? { ...signals, [this.state]: true } : signals;
    }
}
