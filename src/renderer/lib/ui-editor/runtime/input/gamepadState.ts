/**
 * Connected standard-mapping gamepads, as held buttons and analogue axes.
 *
 * The Gamepad API has no keydown. Pads are read each animation frame, edges are the buttons that
 * joined or left the union since the last frame, and a window that is hidden stops requesting
 * frames - which is the same pause the game picture and auto-forward already take. Non-standard
 * pads (`mapping !== "standard"`) are ignored rather than remapped: v1 has no remap table, and an
 * index on those pads does not mean the Xbox name the rest of the input model uses.
 *
 * Several standard pads are one set of buttons. A press is the button appearing in the union, a
 * release is it leaving; two pads holding A is still one A. Analogue sticks are not buttons. They
 * are read through query nodes, from the first connected standard pad in `getGamepads()` order.
 *
 * Blur and `visibilitychange` to hidden forget the held set without emitting releases. A pad that
 * went up inside another window would otherwise stick `Is Gamepad Button Held` for the rest of the
 * session, and synthesising an up would fire graphs for a button the player did not release here.
 *
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_GAMEPAD_AXES,
    BLUEPRINT_GAMEPAD_BUTTONS,
    normalizeBlueprintGamepadButtonIndex,
    type BlueprintGamepadAxis,
} from "@shared/types/blueprint/gamepad";

/**
 * Inside this radius an axis reads 0. 0.18 is a typical thumb-stick rest noise floor; values are
 * not rescaled outside it, so a push still reports the Gamepad API's own number.
 */
export const GAMEPAD_AXIS_DEADZONE = 0.18;

export type UIGamepadButtonEdge = {
    type: "down" | "up";
    button: string;
};

export type UIGamepadSnapshot = {
    /** Canonical names currently down, unioned across every connected standard pad. */
    buttons: ReadonlySet<string>;
    /** Deadzoned axes of the first connected standard pad, or zeroes when none. */
    axes: Readonly<Record<BlueprintGamepadAxis, number>>;
    /** At least one `mapping === "standard"` pad is connected. */
    connected: boolean;
};

export const NO_GAMEPAD_AXES: Readonly<Record<BlueprintGamepadAxis, number>> = {
    LeftX: 0,
    LeftY: 0,
    RightX: 0,
    RightY: 0,
};

export const NO_GAMEPAD_SNAPSHOT: UIGamepadSnapshot = {
    buttons: new Set(),
    axes: NO_GAMEPAD_AXES,
    connected: false,
};

/** The slice of `Window` / `Navigator` this tracker needs; a test injects the rest. */
export type UIGamepadHost = {
    getGamepads: () => Array<Gamepad | null>;
    addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions | boolean): void;
    removeEventListener(type: string, listener: EventListener, options?: EventListenerOptions | boolean): void;
    requestAnimationFrame: (callback: FrameRequestCallback) => number;
    cancelAnimationFrame: (handle: number) => void;
    visibilityState?: Document["visibilityState"];
};

export type UIGamepadTracker = {
    read(): UIGamepadSnapshot;
    /** Subscribe to press/release edges. Silent clears (blur / hidden) do not fire. */
    onEdge(listener: (edge: UIGamepadButtonEdge) => void): () => void;
    /** Subscribe to the held-button set, including silent clears. */
    onHeldButtons(listener: (buttons: ReadonlySet<string>) => void): () => void;
    start(): void;
    stop(): void;
    dispose(): void;
};

function applyDeadzone(value: number): number {
    return Math.abs(value) < GAMEPAD_AXIS_DEADZONE ? 0 : value;
}

function isStandardPad(pad: Gamepad | null | undefined): pad is Gamepad {
    return Boolean(pad && pad.mapping === "standard");
}

