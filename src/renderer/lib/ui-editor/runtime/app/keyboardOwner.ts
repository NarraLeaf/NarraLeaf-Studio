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
 * ## The stage
 *
 * With the story on screen and nothing drawn over it, no entry owns the keyboard: the pages a game
 * hid when it took the screen are not drawn, so none of them is ready. The keys then belong to the
 * stage - the dialogue box, the choice list, the quick menu the story put there - and every surface
 * on it hears them as a page would: its key heads, and the actions it answers. That is where "Space
 * advances" lives: the starter project's dialogue box answers Advance, and Advance is bound to a
 * click, Space and Enter. Before the stage could own the keyboard, a key bound to an action a stage
 * surface answered was a binding that looked wired and never fired - every key reached the window,
 * and nothing on the stage was ever asked about it.
 *
 * An NVL passage takes the dialogue box off the stage. A project that draws its own NVL page has a
 * surface there instead, which hears the keys like any other; the engine's own page is not a surface,
 * and stands in for the box: the keys that read the box on read it on (`engineNvlKeys`).
 *
 * "Nothing drawn over it" is the question the skip loop and the auto-forward hold already ask
 * (`isStoryOnScreen`), so the keys leave the stage exactly when the story stops moving on its own: a
 * page opened over it or a modal layer takes them, and the page or the layer answers them instead.
 *
 * ## One press, one key down
 *
 * The repeats the system sends while a key is held down reach nothing here: not an action, and not
 * an `On Key Down` head either. A key down is the key going down, which happens once however long it
 * is held. Holding a key is one gesture - the rule a wheel's inertia tail already follows - and
 * answering its repeats made a held Escape step back through page after page, a held F11 flick
 * fullscreen on and off, and a held Space read every line at the keyboard's repeat rate. Holding to
 * skip is the skip key's, which watches the key itself rather than these events.
 *
 * ## What raises an action
 *
 * A key heard by its owner raises the actions bound to it, unless the focused control has spoken for
 * it (`keyInputClaimedByControl`): Enter on a button the player moved to with Tab presses that button
 * and does not also advance the story.
 *
 * ## Navigation
 *
 * The arrows, Tab and Escape raise the navigation actions (`nl.nav.*`) by default. When the owner
 * answers nothing the key raised, navigation does what they ask (`navigationDefaults`) - before any
 * graph runs, so the browser's own Tab can still be stopped. A held arrow's repeats move the focus
 * too, and reach nothing else.
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
    keyInputClaimedByControl,
    resolveGlobalInputActionPayloads,
    resolveSurfaceInputActionHits,
} from "@/lib/ui-editor/runtime/input/surfaceInputActions";
import { isSyntheticKeyPress } from "@/lib/ui-editor/runtime/input/syntheticKeyPress";
import type { AmbientSurfaceTarget } from "./ambientSurfaceEvents";
import { isDialogueSlotSurface, type DialogueAdvanceObserver, type EngineNvlKeys } from "./engineNvlKeys";
import { answerGlobalInputActions, type GlobalBlueprintDispatch } from "./globalInputActions";
import { isTextEntryTarget } from "./isTextEntryTarget";
import { keyboardBlueprintPayload } from "./keyboardBlueprintPayload";
import { claimNavigationConfirm, runNavigationDefaults, type NavigationBack } from "./navigationDefaults";
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

/**
 * Whoever hears the keys, as a key press needs it: an entry - what it draws, and the host it runs
 * on - or the stage, as the surfaces the story has on it.
 */
export type KeyboardOwner =
    | {
          surface: UISurface;
          host: HostAdapterBundle;
      }
    | {
          /**
           * The surfaces on the stage that take input, each on the host it is drawn with, one per
           * runtime scope (see `AmbientSurfaceTargets`). Read as the key arrives, like the entry.
           */
          stage: readonly AmbientSurfaceTarget[];
          /**
           * The engine's own NVL page, when it is up in place of the dialogue box: the keys that
           * read the box on read it on too (see `engineNvlKeys`). Absent otherwise.
           */
          engineNvl?: EngineNvlKeys | null;
          /**
           * Told which of a press's actions read the dialogue box on, when the box answers them -
           * how a box whose `Next` is in a script layer gets its keys onto the NVL page too (see
           * `createDialogueAdvanceRecord`). Absent where nothing learns from it.
           */
          dialogueAdvance?: DialogueAdvanceObserver | null;
          /**
           * Reading the story on, for a Confirm nothing on the stage answered (`navigationDefaults`):
           * the click on the stage a mouse player would make. `actionIds` are the actions known to
           * read on already - a press that raised one of them has done it, and must not do it twice.
           */
          storyAdvance?: { actionIds: ReadonlySet<string>; advance: () => Promise<void> | void } | null;
      };

