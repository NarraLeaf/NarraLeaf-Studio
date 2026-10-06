// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
    BLUEPRINT_GAMEPAD_BUTTONS,
    formatBlueprintGamepadButton,
    normalizeBlueprintGamepadButtonIndex,
} from "@shared/types/blueprint/gamepad";
import {
    GAMEPAD_AXIS_DEADZONE,
    createGamepadTracker,
    getSharedGamepadTracker,
    resetSharedGamepadTracker,
    type UIGamepadHost,
} from "./gamepadState";

afterEach(() => {
    resetSharedGamepadTracker();
});

function pad(input: {
    buttons?: Array<{ pressed: boolean }>;
    axes?: number[];
    mapping?: GamepadMappingType;
    index?: number;
}): Gamepad {
    const buttons = (input.buttons ?? []).map(button => ({
        pressed: button.pressed,
        touched: button.pressed,
        value: button.pressed ? 1 : 0,
    }));
    return {
        index: input.index ?? 0,
        id: "test-pad",
        mapping: input.mapping ?? "standard",
        connected: true,
        timestamp: 0,
        axes: input.axes ?? [0, 0, 0, 0],
        buttons: buttons as Gamepad["buttons"],
        vibrationActuator: null as unknown as Gamepad["vibrationActuator"],
    };
}

type FakeGamepadHost = UIGamepadHost & {
    pads: Array<Gamepad | null>;
    frames: FrameRequestCallback[];
    setHidden: (value: boolean) => void;
    /** Deliver a window or document event to whatever the tracker is listening with. */
    fire: (type: string) => void;
};

function hostWith(pads: Array<Gamepad | null>, opts?: { hidden?: boolean }): FakeGamepadHost {
    const frames: FrameRequestCallback[] = [];
    let hidden = opts?.hidden ?? false;
    const listeners = new Map<string, Set<EventListener>>();
    const host: FakeGamepadHost = {
        pads,
        frames,
        setHidden: value => {
            hidden = value;
        },
        fire: type => {
            for (const listener of listeners.get(type) ?? []) {
                listener(new Event(type));
            }
        },
        getGamepads: () => host.pads,
        addEventListener: (type, listener) => {
            const set = listeners.get(type) ?? new Set();
            set.add(listener);
            listeners.set(type, set);
        },
        removeEventListener: (type, listener) => {
            listeners.get(type)?.delete(listener);
        },
        requestAnimationFrame: callback => {
            frames.push(callback);
            return frames.length;
        },
        cancelAnimationFrame: () => {
            frames.length = 0;
        },
        get visibilityState() {
            return hidden ? "hidden" : "visible";
        },
    };
    return host;
}

describe("formatBlueprintGamepadButton", () => {
    it("canonicalises aliases without regard to case", () => {
        expect(formatBlueprintGamepadButton("cross")).toBe("A");
        expect(formatBlueprintGamepadButton("CIRCLE")).toBe("B");
        expect(formatBlueprintGamepadButton("square")).toBe("X");
        expect(formatBlueprintGamepadButton("triangle")).toBe("Y");
        expect(formatBlueprintGamepadButton("l1")).toBe("LB");
        expect(formatBlueprintGamepadButton("select")).toBe("Back");
        expect(formatBlueprintGamepadButton("options")).toBe("Start");
        expect(formatBlueprintGamepadButton("south")).toBe("A");
        expect(formatBlueprintGamepadButton("a")).toBe("A");
        expect(formatBlueprintGamepadButton("not-a-button")).toBe("");
    });

    it("maps standard indices 0–16", () => {
        expect(normalizeBlueprintGamepadButtonIndex(0)).toBe("A");
        expect(normalizeBlueprintGamepadButtonIndex(16)).toBe("Home");
        expect(normalizeBlueprintGamepadButtonIndex(17)).toBe("");
    });
});

