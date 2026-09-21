/**
 * The one way a widget raises an event on its own blueprint.
 *
 * An element is drawn in a drawing - a list row, a component placement, both, or neither - and an
 * event it raises has to say which, or the dispatcher answers the wrong question. Without the
 * component the event looks for the element's blueprint on the page, where an element authored inside
 * a definition does not exist, and it is dropped without a word; without the row the graph that
 * answers reads no row and writes to the template, which nothing draws.
 *
 * Pointer events always carried the drawing, because `EditorNodeWrapper` builds their options from
 * it. The events a widget raises by itself - a slider's Value Changed, a switch's Changed, a text
 * input's Submit, a list's Scroll, a button pressed from the keyboard - were each spelled at the
 * widget as `dispatchElementBlueprintEvent(element.id, name, payload)`, and every one of them forgot.
 * So the drawing is bound once, where the element tree knows it, and handed to the renderer as
 * `dispatchEvent`; `EditorNodeWrapper` builds its options from the same function, and
 * `widgetEventsCarryTheDrawing.test.ts` keeps any widget module from dispatching around it.
 *
 * Comments in English per project convention.
 */

import type { UIComponentId } from "@shared/types/ui-editor/document";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
import type { BehaviorGraphEventControl } from "@/lib/ui-editor/behavior-graph/BehaviorNodeRegistry";
import type { UIHostAdapterBlueprintRuntime, UIHostAdapterElementEventOptions } from "./types";

/** Which drawing of an element is on screen: everything an event it raises has to carry. */
export type UIWidgetDrawing = {
    /** The row the element is drawn in, or null outside every list. */
    listItemScope?: UIListItemScope | null;
    /** The drawing's key - its rows and placements, outermost first - or empty for the page's own. */
    instanceKey?: string;
    /** The component definition the element is authored in, or nothing when it is on a page. */
    componentId?: UIComponentId;
    /** Resolved params of the placement the element is drawn in; null outside one. */
    componentParams?: Record<string, string> | null;
};

/**
 * The dispatch options that name `drawing`, or undefined for an element drawn once, on a page.
 *
 * Undefined rather than an object of empty fields, so an ordinary page widget dispatches exactly
 * what it always did.
 */
export function widgetEventOptionsOf(drawing: UIWidgetDrawing): UIHostAdapterElementEventOptions | undefined {
    const { listItemScope, instanceKey, componentId, componentParams } = drawing;
    if (!listItemScope && !instanceKey && !componentId && !componentParams) {
        return undefined;
    }
    return {
        listItemScope: listItemScope ?? null,
        instanceKey: instanceKey || undefined,
        componentId,
        componentParams: componentParams ?? undefined,
    };
}

/**
 * What one call changes about where the event goes, when it is not this widget as drawn.
 *
 * Every field is optional and anything left out is the widget's own drawing - in particular the
 * component it is authored in, which a row of it is still inside.
 */
export type UIWidgetEventRedirect = {
    /**
     * One of the rows this widget draws, rather than the drawing it is in: a list's Item Click is
     * the list's own event, about the pressed row. Present means replace, including with null.
     */
    listItemScope?: UIListItemScope | null;
    /** The key of that row's drawing. */
    instanceKey?: string;
    /** An element this widget draws itself, rather than the widget: a list's rows' contents. */
    elementId?: string;
    /** The DOM half of a pointer event, so a graph that stops it stops the walk as well. */
    eventControl?: BehaviorGraphEventControl;
};

/** Raise `eventName` with `payload` on this element's blueprint, in the drawing it is in. */
export type UIWidgetEventDispatch = (
    eventName: string,
    payload?: Record<string, unknown>,
    redirect?: UIWidgetEventRedirect,
) => Promise<void>;

function redirectedOptions(
    drawing: UIWidgetDrawing,
    redirect: UIWidgetEventRedirect,
): UIHostAdapterElementEventOptions | undefined {
    const options = widgetEventOptionsOf({
        ...drawing,
        ...("listItemScope" in redirect ? { listItemScope: redirect.listItemScope } : {}),
        ...(redirect.instanceKey !== undefined ? { instanceKey: redirect.instanceKey } : {}),
    });
    return redirect.eventControl ? { ...(options ?? {}), eventControl: redirect.eventControl } : options;
}

/**
 * Raise the flush a graph's write set off, in the drawing the write landed on.
 *
 * The host API knows the write's widget address; the drawing the flush runs in is read off it by
 * the runtime (`UIHostAdapterDrawings.optionsForAddress`). Run as the bare element, a flush set off
 * inside a component placement looked for the element on the page, found nothing and was dropped,
 * and one set off in a list row ran with no row to read.
 */
export function dispatchWidgetFlushInDrawing(
    runtime: UIHostAdapterBlueprintRuntime | undefined,
    elementId: string,
    payload: Record<string, unknown>,
    address: string,
): void {
    void runtime?.dispatchElementBlueprintEvent(elementId, "flush", payload, runtime.drawings?.optionsForAddress(address));
}

/** The dispatch a plugin widget renderer is handed: `RuntimeWidgetRendererProps["dispatchEvent"]`. */
export type PluginWidgetEventDispatch = (
    eventName: string,
    payload?: Record<string, unknown>,
    options?: { listItemScope?: UIListItemScope | null; instanceKey?: string },
) => Promise<void>;

/**
 * The element tree's dispatch, narrowed for a plugin's renderer.
 *
 * The same binding a built-in widget gets - this element, in the drawing it is in, component and
 * placement included - so a plugin widget inside a card reaches the card's graph. What a plugin may
 * change is what it always could: which row it means, for a widget that repeats a template of its
 * own. Not another element and not the event control; those stay with the host, which is why the
 * options are copied field by field rather than passed on.
 */
export function narrowWidgetEventDispatchForPlugin(dispatchEvent: UIWidgetEventDispatch | undefined): PluginWidgetEventDispatch {
    return (eventName, payload, options) => {
        if (!dispatchEvent) {
            return Promise.resolve();
        }
        if (!options) {
            return dispatchEvent(eventName, payload);
        }
        const redirect: UIWidgetEventRedirect = {};
        if ("listItemScope" in options) {
            redirect.listItemScope = options.listItemScope;
        }
        if (options.instanceKey !== undefined) {
            redirect.instanceKey = options.instanceKey;
        }
        return dispatchEvent(eventName, payload, redirect);
    };
}

/**
 * Bind an element's own event dispatch to the drawing it is rendered in.
 *
 * A host with no blueprint runtime - the editing canvas - gets a dispatch that does nothing, so a
 * renderer calls it without first asking which host it is in.
 */
export function bindWidgetEventDispatch(
    runtime: UIHostAdapterBlueprintRuntime | undefined,
    elementId: string,
    drawing: UIWidgetDrawing,
): UIWidgetEventDispatch {
    const options = widgetEventOptionsOf(drawing);
    return (eventName, payload, redirect) => {
        if (!runtime) {
            return Promise.resolve();
        }
        return runtime.dispatchElementBlueprintEvent(
            redirect?.elementId ?? elementId,
            eventName,
            payload,
            redirect ? redirectedOptions(drawing, redirect) : options,
        );
    };
}