/** The surfaces an owner hears a key through: the entry's one, or every one on the stage. */
function ownerSurfaces(owner: KeyboardOwner): readonly AmbientSurfaceTarget[] {
    if ("stage" in owner) {
        return owner.stage;
    }
    return [{ surface: owner.surface, hostAdapter: owner.host.hostAdapter, runtimeScopeId: owner.host.runtimeScopeId }];
}

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

/**
 * Which lane a key press reaches: an entry, the stage, or nothing.
 *
 * The rule the module comment states, written once so the key listener and the Dev Mode Layers
 * panel read the same function: the entry {@link resolveKeyboardOwnerEntry} found ready, or - with no
 * entry owning the keys - the stage, while the story is what the player is looking at.
 */
export type KeyboardOwnerLane<TEntry> =
    | { kind: "entry"; entry: TEntry }
    | { kind: "stage" };

/**
 * Decide the lane for this instant.
 *
 * `isStoryOnScreen` is asked only when no entry owns the keys, as the listener has always asked it:
 * it reads the live page and layer stacks, and an owning entry already answers the question.
 */
export function resolveKeyboardOwnerLane<TEntry>(input: {
    entry: TEntry | null;
    isStoryOnScreen: () => boolean;
}): KeyboardOwnerLane<TEntry> | null {
    if (input.entry) {
        return { kind: "entry", entry: input.entry };
    }
    return input.isStoryOnScreen() ? { kind: "stage" } : null;
}

export type GameKeyboardDispatch = GlobalBlueprintDispatch & {
    /**
     * The vocabulary a running game routes by: the project's actions, as `UIDocument.actions` holds
     * them - the navigation slots among them, on the intents that fill one.
     */
    vocabulary: UIDocument["actions"];
    /** The keyboard owner at this instant. Read once per press, when the key arrives. */
    readKeyboardOwner: () => KeyboardOwner | null;
    /**
     * The element the game draws into, where navigation finds the controls (`focusNavigation`).
     * Absent where nothing is drawn - a test of the routing alone - and navigation then does nothing.
     */
    readGameRoot?: () => Element | null;
    /** Where navigation's Back goes from a page or a layer (`NavigationBack`). Absent, nowhere. */
    back?: NavigationBack;
    onError: (error: unknown) => void;
};

function surfaceStateOf(core: GameKeyboardDispatch["core"], host: { runtimeScopeId: string }) {
    const store = core.scopeBridge.getSurfaceStore(host.runtimeScopeId);
    return {
        getSurfaceState: (key: string) => store.get(key),
        setSurfaceState: (key: string, value: unknown) => store.set(key, value),
    };
}

/**
 * The owner's half of one key press, surface by surface: its key heads, then - for a press that
 * may raise actions - the input actions it answers that this key is bound to.
 *
 * Nothing consumes here. See the module comment: a key has no lanes under it, so an action's
 * "stop" and "keep bubbling" read the same for a key, on a page, a layer and the stage alike. Each
 * surface on the stage answers for itself, the way each action a page answers does.
 */
