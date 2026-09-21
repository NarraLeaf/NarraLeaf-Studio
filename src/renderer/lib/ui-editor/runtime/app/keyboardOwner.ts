/**
 * Where a key press goes: the game's global blueprint - its key heads, then the input actions the key
 * is bound to (`globalInputActions`) - then the one entry on screen that owns the keyboard, a page or
 * a layer stacked over it.
 *
 * Which entry that is gets decided once, by `resolveCompositeInput`: the topmost modal layer, or,
 * with no modal layer up, the entry the page lane is settling on. The element-level key heads have
 * always followed that answer - every drawn entry hands its element tree `keyboardInteractive` from
 * it. The surface-level half did not. It was dispatched to the active page or to nobody, so while a
 * modal layer owned the keyboard, the layer's own `On Key Down` / `On Key Up` heads and the input
 * actions it answers had no dispatch point at all. The one thing on screen that owned the keys was
 * the one thing that could not hear them, and "Escape closes the confirmation" could not be written
 * as an action.
 *
 * So the page half is now the owner half, and it reaches the owner through the same per-entry host
 * its layer draws it with (`hostAdapterBundleFor`) - a layer's graphs run on its own scope, read its
 * own widgets and its own props, exactly as they do when it is clicked.
 *
 * Owning is exclusive. While a modal layer owns the keyboard the page under it hears nothing, not
 * even a key the layer's action lets bubble: `consume` decides how far down the lanes under a pointer
 * an input travels, a key has no lanes under it, and the page under a modal is inert to a pointer as
 * well. That is the same rule the page has always had - an action it answers with "keep bubbling"
 * hands its key to nothing - applied to whichever entry holds the keys. A non-modal layer never owns
 * them, so the page beneath one keeps hearing its keys as it always did.
 *
 * Comments in English per project convention.
 */

