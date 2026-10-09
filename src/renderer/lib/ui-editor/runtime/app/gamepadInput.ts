/**
 * Where a gamepad button goes: the game's global blueprint - its gamepad heads, then the input
 * actions the button is bound to - then the one entry on screen that owns the keys.
 *
 * The owner is the keyboard owner. A modal layer that owns the keys owns the pad too; a page under
 * it hears nothing. There is no text-entry gate: a pad cannot type into a field, so the keyboard's
 * `isTextEntryTarget` exemption would only swallow presses that have nowhere else to go.
 *
 * The pad moves the same focus the keyboard does (`focusNavigation`). Its D-pad and left stick raise
 * the navigation actions by default, and when the owner answers nothing a press raised, navigation
 * moves the focus (`navigationDefaults`); held, they repeat, as a held arrow key does. A on a focused
 * control presses that control and raises nothing else - the pad's half of the claim a focused button
 * makes on Enter - so the Start button a player moved to starts the game rather than also advancing
 * the line behind the menu.
 *
 * After the owner, the controls: every mounted widget with a gamepad head on a drawing that holds
 * the keys (`gamepadControls`). That is the order a key goes in - the global, then the owner, then the
 * controls listening on `window` - and like a key, a press carries one event control the whole way,
 * so a handler that stops it anywhere keeps it from everything after: a global head that stops a press
 * keeps it from the owner and from every control. There is no DOM event to hang that control on, so
 * each edge makes its own and hands it along.
 *
 * Who hears a press is settled before any of its graphs run, as a key's is: the owner is read then,
 * and the controls listening then are the ones it is handed to, so a layer the global's graph opens
 * does not also hear the press that opened it. Dispatch is a serial queue so a second press that
 * arrives while the first graph is still running cannot overtake it; the controls are started rather
 * than waited for, as a key's listeners are, so a control's graph that waits on something does not
 * hold up the next press.
 *
 * Installed only from GameApp (Dev Mode / preview / exported runtime). The editor canvas never
 * starts the tracker, so widget heads there stay quiet even if they subscribe.
 *
 * Comments in English per project convention.
 */

import { UI_SURFACE_INPUT_ACTION_EVENT } from "@shared/types/ui-editor/inputActionEvent";
import { uiNavigationIntentRepeats } from "@shared/types/ui-editor/navigation";
import type { BehaviorGraphEventControl } from "@/lib/ui-editor/behavior-graph/BehaviorNodeRegistry";
import {
    dispatchGlobalBlueprintEvent,
    dispatchSurfaceBlueprintEvent,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import { createEventPropagationControl } from "@/lib/ui-editor/runtime/eventPropagationControl";
import { captureGamepadControls } from "@/lib/ui-editor/runtime/input/gamepadControls";
import { noteInputDevice } from "@/lib/ui-editor/runtime/input/inputDeviceState";
import { getSharedInputHoldTracker } from "@/lib/ui-editor/runtime/input/inputHoldState";
import {
    getSharedGamepadTracker,
    type UIGamepadButtonEdge,
} from "@/lib/ui-editor/runtime/input/gamepadState";
import {
    resolveGlobalInputActionPayloads,
    resolveSurfaceInputActionHits,
} from "@/lib/ui-editor/runtime/input/surfaceInputActions";
import type { AmbientSurfaceTarget } from "./ambientSurfaceEvents";
import { isDialogueSlotSurface } from "./engineNvlKeys";
import { answerGlobalInputActions } from "./globalInputActions";
import type { GameKeyboardDispatch, KeyboardOwner } from "./keyboardOwner";
import { claimNavigationConfirm, raisedNavigationIntents, runNavigationDefaults } from "./navigationDefaults";

export type GameGamepadDispatch = GameKeyboardDispatch;

function surfaceStateOf(core: GameGamepadDispatch["core"], host: { runtimeScopeId: string }) {
    const store = core.scopeBridge.getSurfaceStore(host.runtimeScopeId);
    return {
        getSurfaceState: (key: string) => store.get(key),
        setSurfaceState: (key: string, value: unknown) => store.set(key, value),
    };
}

function ownerSurfaces(owner: KeyboardOwner): readonly AmbientSurfaceTarget[] {
    if ("stage" in owner) {
        return owner.stage;
    }
    return [{ surface: owner.surface, hostAdapter: owner.host.hostAdapter, runtimeScopeId: owner.host.runtimeScopeId }];
}

function eventNameOf(edge: UIGamepadButtonEdge): "gamepadButtonDown" | "gamepadButtonUp" {
    return edge.type === "down" ? "gamepadButtonDown" : "gamepadButtonUp";
}

async function dispatchGamepadToOwner(
    input: GameGamepadDispatch,
    owner: KeyboardOwner,
    eventName: "gamepadButtonDown" | "gamepadButtonUp",
    payload: Record<string, unknown>,
    eventControl: BehaviorGraphEventControl,
    raisesActions: boolean,
    button: string,
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
            signal: { kind: "gamepad", button },
        });
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
 * One press or release, all the way through: the global blueprint's gamepad heads and - for a press -
 * the input actions the button is bound to, then the keyboard owner's heads and actions, then the
 * controls (see the module comment).
 */
