/**
 * Which device the player is using at this moment.
 *
 * A binding says which devices can reach it (`inputBindingDevices`); this says which one is actually
 * in the player's hands. They answer different questions, and only the second one can tell an
 * interface whether to draw "Click to start" or "Tap to start".
 *
 * One tracker on the window rather than a listener per host, for the same reason
 * {@link ../input/inputHoldState} keeps one: the device is a fact about the player, not about any
 * surface, and two panels asking must not be able to disagree.
 *
 * This module only records and answers. Nothing here decides what an interface does with the answer.
 *
 * Comments in English per project convention.
 */

import type { UIInputActionSource } from "@shared/types/ui-editor/inputActionEvent";

/**
 * The media query that decides the answer before anybody has touched anything.
 *
 * `(pointer: coarse)` is the browser's own standard answer to "is the primary pointing device
 * imprecise": phones and tablets match it, and a laptop with a touch screen bolted on does not,
 * because its primary device is still the trackpad. That is exactly the split wanted here.
 *
 * It matters because of one screen in particular. The title page is the moment the player has not
 * yet touched anything - so there is no input to read the device off - and also the moment the
 * prompt most needs to be right, because it is the only instruction on it.
 */
export const UI_COARSE_POINTER_QUERY = "(pointer: coarse)";

/** The part of a `Window` this needs; a browser's carries far more. */
export type UIInputDeviceHost = {
    addEventListener(
        type: string,
        listener: (event: Event) => void,
        options?: boolean | AddEventListenerOptions,
    ): void;
    removeEventListener(
        type: string,
        listener: (event: Event) => void,
        options?: boolean | EventListenerOptions,
    ): void;
    matchMedia?: (query: string) => { matches: boolean };
};

export type UIInputDeviceTracker = {
    /** The device the player is using right now. */
    read(): UIInputActionSource;
    /** Record a device something else observed. */
    note(device: UIInputActionSource): void;
    dispose(): void;
};

/**
 * What the tracker answers before the player has produced any input at all.
 *
 * A host with no `matchMedia` - a test, a Node environment, a very old shell - reads `pointer`,
 * which is the answer that was correct everywhere before touch existed and is still correct on
 * every desktop.
 */
export function readDefaultInputDevice(host: UIInputDeviceHost | null | undefined): UIInputActionSource {
    if (!host || typeof host.matchMedia !== "function") {
        return "pointer";
    }
    try {
        return host.matchMedia(UI_COARSE_POINTER_QUERY).matches ? "touch" : "pointer";
    } catch {
        // Some embedded webviews throw on an unrecognised query rather than answering false.
        return "pointer";
    }
}

/**
 * Which device an ordinary pointer event came from.
 *
 * A pen is `pointer` rather than a device of its own, and that is a ruling rather than an omission:
 * it is a precise instrument aimed at a single point, so everything an interface would say
 * differently for a mouse it would say the same way for a pen. What separates `touch` from both is
 * that a fingertip covers a target rather than aiming at it.
 */
export function readPointerTypeDevice(pointerType: string | undefined): UIInputActionSource {
    return pointerType === "touch" ? "touch" : "pointer";
}

/**
 * A tracker over one window, or over nothing.
 *
 * Both listeners are registered in the capture phase, for the reason the hold tracker's are: which
 * hardware the player reached for is decided before any graph runs, and a widget that stops
 * propagation does not change it.
 */
export function createInputDeviceTracker(host: UIInputDeviceHost | null | undefined): UIInputDeviceTracker {
    let device = readDefaultInputDevice(host);

    const onPointerDown = (event: Event): void => {
        device = readPointerTypeDevice((event as PointerEvent).pointerType);
    };

    const onKeyDown = (): void => {
        device = "key";
    };

    if (host) {
        host.addEventListener("pointerdown", onPointerDown, true);
        host.addEventListener("keydown", onKeyDown, true);
    }

    return {
        read: () => device,
        note: next => {
            device = next;
        },
        dispose: () => {
            if (!host) {
                return;
            }
            host.removeEventListener("pointerdown", onPointerDown, true);
            host.removeEventListener("keydown", onKeyDown, true);
        },
    };
}

let sharedTracker: UIInputDeviceTracker | null = null;

/**
 * The one tracker, attached the first time anything asks for it.
 *
 * Lazily rather than at module load, and never taken down on its own, for the same two reasons the
 * hold tracker is: this module is loaded in environments with no window, and a tracker rebuilt
 * between two surfaces would have forgotten what the player was using a moment ago.
 */
function getSharedInputDeviceTracker(): UIInputDeviceTracker {
    if (!sharedTracker) {
        sharedTracker = createInputDeviceTracker(typeof window === "undefined" ? null : window);
    }
    return sharedTracker;
}

/**
 * The device the player is using right now.
 *
 * **The return type is the full four-value union even though `gamepad` is never returned today.**
 * This is the value domain of a blueprint pin, and a pin's enumeration can be narrowed after the
 * fact - every saved graph still switches on values that remain in the set - but it cannot be
 * widened, because a graph written against three values has no branch for a fourth. So the union is
 * declared at its eventual width and the producer catches up later.
 */
export function readCurrentInputDevice(): UIInputActionSource {
    return getSharedInputDeviceTracker().read();
}

/**
 * Record that the player just used this device.
 *
 * For input paths whose device the two listeners above cannot see. Everything a `pointerdown` or a
 * `keydown` reaches is already covered.
 */
export function noteInputDevice(device: UIInputActionSource): void {
    getSharedInputDeviceTracker().note(device);
}

/** Drop the shared tracker, so the next reader builds one over the window it can see. For tests. */
export function resetSharedInputDeviceTracker(): void {
    sharedTracker?.dispose();
    sharedTracker = null;
}
