/**
 * What the player is holding down, and which of the project's actions that answers for.
 *
 * `Is Action Held` asks a question the event path cannot answer. An action *fires*, once, and
 * nothing a fired event leaves behind says whether the gesture that raised it is still down. So the
 * state is kept here instead: the keys and the pointer buttons pressed at this moment, the gestures
 * a recogniser has decided are under way, and the rule for reading an action's bindings against
 * them.
 *
 * One tracker on the window rather than a listener per host, because a hold is a fact about the
 * player's hands and not about any one surface - two surfaces asking whether `advance` is held must
 * not be able to disagree.
 *
 * Comments in English per project convention.
 */

import {
    blueprintKeyboardBindingMatchesEvent,
    type BlueprintKeyboardEventLike,
    normalizeBlueprintKeyboardEventKeyName,
} from "@shared/types/blueprint/graph";
import type { UIInputBinding, UIInputPointerGesture } from "@shared/types/ui-editor/inputAction";
import { isTextEntryTarget } from "../app/isTextEntryTarget";

/** The physical inputs down at one moment. */
export type UIHeldInputs = {
    /** Key names, spelled as {@link normalizeBlueprintKeyboardEventKeyName} spells them. */
    keys: ReadonlySet<string>;
    /** `PointerEvent.button` numbers. */
    buttons: ReadonlySet<number>;
    /**
     * Gestures a recogniser has decided are happening right now.
     *
     * For the holds no button can answer for. A long press is not "button 0 is down" - the button is
     * down from the first millisecond, and the press only becomes a long one half a second later -
     * so the moment it starts is something only whatever recognised it knows.
     */
    gestures: ReadonlySet<UIInputPointerGesture>;
};

/** Nobody is holding anything - what a host with no window to listen to reads. */
export const NO_HELD_INPUTS: UIHeldInputs = { keys: new Set(), buttons: new Set(), gestures: new Set() };

/**
 * The button whose press produces a gesture, for the gestures that are a press at all.
 *
 * Most of the list is missing on purpose. A wheel notch is instantaneous - there is no moment
 * during which one is being held - and a double click is a *sequence* rather than a state: the
 * button being down after one press is not a double click in progress, and reporting it as one
 * would make a single held click answer for both gestures at once. A long press is held, but not by
 * a button: it begins when a recogniser says it did rather than when anything was pressed, so it is
 * answered from `gestures` above instead of from here.
 */
const POINTER_GESTURE_HOLD_BUTTONS: Partial<Record<UIInputPointerGesture, number>> = {
    click: 0,
    middleClick: 1,
    rightClick: 2,
};

/** Which mouse button holds this gesture, or null when the gesture is not a press. */
export function pointerGestureHoldButton(gesture: UIInputPointerGesture): number | null {
    return POINTER_GESTURE_HOLD_BUTTONS[gesture] ?? null;
}

/**
 * The gestures a recogniser reports as held, rather than a button being down reporting it.
 *
 * `longPress` is deliberately absent from {@link POINTER_GESTURE_HOLD_BUTTONS} and here instead. A
 * long press is a press *plus half a second*, and reading it off button 0 would make it held from
 * the instant the finger landed - so "hold to hide the dialogue" would hide it on every tap, half a
 * second before the gesture the author asked for has happened.
 *
 * Everything not in this set is refused by {@link UIInputHoldTracker.holdGesture}, so a wheel
 * direction cannot be made sticky by a recogniser that pushed one through by mistake.
 */
const RECOGNIZED_HOLD_GESTURES: ReadonlySet<UIInputPointerGesture> = new Set<UIInputPointerGesture>(["longPress"]);

/** Whether this gesture is one a recogniser can report as being held. */
export function isRecognizedHoldGesture(gesture: UIInputPointerGesture): boolean {
    return RECOGNIZED_HOLD_GESTURES.has(gesture);
}

