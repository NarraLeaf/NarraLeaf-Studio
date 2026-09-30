import { useCallback, useLayoutEffect, useRef } from "react";
import type { UIWidgetEventDispatch } from "@/lib/ui-editor/runtime/widgetEventDispatch";

/**
 * A renderer's `dispatchEvent`, as one function for the life of the widget.
 *
 * The element tree binds the dispatch afresh on every render - it is a closure over the drawing - so
 * handing it straight to a callback's dependencies would rebuild the callback, and an effect that
 * subscribes one (a list's scroll listener) would unsubscribe and resubscribe on every render. This
 * keeps one function and has it call whichever binding is current, which is the same drawing unless
 * the widget has been moved into another one.
 */
export function useWidgetEventDispatch(dispatchEvent: UIWidgetEventDispatch | undefined): UIWidgetEventDispatch {
    const latest = useRef(dispatchEvent);
    useLayoutEffect(() => {
        latest.current = dispatchEvent;
    });
    return useCallback<UIWidgetEventDispatch>(
        (eventName, payload, redirect) => latest.current?.(eventName, payload, redirect) ?? Promise.resolve(),
        [],
    );
}
