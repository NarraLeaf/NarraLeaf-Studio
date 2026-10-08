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
 * Pads are not read while the window is hidden or does not have focus. The Gamepad API keeps
 * reporting to a page that is visible but unfocused, so without this a game left open beside
 * another one would play along with the pad meant for that one - the keyboard does not reach an
 * unfocused window, and neither does this.
 *
 * Leaving (blur, hidden) forgets the held set and the sticks without emitting releases. A pad that
 * went up inside another window would otherwise stick `Is Gamepad Button Held` for the rest of the
 * session, and synthesising an up would fire graphs for a button the player did not release here.
 * Coming back takes whatever is down as already down, with no press, the way a key held while its
 * window gains focus sends no keydown; its release still arrives as an up.
 *
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_GAMEPAD_AXES,
    BLUEPRINT_GAMEPAD_BUTTONS,
    BLUEPRINT_GAMEPAD_PHYSICAL_BUTTON_COUNT,
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
    /** Whether the player is in this window. A host without it is treated as always focused. */
    hasFocus?: () => boolean;
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

/** How far the left stick goes before it reads as pressed one way, and how far back before it lets go. */
export const GAMEPAD_STICK_PRESS = 0.5;
export const GAMEPAD_STICK_RELEASE = 0.35;

const LEFT_STICK_BUTTONS = [
    { button: "Left Stick Up", axis: 1, sign: -1 },
    { button: "Left Stick Down", axis: 1, sign: 1 },
    { button: "Left Stick Left", axis: 0, sign: -1 },
    { button: "Left Stick Right", axis: 0, sign: 1 },
] as const;

/**
 * The left stick as four buttons. A direction goes down past {@link GAMEPAD_STICK_PRESS} and comes
 * back up only under {@link GAMEPAD_STICK_RELEASE}, so a thumb resting near the threshold does not
 * press it over and over. Only the stronger axis counts: a diagonal is whichever way it leans more,
 * which is what a menu with no diagonals can use.
 */
function readLeftStickButtons(pad: Gamepad, previous: ReadonlySet<string>, into: Set<string>): void {
    const x = pad.axes[0] ?? 0;
    const y = pad.axes[1] ?? 0;
    for (const entry of LEFT_STICK_BUTTONS) {
        const along = (entry.axis === 0 ? x : y) * entry.sign;
        const across = Math.abs(entry.axis === 0 ? y : x);
        const threshold = previous.has(entry.button) ? GAMEPAD_STICK_RELEASE : GAMEPAD_STICK_PRESS;
        if (along >= threshold && along >= across) {
            into.add(entry.button);
        }
    }
}

function readUnion(
    pads: Array<Gamepad | null>,
    previous: ReadonlySet<string> = new Set(),
): { buttons: Set<string>; axes: Record<BlueprintGamepadAxis, number>; connected: boolean } {
    const buttons = new Set<string>();
    let first: Gamepad | null = null;
    for (const pad of pads) {
        if (!isStandardPad(pad)) {
            continue;
        }
        if (!first) {
            first = pad;
        }
        readLeftStickButtons(pad, previous, buttons);
        const count = Math.min(pad.buttons.length, BLUEPRINT_GAMEPAD_PHYSICAL_BUTTON_COUNT);
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

/** Hidden, or shown but not the window the player is in. Pads are not read for either. */
function hostIsAway(host: UIGamepadHost): boolean {
    return hostIsHidden(host) || host.hasFocus?.() === false;
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

    // Set whenever the held set has been forgotten - at start, on leaving. The next read takes what
    // is down as already down instead of reporting it as pressed.
    let resync = true;

    const forget = (live: ReturnType<typeof readUnion> | null): void => {
        // `connected` is a fact about the pads, not about the window, so it stays current and Is
        // Gamepad Connected does not flip false on blur. The sticks are not: a stick pushed at the
        // moment of blur would otherwise read as pushed for as long as the player is away.
        applyUnion({ buttons: new Set(), axes: { ...NO_GAMEPAD_AXES }, connected: live?.connected ?? connected }, false);
        resync = true;
    };

    const readPads = (): void => {
        if (!host) {
            return;
        }
        const live = readUnion(host.getGamepads(), buttons);
        if (hostIsAway(host)) {
            forget(live);
            return;
        }
        applyUnion(live, !resync);
        resync = false;
    };

    const poll = (): void => {
        if (!running || !host) {
            return;
        }
        readPads();
        frame = host.requestAnimationFrame(poll);
    };

    const clearSilent = (): void => forget(host ? readUnion(host.getGamepads()) : null);

    const onConnect = (): void => {
        if (running) {
            readPads();
        }
    };

    const onBlur = (): void => clearSilent();
    const onVisibility = (): void => {
        if (host && hostIsHidden(host)) {
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
            resync = true;
            readPads();
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
            resync = true;
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
        hasFocus: () => typeof document === "undefined" || document.hasFocus(),
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