/**
 * One held key as the binding matcher wants to see it.
 *
 * The modifier flags come from the held set rather than from the event that pressed the key, so a
 * player who holds `S` and then presses Ctrl is holding `Ctrl+S` - which is what their hands are
 * doing. Reusing the flags of the press would answer about the instant it happened instead, and a
 * hold is not an instant.
 */
function heldKeyboardPayload(key: string, keys: ReadonlySet<string>): BlueprintKeyboardEventLike {
    return {
        key,
        ctrlKey: keys.has("control"),
        altKey: keys.has("alt"),
        shiftKey: keys.has("shift"),
        metaKey: keys.has("meta"),
    };
}

/**
 * Whether one binding is being held.
 *
 * Keys are matched by `blueprintKeyboardBindingMatchesEvent`, the same function the `On Key Down`
 * heads and the action dispatch use, so a binding that fires an action and a binding that reads as
 * held are the one binding rather than two spellings that happen to agree.
 */
export function isInputBindingHeld(binding: UIInputBinding, held: UIHeldInputs): boolean {
    if (binding.kind === "pointer") {
        // A gesture a button answers for is answered by the button, which is the cheaper and older
        // question. Only the gestures no button can describe fall through to what a recogniser said.
        const button = pointerGestureHoldButton(binding.gesture);
        if (button !== null) {
            return held.buttons.has(button);
        }
        return held.gestures.has(binding.gesture);
    }
    for (const key of held.keys) {
        if (blueprintKeyboardBindingMatchesEvent(binding.key, heldKeyboardPayload(key, held.keys))) {
            return true;
        }
    }
    return false;
}

export type UIInputHoldTracker = {
    /** The inputs down right now. A snapshot: it does not change under a caller holding it. */
    read(): UIHeldInputs;
    /**
     * Where the press holding this gesture landed, or null when nothing is holding it.
     *
     * The press target rather than the pointer's current position, because that is what
     * `overControls` is a question about: whether the player put the pointer down on a control.
     */
    readPressTarget(gesture: UIInputPointerGesture): EventTarget | null;
    /**
     * A recogniser has decided this gesture is happening, and where it went down.
     *
     * Refused for anything {@link isRecognizedHoldGesture} does not name, so the set can only ever
     * hold gestures that are a state rather than an instant.
     */
    holdGesture(gesture: UIInputPointerGesture, target: EventTarget | null): void;
    /** Every recognised gesture is over - the hand left the glass. */
    releaseGestures(): void;
    dispose(): void;
};

/**
 * A tracker over one window, or over nothing.
 *
 * Every listener is registered in the capture phase. A hold is hardware, and nothing an author's
 * graph does on the way up - a widget that stops propagation, a page that consumes the click -
 * changes whether a key is physically down. Listening in the bubble phase would let a consumed
 * press leave a key held forever.
 */
