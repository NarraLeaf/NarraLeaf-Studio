import type { BehaviorGraphEventControl } from "@/lib/ui-editor/behavior-graph/BehaviorNodeRegistry";

const DOM_EVENT_CONTROLS = new WeakMap<Event, BehaviorGraphEventControl>();

export function createEventPropagationControl(onStop?: () => void): BehaviorGraphEventControl {
    let stopped = false;
    return {
        stopPropagation() {
            stopped = true;
            onStop?.();
        },
        isPropagationStopped() {
            return stopped;
        },
    };
}

export function getOrCreateDomEventPropagationControl(event: Event): BehaviorGraphEventControl {
    const existing = DOM_EVENT_CONTROLS.get(event);
    if (existing) {
        return existing;
    }
    const control = createEventPropagationControl(() => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    });
    DOM_EVENT_CONTROLS.set(event, control);
    return control;
}
