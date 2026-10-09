/**
 * What the buttons do right now, for the input hint bar (`nl.inputHints`).
 *
 * Read from the same places a press goes through, so the bar cannot say something the buttons do
 * not do: the vocabulary (with the navigation actions and whatever the project rebound them to), the
 * surfaces that hold the keys and the actions they answer, and where navigation can move the focus.
 * The rules mirror the dispatch (`keyboardOwner`, `navigationDefaults`):
 *
 *  - Moving and Confirm, while there is something to move between.
 *  - Every action the page or the stage on screen answers, by the name the project gave it.
 *  - On the stage with nothing to move between: Advance, which a Confirm nothing answers does, and
 *    Stage controls when there are controls to step into.
 *  - Back, while there is somewhere to go back to - a page that is not the one the game starts on,
 *    or the stage's controls the player stepped into.
 *
 * A button is listed once. A hint whose buttons were all claimed by an earlier one is left out:
 * the project's own Dismiss on B already says what B does, so Studio's Back on B does not say it
 * again in other words.
 *
 * The answer is published through a small store the running game feeds (`provideInputHints`) and
 * the widget reads (`useInputHints`). It is re-read a few times a second while a bar is on screen:
 * what it depends on - which page holds the keys, where the focus is, what device the player last
 * touched, which pad is connected - changes from a dozen places, and reading it again is cheaper
 * than wiring every one of them to a notice.
 *
 * Comments in English per project convention.
 */

import { useSyncExternalStore } from "react";
import type { UIInputActionDef, UIInputBinding } from "@shared/types/ui-editor/inputAction";
import type { UIInputActionSource } from "@shared/types/ui-editor/inputActionEvent";
import type { UIInputHintControllerFamily, UIInputHintWord } from "@shared/types/ui-editor/inputHints";
import {
    isUINavigationActionId,
    uiNavigationActionId,
    type UINavigationIntent,
} from "@shared/types/ui-editor/navigation";

export type InputHint = {
    id: string;
    /** A move Studio names, or an action the project named. */
    label: { kind: "word"; word: UIInputHintWord } | { kind: "action"; name: string };
    /** The bindings it is pressed with, on the device the hints are for. */
    bindings: UIInputBinding[];
    /** Drawn as one glyph for all four directions rather than one per binding. */
    directions?: boolean;
};

export type InputHintsSnapshot = {
    /** The device the player last used. */
    device: UIInputActionSource;
    /** The glyph family of the connected pad. */
    controller: UIInputHintControllerFamily;
    hints: InputHint[];
};

export type InputHintContext = {
    /** Which bindings to list: a pad's, or the keyboard's. */
    device: "gamepad" | "key";
    vocabulary: Readonly<Record<string, UIInputActionDef>>;
    /** What holds the keys: a page or layer, the stage, or nothing. */
    lane: "page" | "stage" | null;
    /** The actions the surfaces that hold the keys answer, in their order. */
    answered: readonly string[];
    navigation: {
        scope: "owner" | "choice" | "controls" | null;
        targets: number;
        stageControlsAvailable: boolean;
    };
    /** Whether the page that holds the keys has somewhere to go back to. */
    canGoBack: boolean;
    /** Whether a Confirm nothing answers reads the story on (`storyAdvance`). */
    storyAdvances: boolean;
};

function bindingIdentity(binding: UIInputBinding): string {
    return binding.kind === "key" ? `key:${binding.key}` : binding.kind === "gamepad" ? `pad:${binding.button}` : `ptr:${binding.gesture}`;
}

/** The hints, in the order the bar draws them. See the module comment for the rules. */
export function resolveInputHints(context: InputHintContext): InputHint[] {
    const { device, vocabulary, navigation } = context;
    const onDevice = (bindings: readonly UIInputBinding[] | undefined) =>
        (bindings ?? []).filter(binding => binding.kind === (device === "gamepad" ? "gamepad" : "key"));
    const navigationBindings = (intent: UINavigationIntent) =>
        onDevice(vocabulary[uiNavigationActionId(intent)]?.bindings);

    const used = new Set<string>();
    const hints: InputHint[] = [];
    const add = (hint: InputHint) => {
        const free = hint.bindings.filter(binding => !used.has(bindingIdentity(binding)));
        if (free.length === 0) {
            return;
        }
        for (const binding of free) {
            used.add(bindingIdentity(binding));
        }
        hints.push({ ...hint, bindings: hint.directions ? free.slice(0, 1) : free });
    };

    if (navigation.scope && navigation.targets > 1) {
        add({
            id: "select",
            label: { kind: "word", word: "select" },
            bindings: (["up", "down", "left", "right"] as const).flatMap(navigationBindings),
            directions: true,
        });
    }
    if (navigation.scope && navigation.targets > 0) {
        add({ id: "confirm", label: { kind: "word", word: "confirm" }, bindings: navigationBindings("confirm") });
    }
    for (const actionId of context.answered) {
        const action = vocabulary[actionId];
        if (!action || isUINavigationActionId(actionId)) {
            continue;
        }
        add({ id: actionId, label: { kind: "action", name: action.name }, bindings: onDevice(action.bindings) });
    }
    if (context.lane === "stage" && !navigation.scope) {
        if (context.storyAdvances) {
            add({ id: "advance", label: { kind: "word", word: "advance" }, bindings: navigationBindings("confirm") });
        }
        if (navigation.stageControlsAvailable) {
            add({ id: "stageControls", label: { kind: "word", word: "stageControls" }, bindings: navigationBindings("menu") });
        }
    }
    if (navigation.scope === "controls" || (context.lane === "page" && context.canGoBack)) {
        add({ id: "back", label: { kind: "word", word: "back" }, bindings: navigationBindings("cancel") });
    }
    return hints;
}

// === The store the game feeds and the bar reads ===========================================

const REFRESH_MS = 250;

let source: (() => InputHintsSnapshot | null) | null = null;
let current: InputHintsSnapshot | null = null;
let currentKey = "null";
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function refresh(): void {
    let next: InputHintsSnapshot | null = null;
    try {
        next = source?.() ?? null;
    } catch {
        next = null;
    }
    const key = JSON.stringify(next);
    if (key === currentKey) {
        return;
    }
    current = next;
    currentKey = key;
    for (const listener of Array.from(listeners)) {
        listener();
    }
}

function syncTimer(): void {
    const wanted = listeners.size > 0 && source !== null;
    if (wanted && !timer) {
        timer = setInterval(refresh, REFRESH_MS);
    } else if (!wanted && timer) {
        clearInterval(timer);
        timer = null;
    }
}

/** The running game says how to read the hints. Returns a function that stops it. */
export function provideInputHints(read: () => InputHintsSnapshot | null): () => void {
    source = read;
    refresh();
    syncTimer();
    return () => {
        if (source === read) {
            source = null;
            refresh();
            syncTimer();
        }
    };
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (listeners.size === 1) {
        refresh();
    }
    syncTimer();
    return () => {
        listeners.delete(listener);
        syncTimer();
    };
}

function read(): InputHintsSnapshot | null {
    return current;
}

/** The hints the running game publishes, or null outside one - the editor canvas, a preview. */
export function useInputHints(): InputHintsSnapshot | null {
    return useSyncExternalStore(subscribe, read, read);
}