export function createInputHoldTracker(view: Window | null | undefined): UIInputHoldTracker {
    const keys = new Set<string>();
    const buttons = new Set<number>();
    const pressTargets = new Map<number, EventTarget | null>();
    const gestures = new Set<UIInputPointerGesture>();
    const gestureTargets = new Map<UIInputPointerGesture, EventTarget | null>();

    const forgetEverything = (): void => {
        keys.clear();
        buttons.clear();
        pressTargets.clear();
        gestures.clear();
        gestureTargets.clear();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
        // Typing is not a gesture. The same exemption the app-level key dispatch makes, for the
        // same reason: holding a letter down in a name field must not read as holding an action.
        if (isTextEntryTarget(event.target)) {
            return;
        }
        const key = normalizeBlueprintKeyboardEventKeyName(event.key);
        if (key) {
            keys.add(key);
        }
    };

    const onKeyUp = (event: KeyboardEvent): void => {
        const key = normalizeBlueprintKeyboardEventKeyName(event.key);
        if (!key) {
            return;
        }
        keys.delete(key);
        // While Meta is down macOS delivers no keyup for anything else, so a key released under it
        // would read as held for the rest of the session - and a stuck hold is a game that never
        // stops fast-forwarding. Letting go of Meta is the last moment anything about the others
        // can still be believed.
        if (key === "meta") {
            keys.clear();
        }
    };

    const onPointerDown = (event: PointerEvent): void => {
        buttons.add(event.button);
        pressTargets.set(event.button, event.target);
    };

    const onPointerUp = (event: PointerEvent): void => {
        buttons.delete(event.button);
        pressTargets.delete(event.button);
    };

    // A cancelled pointer names no button (`button` reads -1), so there is nothing to release
    // selectively: the browser has taken the pointer away and none of it is held any more.
    //
    // Recognised gestures are deliberately left alone here. The touch recogniser is built on touch
    // events precisely because a browser raises `pointercancel` while the finger is still on the
    // glass - the moment it claims a drag for native scrolling is one, and so is the moment a
    // platform's own long press fires. Clearing a held long press on that signal would release the
    // gesture exactly when it had just been recognised. `touchend` and `touchcancel` end it instead,
    // and `blur` catches a hand that left with the window.
    const onPointerCancel = (): void => {
        buttons.clear();
        pressTargets.clear();
    };

    // A window that loses focus mid-hold never gets the release - the key goes up inside whatever
    // the player switched to. Everything held is forgotten rather than left to stick.
    const onBlur = (): void => forgetEverything();

    if (view) {
        view.addEventListener("keydown", onKeyDown, true);
        view.addEventListener("keyup", onKeyUp, true);
        view.addEventListener("pointerdown", onPointerDown, true);
        view.addEventListener("pointerup", onPointerUp, true);
        view.addEventListener("pointercancel", onPointerCancel, true);
        view.addEventListener("blur", onBlur);
    }

    return {
        read: () => ({ keys: new Set(keys), buttons: new Set(buttons), gestures: new Set(gestures) }),
        readPressTarget: gesture => {
            // Where the press landed, by whichever route this gesture is held: a mouse button knows
            // its own press target, and a recognised gesture was given one when it was recognised.
            // `overControls` asks the same question of both.
            const button = pointerGestureHoldButton(gesture);
            if (button !== null) {
                return pressTargets.get(button) ?? null;
            }
            return gestureTargets.get(gesture) ?? null;
        },
        holdGesture: (gesture, target) => {
            if (!isRecognizedHoldGesture(gesture)) {
                return;
            }
            gestures.add(gesture);
            gestureTargets.set(gesture, target);
        },
        releaseGestures: () => {
            gestures.clear();
            gestureTargets.clear();
        },
        dispose: () => {
            forgetEverything();
            if (!view) {
                return;
            }
            view.removeEventListener("keydown", onKeyDown, true);
            view.removeEventListener("keyup", onKeyUp, true);
            view.removeEventListener("pointerdown", onPointerDown, true);
            view.removeEventListener("pointerup", onPointerUp, true);
            view.removeEventListener("pointercancel", onPointerCancel, true);
            view.removeEventListener("blur", onBlur);
        },
    };
}

let sharedTracker: UIInputHoldTracker | null = null;

/**
 * The one tracker, attached the first time anything asks for it.
 *
 * Lazily rather than at module load: this module is imported by the host API bridge, which the
 * build and the tests load in environments with no window at all, and a tracker built there would
 * have had to decide what to listen to before anybody asked it anything.
 *
 * Never taken down on its own. It outlives every surface that reads it - which is the point, since
 * a tracker rebuilt between two surfaces would have missed the keydown of a key the player is still
 * holding, and would report it released.
 */
export function getSharedInputHoldTracker(): UIInputHoldTracker {
    if (!sharedTracker) {
        sharedTracker = createInputHoldTracker(typeof window === "undefined" ? null : window);
    }
    return sharedTracker;
}

/** Drop the shared tracker, so the next reader builds one over the window it can see. For tests. */
export function resetSharedInputHoldTracker(): void {
    sharedTracker?.dispose();
    sharedTracker = null;
}