import type { BlueprintKeyboardEventLike } from "@shared/types/blueprint/graph";
import type { UIDocument, UISurface } from "@shared/types/ui-editor/document";
import { UI_SURFACE_INPUT_ACTION_EVENT } from "@shared/types/ui-editor/inputActionEvent";
import type { BehaviorGraphEventControl } from "@/lib/ui-editor/behavior-graph/BehaviorNodeRegistry";
import {
    dispatchGlobalBlueprintEvent,
    dispatchSurfaceBlueprintEvent,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import { getOrCreateDomEventPropagationControl } from "@/lib/ui-editor/runtime/eventPropagationControl";
import {
    resolveGlobalInputActionPayloads,
    resolveSurfaceInputActionHits,
} from "@/lib/ui-editor/runtime/input/surfaceInputActions";
import { answerGlobalInputActions, type GlobalBlueprintDispatch } from "./globalInputActions";
import { isTextEntryTarget } from "./isTextEntryTarget";
import { keyboardBlueprintPayload } from "./keyboardBlueprintPayload";
import type { HostAdapterBundle } from "./types";

/** One drawn entry that might own the keyboard. */
export type KeyboardOwnerCandidate<TEntry extends { key: string }> = {
    entry: TEntry;
    surface: UISurface;
    /**
     * Whether a key may reach it now: it is drawn, and far enough in that its graphs run.
     *
     * The caller's answer, because what "drawn" means differs between the two lanes - a page can be
     * hidden for the game while it stays on the stack, a layer can name a surface the bundle does
     * not have - and the composite that knows it is the caller's.
     */
    ready: boolean;
};

/** The entry that hears the keys, as a key press needs it: what it draws, and the host it runs on. */
export type KeyboardOwner = {
    surface: UISurface;
    host: HostAdapterBundle;
};

/**
 * The entry the keys belong to, or none.
 *
 * `keyboardOwnerKey` is `resolveCompositeInput`'s answer and is not second-guessed here: this only
 * finds that entry among the drawn ones and asks whether it is ready. An owner that is not ready
 * hears nothing rather than handing its keys to the next entry down - the keys are its, and a page
 * under a modal that is still arriving must not take an Escape meant for the modal.
 */
export function resolveKeyboardOwnerEntry<TEntry extends { key: string }>(input: {
    keyboardOwnerKey: string | null;
    page: KeyboardOwnerCandidate<TEntry> | null;
    layers: readonly KeyboardOwnerCandidate<TEntry>[];
}): { entry: TEntry; surface: UISurface } | null {
    const { keyboardOwnerKey } = input;
    if (keyboardOwnerKey === null) {
        return null;
    }
    const candidates = input.page ? [input.page, ...input.layers] : input.layers;
    const owner = candidates.find(candidate => candidate.entry.key === keyboardOwnerKey);
    return owner?.ready ? { entry: owner.entry, surface: owner.surface } : null;
}

export type GameKeyboardDispatch = GlobalBlueprintDispatch & {
    /** The project's action vocabulary, as `UIDocument.actions` holds it. */
    vocabulary: UIDocument["actions"];
    /** The keyboard owner at this instant. Read once per press, when the key arrives. */
    readKeyboardOwner: () => KeyboardOwner | null;
    onError: (error: unknown) => void;
};

function surfaceStateOf(core: GameKeyboardDispatch["core"], host: HostAdapterBundle) {
    const store = core.scopeBridge.getSurfaceStore(host.runtimeScopeId);
    return {
        getSurfaceState: (key: string) => store.get(key),
        setSurfaceState: (key: string, value: unknown) => store.set(key, value),
    };
}

/**
 * The owner's half of one key press: its surface key heads, then - for a press - the input actions
 * it answers that this key is bound to.
 *
 * Nothing consumes here. See the module comment: a key has no lanes under it, so an action's
 * "stop" and "keep bubbling" read the same for a key, on a page and on a layer alike.
 */
async function dispatchKeyToOwner(
    input: GameKeyboardDispatch,
    owner: KeyboardOwner,
    eventName: "keyDown" | "keyUp",
    payload: Record<string, unknown>,
    eventControl: BehaviorGraphEventControl,
): Promise<void> {
    const { blueprintDocument, persistentVariables, core } = input;
    const { surface, host } = owner;
    const state = surfaceStateOf(core, host);
    await dispatchSurfaceBlueprintEvent({
        blueprintDocument,
        persistentVariables,
        surfaceId: surface.id,
        runtimeScopeId: host.runtimeScopeId,
        eventName,
        eventPayload: payload,
        eventControl,
        hostAdapter: host.hostAdapter,
        debug: core.debug,
        ...state,
        executionManager: core.executionManager,
    });
    if (eventName !== "keyDown" || eventControl.isPropagationStopped()) {
        return;
    }
    const actionHits = resolveSurfaceInputActionHits({
        vocabulary: input.vocabulary,
        enablements: surface.actions,
        signal: { kind: "key", event: payload as BlueprintKeyboardEventLike },
    });
    await Promise.all(actionHits.map(hit => dispatchSurfaceBlueprintEvent({
        blueprintDocument,
        persistentVariables,
        surfaceId: surface.id,
        runtimeScopeId: host.runtimeScopeId,
        eventName: UI_SURFACE_INPUT_ACTION_EVENT,
        eventPayload: { ...hit.payload },
        hostAdapter: host.hostAdapter,
        debug: core.debug,
        ...state,
        executionManager: core.executionManager,
    })));
}

/**
 * One key event, all the way through: the global blueprint's key heads and - for a press - the input
 * actions the key is bound to, then the keyboard owner's heads and actions.
 *
 * Each half is finished before the next starts, and a handler that stops propagation on the event
 * control ends the press there: a global one keeps it from the owner. Nothing on the graph side
 * stops it by itself - the global answering an action the owner answers too runs both, as a global
 * key head and an owner's key head for the same key always have.
 *
 * The owner is read as the key arrives and kept for the whole press. A graph the key starts can
 * change who owns the keyboard - the global Escape head opening a menu layer, the layer's own
 * `On Key Down` closing it - and reading the owner again after that would hand the same press to a
 * second entry, which would then answer a key nobody pressed at it: one Escape closing the dialog
 * and the page behind it.
 */
export async function dispatchGameKey(
    input: GameKeyboardDispatch,
    eventName: "keyDown" | "keyUp",
    event: KeyboardEvent,
): Promise<void> {
    // Typing into a text field must not also drive the game's keys - otherwise entering a name would
    // advance dialogue on space and open the menu on Escape. The widget's own keyboard event still
    // fires: it arrives through DOM bubbling, not here.
    if (isTextEntryTarget(event.target)) {
        return;
    }
    const payload = keyboardBlueprintPayload(event);
    const eventControl = getOrCreateDomEventPropagationControl(event);
    // Inert for a key today, and kept anyway. An element head is a subscription rather than a claim,
    // so nothing a widget runs can silence the keys any more - the one case that ever mattered,
    // typing into a text field, is answered unconditionally above. What still reaches here is
    // `Keep Window Open`, which stops propagation while a close request is being answered; a key
    // arriving inside that window has no business starting anything.
    if (eventControl.isPropagationStopped()) {
        return;
    }
    const owner = input.readKeyboardOwner();
    const { blueprintDocument, persistentVariables, core, globalHost } = input;
    await dispatchGlobalBlueprintEvent({
        blueprintDocument,
        persistentVariables,
        eventName,
        eventPayload: payload,
        eventControl,
        hostAdapter: globalHost.hostAdapter,
        debug: core.debug,
        ...surfaceStateOf(core, globalHost),
        executionManager: core.executionManager,
    });
    if (eventName === "keyDown" && !eventControl.isPropagationStopped()) {
        // The whole vocabulary, not the owner's list: see `globalInputActions`. Resolved by the same
        // rule the owner's are, so a binding the owner answers the global answers too.
        await answerGlobalInputActions(input, resolveGlobalInputActionPayloads({
            vocabulary: input.vocabulary,
            signal: { kind: "key", event: payload as BlueprintKeyboardEventLike },
        }), eventControl);
    }
    if (!owner || eventControl.isPropagationStopped()) {
        return;
    }
    await dispatchKeyToOwner(input, owner, eventName, payload, eventControl);
}

/**
 * Listen for the game's keys on `target` until the returned function is called.
 *
 * One listener serves both halves so their order is fixed - global first, then the owner. The owner
 * comes from `readKeyboardOwner` per press rather than from a listener re-registered whenever it
 * changes, which would keep swapping that order.
 */
export function listenForGameKeys(
    target: Pick<Window, "addEventListener" | "removeEventListener">,
    input: GameKeyboardDispatch,
): () => void {
    const onKeyDown = (event: KeyboardEvent) => {
        dispatchGameKey(input, "keyDown", event).catch(input.onError);
    };
    const onKeyUp = (event: KeyboardEvent) => {
        dispatchGameKey(input, "keyUp", event).catch(input.onError);
    };
    target.addEventListener("keydown", onKeyDown);
    target.addEventListener("keyup", onKeyUp);
    return () => {
        target.removeEventListener("keydown", onKeyDown);
        target.removeEventListener("keyup", onKeyUp);
    };
}