describe("createGamepadTracker", () => {
    it("emits a down then an up in standard-mapping index order", () => {
        const host = hostWith([pad({ buttons: [{ pressed: false }] })]);
        const tracker = createGamepadTracker(host);
        const edges: string[] = [];
        tracker.onEdge(edge => edges.push(`${edge.type}:${edge.button}`));
        tracker.start();
        host.pads = [pad({ buttons: [{ pressed: true }] })];
        host.frames.at(-1)?.(0);
        host.pads = [pad({ buttons: [{ pressed: false }] })];
        host.frames.at(-1)?.(0);
        expect(edges).toEqual(["down:A", "up:A"]);
        tracker.dispose();
    });

    it("unions two standard pads and ignores a non-standard one", () => {
        const host = hostWith([]);
        const tracker = createGamepadTracker(host);
        const edges: string[] = [];
        tracker.onEdge(edge => edges.push(`${edge.type}:${edge.button}`));
        tracker.start();
        const a = pad({
            index: 0,
            buttons: BLUEPRINT_GAMEPAD_BUTTONS.map((_, i) => ({ pressed: i === 0 })),
        });
        const b = pad({
            index: 1,
            buttons: BLUEPRINT_GAMEPAD_BUTTONS.map((_, i) => ({ pressed: i === 1 })),
        });
        const weird = pad({ index: 2, mapping: "", buttons: [{ pressed: true }] });
        host.pads = [a, b, weird];
        host.frames.at(-1)?.(0);
        expect(tracker.read().buttons).toEqual(new Set(["A", "B"]));
        expect(edges).toEqual(["down:A", "down:B"]);
        host.pads = [a, pad({ index: 1, buttons: BLUEPRINT_GAMEPAD_BUTTONS.map(() => ({ pressed: false })) }), weird];
        host.frames.at(-1)?.(0);
        expect(tracker.read().buttons).toEqual(new Set(["A"]));
        expect(edges.at(-1)).toBe("up:B");
        tracker.dispose();
    });

    it("deadzones axes of the first standard pad", () => {
        const host = hostWith([
            pad({ axes: [0.05, -0.5, 0.9, 0] }),
        ]);
        const tracker = createGamepadTracker(host);
        tracker.start();
        const axes = tracker.read().axes;
        expect(axes.LeftX).toBe(0);
        expect(axes.LeftY).toBe(-0.5);
        expect(axes.RightX).toBe(0.9);
        expect(GAMEPAD_AXIS_DEADZONE).toBe(0.18);
        tracker.dispose();
    });

    it("clears held buttons on blur without emitting ups", () => {
        const host = hostWith([pad({ buttons: [{ pressed: true }] })]);
        const tracker = createGamepadTracker(host);
        const edges: string[] = [];
        tracker.onEdge(edge => edges.push(`${edge.type}:${edge.button}`));
        tracker.start();
        host.frames.at(-1)?.(0);
        expect(tracker.read().buttons.has("A")).toBe(true);
        host.fire("blur");
        expect(tracker.read().buttons.size).toBe(0);
        expect(edges).toEqual([]);
        tracker.dispose();
    });

    it("clears held buttons when the window is hidden, and not while it is shown", () => {
        const host = hostWith([pad({ buttons: [{ pressed: true }] })]);
        const tracker = createGamepadTracker(host);
        tracker.start();
        host.fire("visibilitychange");
        expect(tracker.read().buttons.has("A")).toBe(true);
        host.setHidden(true);
        host.fire("visibilitychange");
        expect(tracker.read().buttons.size).toBe(0);
        tracker.dispose();
    });

    it("clears held buttons on stop without emitting ups", () => {
        const host = hostWith([pad({ buttons: [{ pressed: true }] })]);
        const tracker = createGamepadTracker(host);
        const edges: string[] = [];
        tracker.onEdge(edge => edges.push(`${edge.type}:${edge.button}`));
        tracker.start();
        tracker.stop();
        expect(tracker.read().buttons.size).toBe(0);
        expect(edges).toEqual([]);
        tracker.dispose();
    });
});

describe("the shared tracker over the real window", () => {
    it("asks the document whether it is hidden when that changes, not when the tracker was built", () => {
        // The tracker is built once, early. A visibility read at construction answered "visible"
        // for the rest of the session, so hiding the window never cleared what was held.
        let visibility: DocumentVisibilityState = "visible";
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
        Object.defineProperty(navigator, "getGamepads", {
            configurable: true,
            value: () => [pad({ buttons: [{ pressed: true }] })],
        });
        try {
            const tracker = getSharedGamepadTracker();
            tracker.start();
            expect(tracker.read().buttons.has("A")).toBe(true);
            visibility = "hidden";
            document.dispatchEvent(new Event("visibilitychange"));
            expect(tracker.read().buttons.size).toBe(0);
        } finally {
            delete (document as { visibilityState?: unknown }).visibilityState;
            delete (navigator as { getGamepads?: unknown }).getGamepads;
        }
    });
});