function readUnion(pads: Array<Gamepad | null>): { buttons: Set<string>; axes: Record<BlueprintGamepadAxis, number>; connected: boolean } {
    const buttons = new Set<string>();
    let first: Gamepad | null = null;
    for (const pad of pads) {
        if (!isStandardPad(pad)) {
            continue;
        }
        if (!first) {
            first = pad;
        }
        const count = Math.min(pad.buttons.length, BLUEPRINT_GAMEPAD_BUTTONS.length);
        for (let index = 0; index < count; index += 1) {
            if (pad.buttons[index]?.pressed) {
                const name = normalizeBlueprintGamepadButtonIndex(index);
                if (name) {
                    buttons.add(name);
                }
            }
        }
    }
    const axes: Record<BlueprintGamepadAxis, number> = { ...NO_GAMEPAD_AXES };
    if (first) {
        for (let i = 0; i < BLUEPRINT_GAMEPAD_AXES.length; i += 1) {
            axes[BLUEPRINT_GAMEPAD_AXES[i]] = applyDeadzone(first.axes[i] ?? 0);
        }
    }
    return { buttons, axes, connected: first !== null };
}

function edgesBetween(previous: ReadonlySet<string>, next: ReadonlySet<string>): UIGamepadButtonEdge[] {
    const edges: UIGamepadButtonEdge[] = [];
    for (const name of BLUEPRINT_GAMEPAD_BUTTONS) {
        const was = previous.has(name);
        const now = next.has(name);
        if (!was && now) {
            edges.push({ type: "down", button: name });
        } else if (was && !now) {
            edges.push({ type: "up", button: name });
        }
    }
    return edges;
}

function hostIsHidden(host: UIGamepadHost): boolean {
    return host.visibilityState === "hidden";
}

export function createGamepadTracker(host: UIGamepadHost | null | undefined): UIGamepadTracker {
    let buttons = new Set<string>();
    let axes: Record<BlueprintGamepadAxis, number> = { ...NO_GAMEPAD_AXES };
    let connected = false;
    let running = false;
    let frame = 0;
    const edgeListeners = new Set<(edge: UIGamepadButtonEdge) => void>();
    const heldListeners = new Set<(buttons: ReadonlySet<string>) => void>();

    const snapshot = (): UIGamepadSnapshot => ({
        buttons: new Set(buttons),
        axes: { ...axes },
        connected,
    });

    const publishHeld = (): void => {
        const held = new Set(buttons);
        for (const listener of heldListeners) {
            listener(held);
        }
    };

    const applyUnion = (next: ReturnType<typeof readUnion>, emitEdges: boolean): void => {
        const previous = buttons;
        buttons = next.buttons;
        axes = next.axes;
        connected = next.connected;
        const changed = previous.size !== buttons.size || [...previous].some(name => !buttons.has(name));
        if (emitEdges) {
            for (const edge of edgesBetween(previous, buttons)) {
                for (const listener of edgeListeners) {
                    listener(edge);
                }
            }
        }
        if (changed) {
            publishHeld();
        }
    };

    const poll = (): void => {
        if (!running || !host) {
            return;
        }
        if (hostIsHidden(host)) {
            frame = host.requestAnimationFrame(poll);
            return;
        }
        applyUnion(readUnion(host.getGamepads()), true);
        frame = host.requestAnimationFrame(poll);
    };

    const clearSilent = (): void => {
        applyUnion({ buttons: new Set(), axes: { ...NO_GAMEPAD_AXES }, connected }, false);
        // `connected` is a fact about the pads, not about the window: re-read so Is Gamepad
        // Connected does not flip false just because the window blurred.
        if (host) {
            const live = readUnion(host.getGamepads());
            connected = live.connected;
            axes = live.axes;
        }
    };

    const onConnect = (): void => {
        if (!running || !host) {
            return;
        }
        applyUnion(readUnion(host.getGamepads()), true);
    };

    const onBlur = (): void => clearSilent();
    const onVisibility = (): void => {
        if (hostIsHidden(host!)) {
            clearSilent();
        }
    };

    return {
        read: snapshot,
        onEdge: listener => {
            edgeListeners.add(listener);
            return () => {
                edgeListeners.delete(listener);
            };
        },
        onHeldButtons: listener => {
            heldListeners.add(listener);
            return () => {
                heldListeners.delete(listener);
            };
        },
        start: () => {
            if (running || !host) {
                return;
            }
            running = true;
            host.addEventListener("gamepadconnected", onConnect);
            host.addEventListener("gamepaddisconnected", onConnect);
            host.addEventListener("blur", onBlur);
            host.addEventListener("visibilitychange", onVisibility);
            applyUnion(readUnion(host.getGamepads()), false);
            frame = host.requestAnimationFrame(poll);
        },
        stop: () => {
            if (!running) {
                return;
            }
            running = false;
            if (host) {
                host.cancelAnimationFrame(frame);
                host.removeEventListener("gamepadconnected", onConnect);
                host.removeEventListener("gamepaddisconnected", onConnect);
                host.removeEventListener("blur", onBlur);
                host.removeEventListener("visibilitychange", onVisibility);
            }
            frame = 0;
            clearSilent();
        },
        dispose: () => {
            if (running) {
                running = false;
                if (host) {
                    host.cancelAnimationFrame(frame);
                    host.removeEventListener("gamepadconnected", onConnect);
                    host.removeEventListener("gamepaddisconnected", onConnect);
                    host.removeEventListener("blur", onBlur);
                    host.removeEventListener("visibilitychange", onVisibility);
                }
                frame = 0;
            }
            edgeListeners.clear();
            heldListeners.clear();
            buttons = new Set();
            axes = { ...NO_GAMEPAD_AXES };
            connected = false;
        },
    };
}