export async function dispatchGameGamepad(
    input: GameGamepadDispatch,
    edge: UIGamepadButtonEdge,
): Promise<void> {
    const eventName = eventNameOf(edge);
    const payload = { button: edge.button };
    const eventControl = createEventPropagationControl();
    const owner = input.readKeyboardOwner();
    const controls = captureGamepadControls();
    const signal = { kind: "gamepad" as const, button: edge.button };
    let raisesActions = edge.type === "down";
    let raisedActions = raisesActions
        ? resolveGlobalInputActionPayloads({ vocabulary: input.vocabulary, signal })
        : [];
    if (raisesActions) {
        const gameRoot = input.readGameRoot?.() ?? null;
        const actionIds = raisedActions.map(action => action.actionId);
        if (claimNavigationConfirm(gameRoot, actionIds)) {
            // The focused control took the press; see the module comment.
            raisesActions = false;
            raisedActions = [];
        } else {
            runNavigationDefaults({ gameRoot, owner, isEntrySurface: input.isEntrySurface, vocabulary: input.vocabulary, signal, actionIds });
        }
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
        await answerGlobalInputActions(input, raisedActions, eventControl);
    }
    if (owner && !eventControl.isPropagationStopped()) {
        await dispatchGamepadToOwner(input, owner, eventName, payload, eventControl, raisesActions, edge.button);
        const engineNvl = "stage" in owner ? owner.engineNvl : null;
        if (engineNvl && !eventControl.isPropagationStopped()
            && raisedActions.some(action => engineNvl.actionIds.has(action.actionId))) {
            await engineNvl.advance();
        }
    }
    controls(edge, eventControl);
}

/**
 * Start the shared gamepad tracker and dispatch its edges until the returned function is called.
 *
 * Widget heads are handed their presses from here (`gamepadControls`); nothing else starts the
 * tracker, and nothing else hands them a press, which is what keeps the editor canvas quiet.
 */
export function listenForGamepads(input: GameGamepadDispatch): () => void {
    const tracker = getSharedGamepadTracker();
    const hold = getSharedInputHoldTracker();
    let queue: Promise<void> = Promise.resolve();
    const unsubHeld = tracker.onHeldButtons(buttons => {
        hold.setGamepadButtons(buttons);
    });
    const repeat = createNavigationRepeat(input, button => tracker.read().buttons.has(button));
    const unsubEdge = tracker.onEdge(edge => {
        noteInputDevice("gamepad");
        repeat.edge(edge);
        queue = queue.then(() => dispatchGameGamepad(input, edge)).catch(input.onError);
    });
    tracker.start();
    return () => {
        unsubEdge();
        unsubHeld();
        repeat.stop();
        tracker.stop();
        hold.setGamepadButtons(new Set());
    };
}

/** How long a held direction waits before it repeats, and how often it repeats after that. */
export const GAMEPAD_NAVIGATION_REPEAT_DELAY_MS = 400;
export const GAMEPAD_NAVIGATION_REPEAT_INTERVAL_MS = 120;

/**
 * A held D-pad direction moving the focus again and again, as a held arrow key does.
 *
 * The pad sends one edge per press, so the repeats are made here: only for a button whose press
 * raised a navigation move, only while it stays down, and only the move - like a key's repeats, they
 * are not presses, and no head or action hears them. A second button going down ends the first one's
 * repeat: the newest press is the one the player means.
 */
function createNavigationRepeat(input: GameGamepadDispatch, isHeld: (button: string) => boolean) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let held: string | null = null;
    const clear = () => {
        if (timer) {
            clearTimeout(timer);
        }
        timer = null;
        held = null;
    };
    const step = (button: string) => {
        if (held !== button || !isHeld(button)) {
            clear();
            return;
        }
        const signal = { kind: "gamepad" as const, button };
        runNavigationDefaults({
            gameRoot: input.readGameRoot?.() ?? null,
            owner: input.readKeyboardOwner(),
            isEntrySurface: input.isEntrySurface,
            vocabulary: input.vocabulary,
            signal,
            actionIds: resolveGlobalInputActionPayloads({ vocabulary: input.vocabulary, signal }).map(action => action.actionId),
            repeat: true,
        });
        timer = setTimeout(() => step(button), GAMEPAD_NAVIGATION_REPEAT_INTERVAL_MS);
    };
    return {
        edge(edge: UIGamepadButtonEdge) {
            if (edge.type === "up") {
                if (held === edge.button) {
                    clear();
                }
                return;
            }
            clear();
            const actionIds = resolveGlobalInputActionPayloads({
                vocabulary: input.vocabulary,
                signal: { kind: "gamepad", button: edge.button },
            }).map(action => action.actionId);
            if (![...raisedNavigationIntents(actionIds)].some(uiNavigationIntentRepeats)) {
                return;
            }
            held = edge.button;
            timer = setTimeout(() => step(edge.button), GAMEPAD_NAVIGATION_REPEAT_DELAY_MS);
        },
        stop: clear,
    };
}