async function dispatchKeyToOwner(
    input: GameKeyboardDispatch,
    owner: KeyboardOwner,
    eventName: "keyDown" | "keyUp",
    payload: Record<string, unknown>,
    eventControl: BehaviorGraphEventControl,
    raisesActions: boolean,
): Promise<void> {
    const { blueprintDocument, persistentVariables, core } = input;
    for (const { surface, hostAdapter, runtimeScopeId } of ownerSurfaces(owner)) {
        if (eventControl.isPropagationStopped()) {
            return;
        }
        const state = surfaceStateOf(core, { runtimeScopeId });
        await dispatchSurfaceBlueprintEvent({
            blueprintDocument,
            persistentVariables,
            surfaceId: surface.id,
            runtimeScopeId,
            eventName,
            eventPayload: payload,
            eventControl,
            hostAdapter,
            debug: core.debug,
            ...state,
            executionManager: core.executionManager,
        });
        if (!raisesActions || eventControl.isPropagationStopped()) {
            continue;
        }
        const actionHits = resolveSurfaceInputActionHits({
            vocabulary: input.vocabulary,
            enablements: surface.actions,
            signal: { kind: "key", event: payload as BlueprintKeyboardEventLike },
        });
        // Whether the dialogue box reads on in answer, whatever layer does it - see `dialogueAdvance`.
        const observer = "stage" in owner && isDialogueSlotSurface(surface) ? owner.dialogueAdvance ?? null : null;
        const nextCallsBefore = observer?.nextCalls() ?? 0;
        await Promise.all(actionHits.map(hit => dispatchSurfaceBlueprintEvent({
            blueprintDocument,
            persistentVariables,
            surfaceId: surface.id,
            runtimeScopeId,
            eventName: UI_SURFACE_INPUT_ACTION_EVENT,
            eventPayload: { ...hit.payload },
            hostAdapter,
            debug: core.debug,
            ...state,
            executionManager: core.executionManager,
        })));
        if (observer && actionHits.length > 0 && observer.nextCalls() !== nextCallsBefore) {
            observer.witnessed(actionHits.map(hit => hit.actionId));
        }
    }
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
    // advance dialogue on space and open the menu on Escape. Widget key heads stand down for the
    // same key on their own (see `isTextEntryTarget`); the field reports Value Changed and Submit.
    if (isTextEntryTarget(event.target)) {
        return;
    }
    // A pad's Confirm pressing a control the way Enter does: the control has answered it, and the
    // game never heard a key (see `syntheticKeyPress`).
    if (isSyntheticKeyPress(event)) {
        return;
    }
    const payload = keyboardBlueprintPayload(event);
    const navigationRoot = gameRootForKey(input, event);
    // A held key's repeats are not presses; see the module comment. They still move the focus, as an
    // arrow held down in any list does - navigation is the one thing a repeat is for.
    if (eventName === "keyDown" && event.repeat) {
        if (!keyInputClaimedByControl(event)) {
            const signal = { kind: "key" as const, event: payload as BlueprintKeyboardEventLike };
            const actionIds = resolveGlobalInputActionPayloads({ vocabulary: input.vocabulary, signal })
                .map(action => action.actionId);
            if (runNavigationDefaults({
                gameRoot: navigationRoot,
                owner: input.readKeyboardOwner(),
                back: input.back,
                vocabulary: input.vocabulary,
                blueprintDocument: input.blueprintDocument,
                signal,
                actionIds,
                repeat: true,
            })) {
                event.preventDefault();
            }
        }
        return;
    }
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
    // Decided once, as the key arrives, for the global blueprint and the owner alike - see the
    // module comment. Read before any graph runs, because a graph can move the focus.
    const raisesActions = eventName === "keyDown" && !keyInputClaimedByControl(event);
    // Every action this key is bound to, whoever answers it: the global blueprint hears all of them,
    // and the engine's NVL page reads on for the dialogue box's.
    const raisedActions = raisesActions
        ? resolveGlobalInputActionPayloads({
            vocabulary: input.vocabulary,
            signal: { kind: "key", event: payload as BlueprintKeyboardEventLike },
        })
        : [];
    // A key bound to the intent in the Confirm slot presses the focused control, as Enter on it
    // would, and raises nothing else - the claim `keyInputClaimedByControl` already makes for Enter
    // and Space themselves, made for whatever key the project put there.
    if (raisesActions && claimNavigationConfirm(navigationRoot, input.vocabulary, raisedActions.map(action => action.actionId))) {
        event.preventDefault();
        return;
    }
    // Navigation goes now, while the browser's default for the key - Tab's own move, an arrow's
    // scroll - can still be stopped, and before any graph can change who holds the keys.
    if (raisesActions && runNavigationDefaults({
        gameRoot: navigationRoot,
        owner,
        back: input.back,
        vocabulary: input.vocabulary,
        blueprintDocument: input.blueprintDocument,
        signal: { kind: "key", event: payload as BlueprintKeyboardEventLike },
        actionIds: raisedActions.map(action => action.actionId),
    })) {
        event.preventDefault();
    }
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
    if (raisesActions && !eventControl.isPropagationStopped()) {
        // The whole vocabulary, not the owner's list: see `globalInputActions`. Resolved by the same
        // rule the owner's are, so a binding the owner answers the global answers too.
        await answerGlobalInputActions(input, raisedActions, eventControl);
    }
    if (!owner || eventControl.isPropagationStopped()) {
        return;
    }
    await dispatchKeyToOwner(input, owner, eventName, payload, eventControl, raisesActions);
    const engineNvl = "stage" in owner ? owner.engineNvl : null;
    if (engineNvl && !eventControl.isPropagationStopped()
        && raisedActions.some(action => engineNvl.actionIds.has(action.actionId))) {
        await engineNvl.advance();
    }
}

/**
 * The game root a key may move the focus in, or null when the key was pressed somewhere that is not
 * the game's - a field in a Dev Mode panel, a button in the window's own chrome. Tab there moves
 * between that thing's controls, not the game's.
 */
function gameRootForKey(input: GameKeyboardDispatch, event: KeyboardEvent): Element | null {
    const root = input.readGameRoot?.() ?? null;
    const target = event.target;
    if (!root || typeof Element === "undefined" || !(target instanceof Element)) {
        return root;
    }
    const document = target.ownerDocument;
    return target === document.body || target === document.documentElement || root.contains(target) ? root : null;
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