function windowHost(): UIGamepadHost | null {
    if (typeof window === "undefined" || typeof navigator === "undefined") {
        return null;
    }
    return {
        getGamepads: () => {
            try {
                return Array.from(navigator.getGamepads?.() ?? []);
            } catch {
                return [];
            }
        },
        addEventListener: (type, listener, options) => {
            const target = type === "visibilitychange" && typeof document !== "undefined" ? document : window;
            target.addEventListener(type, listener, options);
        },
        removeEventListener: (type, listener, options) => {
            const target = type === "visibilitychange" && typeof document !== "undefined" ? document : window;
            target.removeEventListener(type, listener, options);
        },
        requestAnimationFrame: callback => window.requestAnimationFrame(callback),
        cancelAnimationFrame: handle => window.cancelAnimationFrame(handle),
        // A getter, not a value: the tracker is built once and asks again on every frame and every
        // `visibilitychange`, and a copy taken at construction would answer the same thing forever.
        get visibilityState() {
            return typeof document === "undefined" ? undefined : document.visibilityState;
        },
    };
}

let sharedTracker: UIGamepadTracker | null = null;
let injectedHost: UIGamepadHost | null | undefined;

/**
 * The one tracker. Built the first time anything asks, over the window it can see - or over a host
 * a test injected, so the poller can run with no Gamepad API.
 */
export function getSharedGamepadTracker(): UIGamepadTracker {
    if (!sharedTracker) {
        sharedTracker = createGamepadTracker(injectedHost === undefined ? windowHost() : injectedHost);
    }
    return sharedTracker;
}

/** Tests: the next {@link getSharedGamepadTracker} builds over this host. */
export function setGamepadTrackerHost(host: UIGamepadHost | null): void {
    resetSharedGamepadTracker();
    injectedHost = host;
}

export function resetSharedGamepadTracker(): void {
    sharedTracker?.dispose();
    sharedTracker = null;
    injectedHost = undefined;
}

export function readGamepadSnapshot(): UIGamepadSnapshot {
    return getSharedGamepadTracker().read();
}

export function isGamepadConnected(): boolean {
    return getSharedGamepadTracker().read().connected;
}

export function isGamepadButtonHeld(button: string): boolean {
    return getSharedGamepadTracker().read().buttons.has(button);
}

export function getGamepadAxis(axis: string): number {
    const snapshot = getSharedGamepadTracker().read();
    if (axis in snapshot.axes) {
        return snapshot.axes[axis as BlueprintGamepadAxis];
    }
    return 0;
}
