/**
 * The controls a gamepad press reaches: every mounted widget with a gamepad head on a drawing that
 * holds the keys.
 *
 * A control does not watch the pads itself. The game's dispatcher (`gamepadInput.ts`) hands it each
 * press after the global blueprint and the keyboard owner have had theirs, with the one event control
 * the whole press carries. That is the order a key takes - the global, then the page or layer that
 * owns the keys, then the controls listening on `window` - and it is what lets a global head that
 * stops a press keep it from every control as well, which a control reading the pads on its own
 * could never see.
 *
 * Who hears a press is decided before any of its graphs run, the way a DOM event clones its listener
 * list when it is dispatched: a control that starts listening while the graphs before it run (on a
 * layer the global's head just opened) is not handed that press, and one that stopped listening
 * meanwhile (on a page the owner's graph just left) is skipped.
 *
 * Nothing calls these outside a running game. The editor canvas installs no dispatcher, so its
 * widgets' gamepad heads stay quiet there even though they subscribe.
 *
 * Comments in English per project convention.
 */

import type { BehaviorGraphEventControl } from "@/lib/ui-editor/behavior-graph/BehaviorNodeRegistry";
import type { UIGamepadButtonEdge } from "./gamepadState";

export type GamepadControlListener = (edge: UIGamepadButtonEdge, eventControl: BehaviorGraphEventControl) => void;

const listeners = new Set<GamepadControlListener>();

/** Listen as a control until the returned function is called. */
export function listenAsGamepadControl(listener: GamepadControlListener): () => void {
    // A fresh wrapper per subscription, so one function subscribed twice is two listeners, each
    // with its own place in a press's snapshot - as `addEventListener` would not allow, but as two
    // mounted drawings of one element need.
    const entry: GamepadControlListener = (edge, eventControl) => listener(edge, eventControl);
    listeners.add(entry);
    return () => {
        listeners.delete(entry);
    };
}

/**
 * The controls listening now, as a function that hands a press to them later.
 *
 * None is handed a press whose propagation has stopped, and one that stopped listening in between is
 * skipped. They start together, in the order they began listening, and are not waited for: a
 * control's graph that waits on something - a confirmation, a fade - holds up neither the controls
 * beside it nor the next press, and a control that stops the press does not take it back from the
 * ones started with it, as heads that heard one event in one place never do.
 */
export function captureGamepadControls(): (edge: UIGamepadButtonEdge, eventControl: BehaviorGraphEventControl) => void {
    const captured = Array.from(listeners);
    return (edge, eventControl) => {
        if (eventControl.isPropagationStopped()) {
            return;
        }
        for (const listener of captured) {
            if (listeners.has(listener)) {
                listener(edge, eventControl);
            }
        }
    };
}

/** For tests: forget every control. */
export function resetGamepadControls(): void {
    listeners.clear();
}
