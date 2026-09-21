import type { Blueprint, BlueprintDocument, BlueprintLayer, BlueprintGraphIr, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { buildGameScriptContext, resolveScriptLayerHandlers, scriptSelfOf } from "./script/scriptRuntime";
import {
    scriptEventIdForProjectSlot,
    scriptEventIdForSurfaceSlot,
    scriptEventIdForWidgetSlot,
    scriptEventIdOfHead,
} from "./script/scriptEventDispatch";
import type { ScriptEventId } from "./script/scriptEvents";
import type { GameScriptContext, ScriptListRow, ScriptSelf } from "./script/scriptContext";
import type { PersistentVariableRuntimeTable } from "@shared/types/variables/registry";
import { buildBlueprintRunGraphId, type BlueprintRunGraphKind } from "@shared/blueprint/blueprintRunGraphId";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST,
    collectBlueprintEventHeadNodeIdsForDispatch,
    collectSurfaceEventHeadNodeIdsForDispatch,
    collectGlobalEventHeadNodeIdsForDispatch,
    isBlueprintEventDispatchHeadType,
} from "@shared/types/blueprint/graph";
import { findBlueprintFnByRef, isBlueprintFnVisibleToOwner } from "@/lib/workspace/services/ui-editor/blueprint/fnCatalog";
import { writeBlueprintNodeOutputValues } from "@/lib/ui-editor/blueprint-nodes/nodeOutputValues";
import type { BlueprintElementRef } from "@shared/types/blueprint/valueTypes";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
import { resolveUIElementDrawingKey } from "@shared/types/ui-editor/widgetDrawing";
import { getWidgetLogicEvent, getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { executeGraph } from "@/lib/ui-editor/behavior-graph";
import type {
    BehaviorGraphEventControl,
    BehaviorGraphValueTracking,
} from "@/lib/ui-editor/behavior-graph/BehaviorNodeRegistry";
import {
    BlueprintGraphExecutionError,
    isBlueprintGraphExecutionCancelledError,
    stepLimitOfExecutionError,
    throwIfBlueprintExecutionCancelled,
} from "@/lib/ui-editor/behavior-graph/GraphExecutionError";
import type { UIHostAdapter, UIHostAdapterElementEventOptions } from "@/lib/ui-editor/runtime/types";
import type {
    BlueprintGamePreferenceKey,
    BlueprintGamePreferenceValue,
    BlueprintHostApiRuntime,
} from "./BlueprintHostApiBridge";
import type { BlueprintExecutionHandle, BlueprintExecutionManager } from "./BlueprintExecutionManager";
import { adaptBlueprintGraphIr } from "./adaptBlueprintGraphIr";
import { acquireBlueprintExecutionLocals } from "./blueprintWidgetLocals";
import type { DebugBridge } from "./DebugBridge";
import { truncateDebugEventMessage } from "./DebugBridge";
import {
    componentWidgetMainOwnerKey,
    widgetMainOwnerKey,
    surfaceMainOwnerKey,
    GLOBAL_MAIN_OWNER_KEY,
} from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";
import { readBlueprintElementRefParams } from "@/lib/ui-editor/blueprint-nodes/built-in/elementRefUtils";

/**
 * How many nodes one event may run between two real waits before it is taken for a runaway loop.
 *
 * The count restarts whenever a node actually waits (the event loop turned while it ran), so a
 * polling loop with a Delay in it is never stopped. What it catches is an exec wire that loops back
 * with nothing on it that waits, which would otherwise hold the window forever. A count rather than
 * a time limit, so the same graph stops at the same place on every machine. Ten thousand leaves room
 * for the ordinary synchronous loop - walking every save slot or every CG in a gallery - while a
 * genuine runaway is still stopped, and reported by name, well inside a second.
 */
const DEFAULT_MAX_STEPS = 10_000;

type CancellableDispatchOptions = {
    executionManager?: BlueprintExecutionManager;
    allowClosedScopeExecution?: boolean;
};

function readDispatchElement(document: UIDocument, elementId: string, componentId?: string): UIElement | undefined {
    if (componentId) {
        const componentElement = document.components?.find(component => component.id === componentId)?.elements[elementId];
        if (componentElement) {
            return componentElement;
        }
    }
    return document.elements[elementId];
}

function beginTrackedExecution(input: {
    executionManager?: BlueprintExecutionManager;
    executionId: string;
    runtimeScopeId?: string;
    blueprintId?: string;
    eventId?: string;
    allowClosedScopeExecution?: boolean;
}): BlueprintExecutionHandle | null {
    return input.executionManager?.beginExecution({
        executionId: input.executionId,
        runtimeScopeId: input.runtimeScopeId,
        blueprintId: input.blueprintId,
        eventId: input.eventId,
        allowClosedScope: input.allowClosedScopeExecution,
    }) ?? null;
}

function emitExecutionCancelled(input: {
    debug: DebugBridge;
    executionId: string;
    blueprintId?: string;
    eventId?: string;
    graphId?: string;
    nodeId?: string;
    reason?: string;
}): void {
    input.debug.emit({
        type: "execution.cancelled",
        executionId: input.executionId,
        blueprintId: input.blueprintId,
        eventId: input.eventId,
        graphId: input.graphId,
        nodeId: input.nodeId,
        reason: input.reason,
    });
}

/**
 * Report a failed execution.
 *
 * Every dispatcher below ends in the same three-branch catch, and this is the branch that has to
 * carry `surfaceId`: a host turns these into the list an author reads, and one emit site that
 * forgets the surface is one failure that arrives with nowhere to look. Mirrors
 * {@link emitExecutionCancelled} so the pair is written the same way.
 */
function emitExecutionError(input: {
    debug: DebugBridge;
    executionId: string;
    message: string;
    blueprintId?: string;
    eventId?: string;
    nodeId?: string;
    surfaceId?: string;
    /** Carried over from the executor's own report, so both reports of one stop are the same. */
    stepLimit?: ReturnType<typeof stepLimitOfExecutionError>;
}): void {
    input.debug.emit({
        type: "execution.error",
        executionId: input.executionId,
        message: input.message,
        blueprintId: input.blueprintId,
        eventId: input.eventId,
        nodeId: input.nodeId,
        surfaceId: input.surfaceId,
        ...(input.stepLimit ? { stepLimit: input.stepLimit } : {}),
    });
}

/**
 * The drawing whose variables a widget's blueprint uses while it answers an event: the drawing the
 * widget itself is in, as seen from the drawing the event came from.
 *
 * For almost every event the two are the same - a label in a row is pressed in that row. A list is
 * the exception that makes this worth asking: Item Click, Item Hover and Item Render are the list's
 * own events and run in the row they are about, but the list is not inside any of its rows. Keying
 * its variables by the row gave every row a private, freshly defaulted copy of them, so a `Set Var`
 * in Item Click was invisible to the list's Init, to its scroll handler and to the next row's
 * click - it ran, and nothing ever read it. The same rule that sends a row's writes to the drawing
 * their target is in (`widgetDrawing.ts`) answers this for the list's own id.
 */
function ownerDrawingKey(document: UIDocument, elementId: string, instanceKey: string | undefined): string | undefined {
    return instanceKey ? resolveUIElementDrawingKey(document, elementId, instanceKey) : undefined;
}

/**
 * Every drawing of an element that an event no drawing raised runs in.
 *
 * A broadcast, a window event, a head listening for some other element's click or flush - these
 * reach an element's blueprint without coming from any one drawing of it, so the question "which
 * row" has no answer in the event. It used to get none: the graph ran once, as nobody. For an
 * element drawn once, for the page, that is the right answer and it still is. For an element a list
 * repeats it meant `Get Item Field` read nothing and `Set Property (self)` wrote to the template,
 * which no row draws - the graph ran, the log was clean, and no row changed.
 *
 * Such an element now answers once per row on screen, each run in its row, the way a key press
 * already reached every row (each drawing listens for keys itself). Every row is the answer because
 * every row is a widget the player can see; a single page-level run would be a run of a widget that
 * is not on screen anywhere. A list showing no rows runs nothing. The host knows which rows are on
 * screen (`UIHostAdapterDrawings`); one that does not keeps the single run.
 */
function drawingsReachedBy(hostAdapter: UIHostAdapter, elementId: string | undefined): UIHostAdapterElementEventOptions[] {
    if (!elementId) {
        return [{}];
    }
    return hostAdapter.blueprintRuntime?.drawings?.everyDrawingOf(elementId) ?? [{}];
}

/**
 * The `ctx` a script handler is called with, from what a dispatch has in hand.
 *
 * One place rather than three, because the three dispatch paths differ only in which self they can
 * name - a widget, a surface, the project - and everything else about the context is the same
 * question answered the same way. `vars` is the drawing's own store, the one a graph's `Var` nodes
 * use, so a script and a graph on the same slot remember things with the same lifetime.
 */
function buildDispatchScriptContext(input: {
    hostAdapter: UIHostAdapter;
    blueprintDocument: BlueprintDocument;
    blueprint: Blueprint;
    runtimeScopeId?: string;
    elementId?: string;
    /** The drawing the owning widget is in, which keys `vars` - see {@link ownerDrawingKey}. */
    ownerDrawingKey?: string;
    /** The drawing the event is running in, which the element ids a script names are read from. */
    instanceKey?: string;
    self: ScriptSelf;
    /** Present only where an event can be stopped - a widget's. A surface or the project has none. */
    eventControl?: BehaviorGraphEventControl;
    signal?: AbortSignal;
}): GameScriptContext {
    const hostApi = input.hostAdapter.blueprintRuntime?.hostApi;
    if (!hostApi) {
        // Every path that reaches here has a running game behind it; a host without an API is the
        // editor preview, which does not dispatch.
        throw new BlueprintGraphExecutionError("Host API unavailable (use Dev Mode)", input.blueprint.id);
    }
    return buildGameScriptContext({
        self: input.self,
        hostAdapter: input.hostAdapter,
        hostApi,
        instanceKey: input.instanceKey,
        vars: acquireBlueprintExecutionLocals({
            blueprintDocument: input.blueprintDocument,
            currentBlueprintId: input.blueprint.id,
            surfaceId: input.self.kind === "surface" || input.self.kind === "element" ? input.self.surfaceId : undefined,
            runtimeScopeId: input.runtimeScopeId,
            elementId: input.elementId,
            elementInstanceKey: input.ownerDrawingKey,
        }),
        signal: input.signal,
        // A script says `ctx.stopPropagation()` where a graph places `Stop Propagation` or
        // `Keep Window Open`; both reach the same event control.
        stopPropagation: () => input.eventControl?.stopPropagation(),
    });
}

/**
 * Run one script blueprint's handler for one dispatch.
 *
 * Six paths reach a script - a widget's own event, a page's, the project's, a broadcast, an element
 * event and the widget fan-out - and every one of them wants the same five things around the call:
 * a tracked execution, a started/finished pair on the debug bridge, the ctx, the cancellation check
 * either side of the await, and the three-branch catch. Written once here so a new dispatch path
 * cannot reach a script through a shorter route that forgets one of them.
 *
 * `eventId` is the id this dispatch traces under - its own, not the script event's. The trace is
 * read against the runtime's own vocabulary (a slider's `valueChanged`), while the export name was
 * resolved by the caller through `scriptEventDispatch.ts`.
 */
async function runScriptBlueprintHandler(input: {
    handler: (...args: unknown[]) => unknown;
    blueprint: Blueprint;
    blueprintDocument: BlueprintDocument;
    hostAdapter: UIHostAdapter;
    debug: DebugBridge;
    self: ScriptSelf;
    eventId: string;
    eventPayload?: Record<string, unknown>;
    runtimeScopeId?: string;
    surfaceId?: string;
    elementId?: string;
    ownerDrawingKey?: string;
    instanceKey?: string;
    eventControl?: BehaviorGraphEventControl;
    executionManager?: BlueprintExecutionManager;
    allowClosedScopeExecution?: boolean;
}): Promise<void> {
    const blueprintId = input.blueprint.id;
    const executionId = newExecutionId();
    const execution = beginTrackedExecution({
        executionManager: input.executionManager,
        executionId,
        runtimeScopeId: input.runtimeScopeId,
        blueprintId,
        eventId: input.eventId,
        allowClosedScopeExecution: input.allowClosedScopeExecution,
    });
    input.debug.emit({ type: "execution.started", executionId, blueprintId });
    try {
        const ctx = buildDispatchScriptContext({
            hostAdapter: input.hostAdapter,
            blueprintDocument: input.blueprintDocument,
            blueprint: input.blueprint,
            runtimeScopeId: input.runtimeScopeId,
            elementId: input.elementId,
            ownerDrawingKey: input.ownerDrawingKey,
            instanceKey: input.instanceKey,
            eventControl: input.eventControl,
            self: input.self,
            signal: execution?.signal,
        });
        throwIfBlueprintExecutionCancelled(execution?.signal);
        await Promise.resolve(input.handler(ctx, input.eventPayload ?? {}));
        throwIfBlueprintExecutionCancelled(execution?.signal);
        input.debug.emit({ type: "execution.finished", executionId, blueprintId });
    } catch (err) {
        if (isBlueprintGraphExecutionCancelledError(err)) {
            emitExecutionCancelled({
                debug: input.debug,
                executionId,
                blueprintId,
                eventId: input.eventId,
                reason: err.message,
            });
            return;
        }
        const message = err instanceof Error ? err.message : String(err);
        emitExecutionError({
            debug: input.debug,
            executionId,
            message,
            blueprintId,
            eventId: input.eventId,
            surfaceId: input.surfaceId,
        });
    } finally {
        execution?.finish();
    }
}

/**
 * The script event a broadcast reaches.
 *
 * Derived from the head rather than spelled out, so the two cannot drift. The fallback is
 * unreachable - `scriptEvents.test.ts` asserts every registered head maps to an event - and is here
 * only because the lookup is total over strings.
 */
const BROADCAST_SCRIPT_EVENT_ID: ScriptEventId =
    scriptEventIdOfHead(BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST) ?? "broadcast";

/** One script listening for a fanned-out event: the module's handler, and where it sits. */
type ScriptListener = {
    blueprint: Blueprint;
    handler: (...args: unknown[]) => unknown;
    /** Absent for the page's own script, which sits on the surface rather than in it. */
    elementId?: string;
};

/** Every script layer on an owner slot that exports a handler for this event. */
function resolveScriptListeners(
    blueprintDocument: BlueprintDocument,
    ownerKey: string,
    eventId: ScriptEventId,
): Array<{ blueprint: Blueprint; handler: (...args: unknown[]) => unknown }> {
    const blueprintId = blueprintDocument.ownerRecords[ownerKey]?.blueprintId;
    const blueprint = blueprintId ? blueprintDocument.blueprints[blueprintId] : undefined;
    return resolveScriptLayerHandlers(blueprint, eventId).map(({ handler }) => ({
        blueprint: blueprint as Blueprint,
        handler,
    }));
}

/**
 * Every script on this surface that listens for one fanned-out event - the page's own and each
 * element's.
 *
 * The script half of what `collectBroadcastTargets` and `collectElementEventTargets` answer for
 * graphs, and deliberately a second function rather than a branch inside those: what "listening"
 * means is not the same question for the two kinds of layer. A graph layer is scanned for a head
 * whose fields match this dispatch - which broadcast name, which target element - because a graph
 * cannot branch cheaply. A script layer exports one handler for the whole event and filters in a
 * line of the author's code (see the folds in `scriptEvents.ts`), so there is nothing to scan and
 * nothing to match: it listens if it exports.
 */
function collectSurfaceScriptListeners(input: {
    document: UIDocument;
    blueprintDocument: BlueprintDocument;
    surfaceId: string;
    eventId: ScriptEventId;
}): ScriptListener[] {
    const listeners: ScriptListener[] = [];
    listeners.push(...resolveScriptListeners(
        input.blueprintDocument,
        surfaceMainOwnerKey(input.surfaceId),
        input.eventId,
    ));
    for (const elementId of collectSurfaceElementIds(input.document, input.surfaceId)) {
        const element = input.document.elements[elementId];
        if (!getWidgetLogicApi(element?.type)?.supportsPrivateBlueprint) {
            continue;
        }
        for (const listener of resolveScriptListeners(
            input.blueprintDocument,
            widgetMainOwnerKey(input.surfaceId, elementId),
            input.eventId,
        )) {
            listeners.push({ ...listener, elementId });
        }
    }
    return listeners;
}

/**
 * Run a fanned-out event against every script that listens for it, in document order - an element's
 * script once in each of its drawings on screen (see {@link drawingsReachedBy}).
 */
async function runScriptListeners(input: {
    listeners: readonly ScriptListener[];
    document: UIDocument;
    blueprintDocument: BlueprintDocument;
    hostAdapter: UIHostAdapter;
    debug: DebugBridge;
    surfaceId: string;
    runtimeScopeId?: string;
    eventId: string;
    eventPayload?: Record<string, unknown>;
    executionManager?: BlueprintExecutionManager;
    allowClosedScopeExecution?: boolean;
}): Promise<void> {
    for (const listener of input.listeners) {
        for (const drawing of drawingsReachedBy(input.hostAdapter, listener.elementId)) {
            await runScriptBlueprintHandler({
                handler: listener.handler,
                blueprint: listener.blueprint,
                blueprintDocument: input.blueprintDocument,
                hostAdapter: input.hostAdapter,
                debug: input.debug,
                eventId: input.eventId,
                eventPayload: input.eventPayload,
                runtimeScopeId: input.runtimeScopeId,
                surfaceId: input.surfaceId,
                elementId: listener.elementId,
                ownerDrawingKey: listener.elementId
                    ? ownerDrawingKey(input.document, listener.elementId, drawing.instanceKey)
                    : undefined,
                instanceKey: drawing.instanceKey,
                executionManager: input.executionManager,
                allowClosedScopeExecution: input.allowClosedScopeExecution,
                self: scriptSelfOf({
                    surfaceId: input.surfaceId,
                    elementId: listener.elementId,
                    widgetType: listener.elementId
                        ? input.document.elements[listener.elementId]?.type
                        : undefined,
                    row: scriptRowOf(drawing.listItemScope),
                }),
            });
        }
    }
}

/** A dispatched list row, as a script sees it. Null when nothing drew this element per row. */
function scriptRowOf(listItemScope: UIListItemScope | null | undefined): ScriptListRow | null {
    return listItemScope
        ? {
              item: listItemScope.item,
              index: listItemScope.index,
              count: listItemScope.count,
              key: listItemScope.key,
              selected: listItemScope.selected,
          }
        : null;
}

function newExecutionId(): string {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `exec-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createScriptExecutionContext(input: {
    hostApi?: BlueprintHostApiRuntime;
    debug: DebugBridge;
    getSurfaceState: (key: string) => unknown;
    setSurfaceState: (key: string, value: unknown) => void;
    eventName?: string;
    eventPayload?: Record<string, unknown>;
    signal?: AbortSignal;
}): Record<string, unknown> {
    const api = input.hostApi;
    if (api) {
        return {
            event: input.eventPayload ?? {},
            eventName: input.eventName,
            runtime: {
                signal: input.signal,
                isCancelled: () => input.signal?.aborted === true,
                throwIfCancelled: () => throwIfBlueprintExecutionCancelled(input.signal),
            },
            host: {
                navigation: api.navigation,
                widget: api.widget,
                game: api.game,
                frame: api.frame,
                persistence: api.persistence,
                devtools: {
                    log: (msg: string) => {
                        api.devtools.log("info", truncateDebugEventMessage(String(msg)));
                    },
                },
            },
            state: {
                surface: {
                    get: (key: string) => api.state.get("surface", key),
                    set: (key: string, value: unknown) => {
                        api.state.set("surface", key, value);
                    },
                },
                global: {
                    get: (key: string) => api.state.get("global", key),
                    set: (key: string, value: unknown) => {
                        api.state.set("global", key, value);
                    },
                },
            },
        };
    }
    return {
        event: input.eventPayload ?? {},
        eventName: input.eventName,
        runtime: {
            signal: input.signal,
            isCancelled: () => input.signal?.aborted === true,
            throwIfCancelled: () => throwIfBlueprintExecutionCancelled(input.signal),
        },
        host: {
            devtools: {
                log: async (msg: string) => {
                    input.debug.emit({ type: "function.call", functionId: "devtools.log" });
                    const safeMessage = truncateDebugEventMessage(String(msg));
                    input.debug.emit({ type: "devtools.log", level: "info", message: safeMessage });
                    console.info(`[Blueprint] ${safeMessage}`);
                    input.debug.emit({ type: "function.return", functionId: "devtools.log" });
                },
            },
            navigation: {
                openSurface: async (_surfaceId: string, _props?: unknown) => {
                    input.debug.emit({ type: "function.call", functionId: "navigation.openSurface" });
                    input.debug.emit({ type: "function.return", functionId: "navigation.openSurface" });
                },
                getPageProps: () => {
                    input.debug.emit({ type: "function.call", functionId: "navigation.getPageProps" });
                    input.debug.emit({ type: "function.return", functionId: "navigation.getPageProps" });
                    return {};
                },
                pageBack: async () => {
                    input.debug.emit({ type: "function.call", functionId: "navigation.pageBack" });
                    input.debug.emit({ type: "function.return", functionId: "navigation.pageBack" });
                },
                clearPages: async () => {
                    input.debug.emit({ type: "function.call", functionId: "navigation.clearPages" });
                    input.debug.emit({ type: "function.return", functionId: "navigation.clearPages" });
                },
                clearGameOverlay: async () => {
                    input.debug.emit({ type: "function.call", functionId: "navigation.clearGameOverlay" });
                    input.debug.emit({ type: "function.return", functionId: "navigation.clearGameOverlay" });
                },
                quitApplication: async () => {
                    input.debug.emit({ type: "function.call", functionId: "navigation.quitApplication" });
                    input.debug.emit({ type: "function.return", functionId: "navigation.quitApplication" });
                },
                getFullscreen: async () => {
                    input.debug.emit({ type: "function.call", functionId: "navigation.getFullscreen" });
                    input.debug.emit({ type: "function.return", functionId: "navigation.getFullscreen" });
                    return false;
                },
                setFullscreen: async (_fullscreen: boolean) => {
                    input.debug.emit({ type: "function.call", functionId: "navigation.setFullscreen" });
                    input.debug.emit({ type: "function.return", functionId: "navigation.setFullscreen" });
                },
                getWindowScaleOptions: async () => {
                    input.debug.emit({ type: "function.call", functionId: "navigation.getWindowScaleOptions" });
                    input.debug.emit({ type: "function.return", functionId: "navigation.getWindowScaleOptions" });
                    return [];
                },
                getWindowScale: async () => {
                    input.debug.emit({ type: "function.call", functionId: "navigation.getWindowScale" });
                    input.debug.emit({ type: "function.return", functionId: "navigation.getWindowScale" });
                    return 1;
                },
                setWindowScale: async (_scale: number) => {
                    input.debug.emit({ type: "function.call", functionId: "navigation.setWindowScale" });
                    input.debug.emit({ type: "function.return", functionId: "navigation.setWindowScale" });
                },
                getWindowSize: async () => {
                    input.debug.emit({ type: "function.call", functionId: "navigation.getWindowSize" });
                    input.debug.emit({ type: "function.return", functionId: "navigation.getWindowSize" });
                    return { width: 0, height: 0 };
                },
                setWindowSize: async (_width: number, _height: number) => {
                    input.debug.emit({ type: "function.call", functionId: "navigation.setWindowSize" });
                    input.debug.emit({ type: "function.return", functionId: "navigation.setWindowSize" });
                },
            },
            game: {
                startStory: async (_request: { storyId: string; sceneId: string }) => {
                    input.debug.emit({ type: "function.call", functionId: "game.startStory" });
                    input.debug.emit({ type: "function.return", functionId: "game.startStory" });
                },
                isInGame: () => {
                    input.debug.emit({ type: "function.call", functionId: "game.isInGame" });
                    input.debug.emit({ type: "function.return", functionId: "game.isInGame" });
                    return false;
                },
                isGameOverlay: () => {
                    input.debug.emit({ type: "function.call", functionId: "game.isGameOverlay" });
                    input.debug.emit({ type: "function.return", functionId: "game.isGameOverlay" });
                    return false;
                },
                quit: async (_surfaceId: string) => {
                    input.debug.emit({ type: "function.call", functionId: "game.quit" });
                    input.debug.emit({ type: "function.return", functionId: "game.quit" });
                },
                writeSave: async (_id: string, _metadata?: unknown, _screenshot?: boolean) => {
                    input.debug.emit({ type: "function.call", functionId: "game.writeSave" });
                    input.debug.emit({ type: "function.return", functionId: "game.writeSave" });
                },
                loadSave: async (_id: string) => {
                    input.debug.emit({ type: "function.call", functionId: "game.loadSave" });
                    input.debug.emit({ type: "function.return", functionId: "game.loadSave" });
                },
                deleteSave: async (_id: string) => {
                    input.debug.emit({ type: "function.call", functionId: "game.deleteSave" });
                    input.debug.emit({ type: "function.return", functionId: "game.deleteSave" });
                },
                listSaveIds: async () => {
                    input.debug.emit({ type: "function.call", functionId: "game.listSaveIds" });
                    input.debug.emit({ type: "function.return", functionId: "game.listSaveIds" });
                    return [];
                },
                getSaveMetadata: async (_id: string) => {
                    input.debug.emit({ type: "function.call", functionId: "game.getSaveMetadata" });
                    input.debug.emit({ type: "function.return", functionId: "game.getSaveMetadata" });
                    return null;
                },
                getSaveTimes: async (_id: string) => {
                    input.debug.emit({ type: "function.call", functionId: "game.getSaveTimes" });
                    input.debug.emit({ type: "function.return", functionId: "game.getSaveTimes" });
                    return null;
                },
                getSaveLine: async (_id: string) => {
                    input.debug.emit({ type: "function.call", functionId: "game.getSaveLine" });
                    input.debug.emit({ type: "function.return", functionId: "game.getSaveLine" });
                    return null;
                },
                getSaveStory: async (_id: string) => {
                    input.debug.emit({ type: "function.call", functionId: "game.getSaveStory" });
                    input.debug.emit({ type: "function.return", functionId: "game.getSaveStory" });
                    return null;
                },
                captureRun: () => {
                    input.debug.emit({ type: "function.call", functionId: "game.captureRun" });
                    input.debug.emit({ type: "function.return", functionId: "game.captureRun" });
                    return null;
                },
                readSaveGame: async (_id: string) => {
                    input.debug.emit({ type: "function.call", functionId: "game.readSaveGame" });
                    input.debug.emit({ type: "function.return", functionId: "game.readSaveGame" });
                    return null;
                },
                getSavePreview: async (_id: string) => {
                    input.debug.emit({ type: "function.call", functionId: "game.getSavePreview" });
                    input.debug.emit({ type: "function.return", functionId: "game.getSavePreview" });
                    return null;
                },
                getHistory: async () => {
                    input.debug.emit({ type: "function.call", functionId: "game.getHistory" });
                    input.debug.emit({ type: "function.return", functionId: "game.getHistory" });
                    return [];
                },
                restoreHistory: async (_id?: string) => {
                    input.debug.emit({ type: "function.call", functionId: "game.restoreHistory" });
                    input.debug.emit({ type: "function.return", functionId: "game.restoreHistory" });
                },
                getNametag: () => {
                    input.debug.emit({ type: "function.call", functionId: "game.getNametag" });
                    input.debug.emit({ type: "function.return", functionId: "game.getNametag" });
                    return "";
                },
                getSpeakerColor: () => {
                    input.debug.emit({ type: "function.call", functionId: "game.getSpeakerColor" });
                    input.debug.emit({ type: "function.return", functionId: "game.getSpeakerColor" });
                    // Same default a real host answers with when nobody is speaking.
                    return { r: 255, g: 255, b: 255, a: 1 };
                },
                getCharacter: (_characterId: string) => {
                    input.debug.emit({ type: "function.call", functionId: "game.getCharacter" });
                    input.debug.emit({ type: "function.return", functionId: "game.getCharacter" });
                    return null;
                },
                next: async () => {
                    input.debug.emit({ type: "function.call", functionId: "game.next" });
                    input.debug.emit({ type: "function.return", functionId: "game.next" });
                },
                skip: async () => {
                    input.debug.emit({ type: "function.call", functionId: "game.skip" });
                    input.debug.emit({ type: "function.return", functionId: "game.skip" });
                },
                showDialog: async () => {
                    input.debug.emit({ type: "function.call", functionId: "game.showDialog" });
                    input.debug.emit({ type: "function.return", functionId: "game.showDialog" });
                },
                hideDialog: async () => {
                    input.debug.emit({ type: "function.call", functionId: "game.hideDialog" });
                    input.debug.emit({ type: "function.return", functionId: "game.hideDialog" });
                },
                toggleDialogDisplay: async () => {
                    input.debug.emit({ type: "function.call", functionId: "game.toggleDialogDisplay" });
                    input.debug.emit({ type: "function.return", functionId: "game.toggleDialogDisplay" });
                },
                setSentenceSpeed: async (_cps: number) => {
                    input.debug.emit({ type: "function.call", functionId: "game.setSentenceSpeed" });
                    input.debug.emit({ type: "function.return", functionId: "game.setSentenceSpeed" });
                },
                getPreference: (key: BlueprintGamePreferenceKey): BlueprintGamePreferenceValue => {
                    input.debug.emit({ type: "function.call", functionId: "game.getPreference" });
                    input.debug.emit({ type: "function.return", functionId: "game.getPreference" });
                    if (key === "autoForward" || key === "skip" || key === "skipping" || key === "showDialog") {
                        return false;
                    }
                    if (key === "voiceEndMode") {
                        return "stop";
                    }
                    return 0;
                },
                setPreference: async (_key: BlueprintGamePreferenceKey, _value: BlueprintGamePreferenceValue) => {
                    input.debug.emit({ type: "function.call", functionId: "game.setPreference" });
                    input.debug.emit({ type: "function.return", functionId: "game.setPreference" });
                },
            },
        },
        state: {
            surface: {
                get: (key: string) => {
                    input.debug.emit({ type: "state.read", scope: "surface", key });
                    return input.getSurfaceState(key);
                },
                set: (key: string, value: unknown) => {
                    input.setSurfaceState(key, value);
                    input.debug.emit({ type: "state.write", scope: "surface", key });
                },
            },
        },
    };
}

/**
 * Dispatch a widget UI event into its private blueprint event graph or TypeScript module.
 *
 * Resolves to whether a listener actually ran. The caller bubbles an event nothing listened to, so
 * this answer has to come from the dispatch itself rather than from a second reading of the document:
 * two spellings of "is anything listening here" would eventually disagree, and the event would then
 * be both handled and forwarded.
 */
export async function dispatchBlueprintUiEvent(options: {
    document: UIDocument;
    blueprintDocument: BlueprintDocument;
    persistentVariables: PersistentVariableRuntimeTable;
    surfaceId: string;
    runtimeScopeId?: string;
    elementId: string;
    eventName: string;
    hostAdapter: UIHostAdapter;
    debug: DebugBridge;
    getSurfaceState: (key: string) => unknown;
    setSurfaceState: (key: string, value: unknown) => void;
    eventPayload?: Record<string, unknown>;
    eventControl?: BehaviorGraphEventControl;
    listItemScope?: UIListItemScope | null;
    instanceKey?: string;
    componentId?: string;
    /** Resolved params of the component instance this dispatch came from; see UIHostAdapterElementEventOptions. */
    componentParams?: Record<string, string>;
    maxSteps?: number;
} & CancellableDispatchOptions): Promise<boolean> {
    const {
        document,
        blueprintDocument,
        surfaceId,
        runtimeScopeId,
        elementId,
        eventName,
        hostAdapter,
        debug,
        getSurfaceState,
        setSurfaceState,
        eventPayload,
        eventControl,
        listItemScope,
        instanceKey,
        componentId,
        componentParams,
    } = options;
    const el = readDispatchElement(document, elementId, componentId);
    if (!el || eventControl?.isPropagationStopped()) {
        return false;
    }
    const widgetLogicApi = getWidgetLogicApi(el.type);
    const widgetOwnerKey = widgetLogicApi?.supportsPrivateBlueprint
        ? componentId
            ? componentWidgetMainOwnerKey(componentId, elementId)
            : widgetMainOwnerKey(surfaceId, elementId)
        : undefined;
    const activeWidgetBlueprintId = widgetOwnerKey ? blueprintDocument.ownerRecords[widgetOwnerKey]?.blueprintId : undefined;
    const widgetPrivateEventSupported = Boolean(getWidgetLogicEvent(el.type, eventName));

    const blueprintId = widgetPrivateEventSupported ? activeWidgetBlueprintId : undefined;
    if (!blueprintId) {
        return false;
    }
    const bp = blueprintDocument.blueprints[blueprintId];
    if (!bp) {
        return false;
    }
    const variablesDrawingKey = ownerDrawingKey(document, elementId, instanceKey);
    // The script layers first, then the graph ones below. Both run: a layer answers an event or it
    // does not, and which of the two it is written in decides nothing about whether its siblings
    // also answer. This used to return here, because a slot was a script or a graph as a whole.
    const scriptEventId = scriptEventIdForWidgetSlot(el.type, eventName);
    let ranAnyScriptLayer = false;
    for (const { handler } of scriptEventId ? resolveScriptLayerHandlers(bp, scriptEventId) : []) {
        ranAnyScriptLayer = true;
        await runScriptBlueprintHandler({
            handler,
            blueprint: bp,
            blueprintDocument,
            hostAdapter,
            debug,
            eventId: eventName,
            eventPayload,
            runtimeScopeId,
            surfaceId,
            elementId,
            ownerDrawingKey: variablesDrawingKey,
            instanceKey,
            eventControl,
            executionManager: options.executionManager,
            allowClosedScopeExecution: options.allowClosedScopeExecution,
            self: scriptSelfOf({
                surfaceId,
                componentId,
                componentParams,
                elementId,
                widgetType: el?.type,
                row: scriptRowOf(listItemScope),
            }),
        });
        if (eventControl?.isPropagationStopped()) {
            return true;
        }
    }

    const widgetElementType = el?.type;
    const candidateGraphs = Object.values(bp.graphs.events ?? {});
    const matchingGraphs = candidateGraphs
        .map(eventGraph => {
            const ir = eventGraph.graph;
            const headIds = collectBlueprintEventHeadNodeIdsForDispatch(
                ir?.nodes,
                eventName,
                widgetElementType,
                eventPayload,
            );
            return headIds.length > 0 ? { eventGraph, ir, headIds } : null;
        })
        .filter((entry): entry is { eventGraph: NonNullable<typeof candidateGraphs[number]>; ir: NonNullable<typeof candidateGraphs[number]["graph"]>; headIds: string[] } => Boolean(entry));

    if (matchingGraphs.length === 0) {
        return ranAnyScriptLayer;
    }
    const executionId = newExecutionId();
    const execution = beginTrackedExecution({
        executionManager: options.executionManager,
        executionId,
        runtimeScopeId,
        blueprintId,
        eventId: eventName,
        allowClosedScopeExecution: options.allowClosedScopeExecution,
    });
    debug.emit({ type: "execution.started", executionId, blueprintId });

    const blueprintLocals = acquireBlueprintExecutionLocals({
        blueprintDocument,
        currentBlueprintId: blueprintId,
        surfaceId,
        runtimeScopeId,
        elementId,
        elementInstanceKey: variablesDrawingKey,
    });

    try {
        for (const { eventGraph, ir, headIds } of matchingGraphs) {
            const graph = adaptBlueprintGraphIr(ir, buildBlueprintRunGraphId("blueprintEvent", blueprintId, eventGraph.id));
            for (const headId of headIds) {
                const entry = { start: { nodeId: headId, port: "then" as const } };
                const startNode = graph.nodes[headId];
                if (!startNode || !isBlueprintEventDispatchHeadType(startNode.type)) {
                    continue;
                }
                await executeGraph({
                    graph,
                    entry,
                    hostAdapter,
                    blueprintLocals,
                    eventName,
                    eventPayload,
                    eventControl,
                    listItemScope,
                    instanceKey,
                    executionOwner: { surfaceId, elementId, blueprintId, componentId, componentParams },
                    persistentVariables: options.persistentVariables,
                    maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
                    signal: execution?.signal,
                    trace: {
                        executionId,
                        graphId: graph.id,
                        blueprintId,
                        eventId: eventName,
                        surfaceId,
                        emit: e => debug.emit(e),
                    },
                });
                if (eventControl?.isPropagationStopped()) {
                    break;
                }
            }
            if (eventControl?.isPropagationStopped()) {
                break;
            }
        }
        debug.emit({ type: "execution.finished", executionId, blueprintId });
    } catch (err) {
        if (isBlueprintGraphExecutionCancelledError(err)) {
            emitExecutionCancelled({
                debug,
                executionId,
                blueprintId,
                eventId: eventName,
                nodeId: err.nodeId,
                reason: err.message,
            });
            return true;
        }
        if (err instanceof BlueprintGraphExecutionError) {
            emitExecutionError({
                debug,
                executionId,
                message: err.message,
                blueprintId,
                eventId: eventName,
                nodeId: err.nodeId,
                stepLimit: stepLimitOfExecutionError(err),
                surfaceId,
            });
            return true;
        }
        const message = err instanceof Error ? err.message : String(err);
        emitExecutionError({ debug, executionId, message, blueprintId, eventId: eventName, surfaceId });
    } finally {
        execution?.finish();
    }
    // A listener that threw still listened: bubbling on error would turn one author's broken
    // handler into the parent's problem.
    return true;
}

function collectSurfaceElementIds(document: UIDocument, surfaceId: string): string[] {
    const surface = document.surfaces.find(s => s.id === surfaceId);
    const rootId = surface?.rootElementId;
    if (!rootId) {
        return [];
    }
    const out: string[] = [];
    const visit = (elementId: string) => {
        const el = document.elements[elementId];
        if (!el) {
            return;
        }
        out.push(elementId);
        for (const childId of el.childrenIds ?? []) {
            visit(childId);
        }
    };
    visit(rootId);
    return out;
}

function matchesElementEventTarget(
    node: { type: string; params?: Record<string, unknown> },
    target: BlueprintElementRef,
    nodeType: string,
): boolean {
    if (node.type !== nodeType) {
        return false;
    }
    const ref = readBlueprintElementRefParams(node.params);
    return Boolean(
        ref &&
        ref.surfaceId === target.surfaceId &&
        ref.elementId === target.elementId &&
        ref.elementType === target.elementType,
    );
}

function collectElementEventHeadNodeIds(
    nodes: Record<string, { type: string; params?: Record<string, unknown> }> | undefined,
    target: BlueprintElementRef,
    nodeType: string,
): string[] {
    const n = nodes ?? {};
    return Object.entries(n)
        .filter(([, node]) => matchesElementEventTarget(node, target, nodeType))
        .map(([id]) => id)
        .sort();
}

function collectElementEventTargets(input: {
    document: UIDocument;
    blueprintDocument: BlueprintDocument;
    surfaceId: string;
    target: BlueprintElementRef;
    nodeType: string;
}): Array<{
    elementId?: string;
    blueprintId: string;
    eventGraph: BlueprintLayer;
    ir: BlueprintGraphIr;
    headIds: string[];
}> {
    const out: Array<{
        elementId?: string;
        blueprintId: string;
        eventGraph: BlueprintLayer;
        ir: BlueprintGraphIr;
        headIds: string[];
    }> = [];

    const surfaceOwnerKey = surfaceMainOwnerKey(input.surfaceId);
    const surfaceBlueprintId = input.blueprintDocument.ownerRecords[surfaceOwnerKey]?.blueprintId;
    const surfaceBlueprint = surfaceBlueprintId ? input.blueprintDocument.blueprints[surfaceBlueprintId] : undefined;
    if (surfaceBlueprintId && surfaceBlueprint) {
        for (const eventGraph of Object.values(surfaceBlueprint.graphs.events ?? {})) {
            const ir = eventGraph.graph;
            const headIds = collectElementEventHeadNodeIds(ir?.nodes, input.target, input.nodeType);
            if (ir && headIds.length > 0) {
                out.push({ blueprintId: surfaceBlueprintId, eventGraph, ir, headIds });
            }
        }
    }

    for (const elementId of collectSurfaceElementIds(input.document, input.surfaceId)) {
        const el = input.document.elements[elementId];
        const widgetLogicApi = getWidgetLogicApi(el?.type);
        if (!widgetLogicApi?.supportsPrivateBlueprint) {
            continue;
        }
        const ownerKey = widgetMainOwnerKey(input.surfaceId, elementId);
        const blueprintId = input.blueprintDocument.ownerRecords[ownerKey]?.blueprintId;
        const bp = blueprintId ? input.blueprintDocument.blueprints[blueprintId] : undefined;
        if (!blueprintId || !bp) {
            continue;
        }
        for (const eventGraph of Object.values(bp.graphs.events ?? {})) {
            const ir = eventGraph.graph;
            const headIds = collectElementEventHeadNodeIds(ir?.nodes, input.target, input.nodeType);
            if (ir && headIds.length > 0) {
                out.push({ elementId, blueprintId, eventGraph, ir, headIds });
            }
        }
    }

    return out;
}

type ElementEventDispatchOptions = {
    document: UIDocument;
    blueprintDocument: BlueprintDocument;
    persistentVariables: PersistentVariableRuntimeTable;
    surfaceId: string;
    runtimeScopeId?: string;
    target: BlueprintElementRef;
    eventPayload?: Record<string, unknown>;
    hostAdapter: UIHostAdapter;
    debug: DebugBridge;
    getSurfaceState: (key: string) => unknown;
    setSurfaceState: (key: string, value: unknown) => void;
    maxSteps?: number;
    nodeType: string;
    eventId: string;
    graphIdPrefix: BlueprintRunGraphKind;
};

async function dispatchBlueprintElementEvent(options: ElementEventDispatchOptions & CancellableDispatchOptions): Promise<boolean> {
    const {
        document,
        blueprintDocument,
        surfaceId,
        runtimeScopeId,
        target,
        eventPayload,
        hostAdapter,
        debug,
        nodeType,
        eventId,
        graphIdPrefix,
    } = options;
    const payload = { ...(eventPayload ?? {}), element: target };
    const targets = collectElementEventTargets({ document, blueprintDocument, surfaceId, target, nodeType });
    // The two frontends listen for this the same way and differ only in how they say so; see
    // `collectSurfaceScriptListeners`. A script listener counts as handled for the same reason a
    // graph one does - something answered the event.
    const scriptEventId = scriptEventIdOfHead(nodeType);
    const scriptListeners = scriptEventId
        ? collectSurfaceScriptListeners({ document, blueprintDocument, surfaceId, eventId: scriptEventId })
        : [];
    const handled = targets.length > 0 || scriptListeners.length > 0;

    await runScriptListeners({
        listeners: scriptListeners,
        document,
        blueprintDocument,
        hostAdapter,
        debug,
        surfaceId,
        runtimeScopeId,
        eventId,
        eventPayload: payload,
        executionManager: options.executionManager,
        allowClosedScopeExecution: options.allowClosedScopeExecution,
    });

    for (const listener of targets) {
        await runFannedOutListener({
            document,
            blueprintDocument,
            persistentVariables: options.persistentVariables,
            hostAdapter,
            debug,
            surfaceId,
            runtimeScopeId,
            elementId: listener.elementId,
            blueprintId: listener.blueprintId,
            eventGraphId: listener.eventGraph.id,
            ir: listener.ir,
            headIds: listener.headIds,
            graphIdPrefix,
            eventId,
            eventPayload: payload,
            maxSteps: options.maxSteps,
            executionManager: options.executionManager,
            allowClosedScopeExecution: options.allowClosedScopeExecution,
        });
    }
    return handled;
}

/**
 * Run one listener's heads for a fanned-out event - once for a page's own blueprint, once in each
 * drawing on screen for an element's (see {@link drawingsReachedBy}).
 *
 * The one runner behind every fan-out that is not raised by a drawing - element click and flush
 * listeners, broadcasts, window events - so a drawing is threaded through all of them the same way:
 * its row and key into the graph, its key into the variable record, its placement into the owner.
 * They were three copies of this loop, and each ran as nobody.
 */
async function runFannedOutListener(input: {
    document: UIDocument;
    blueprintDocument: BlueprintDocument;
    persistentVariables: PersistentVariableRuntimeTable;
    hostAdapter: UIHostAdapter;
    debug: DebugBridge;
    surfaceId: string;
    runtimeScopeId?: string;
    /** The element whose blueprint listens; absent for the page's own blueprint. */
    elementId?: string;
    blueprintId: string;
    eventGraphId: string;
    ir: BlueprintGraphIr;
    headIds: readonly string[];
    graphIdPrefix: BlueprintRunGraphKind;
    /** What the run is traced under and the graph is told the event is. */
    eventId: string;
    eventPayload?: Record<string, unknown>;
    maxSteps?: number;
} & CancellableDispatchOptions): Promise<void> {
    const { document, blueprintDocument, hostAdapter, debug, surfaceId, runtimeScopeId, elementId, blueprintId, eventId } = input;
    for (const drawing of drawingsReachedBy(hostAdapter, elementId)) {
        const executionId = newExecutionId();
        const execution = beginTrackedExecution({
            executionManager: input.executionManager,
            executionId,
            runtimeScopeId,
            blueprintId,
            eventId,
            allowClosedScopeExecution: input.allowClosedScopeExecution,
        });
        debug.emit({ type: "execution.started", executionId, blueprintId });
        const blueprintLocals = acquireBlueprintExecutionLocals({
            blueprintDocument,
            currentBlueprintId: blueprintId,
            surfaceId,
            runtimeScopeId,
            elementId,
            elementInstanceKey: elementId ? ownerDrawingKey(document, elementId, drawing.instanceKey) : undefined,
        });
        try {
            for (const headId of input.headIds) {
                const graph = adaptBlueprintGraphIr(
                    input.ir,
                    buildBlueprintRunGraphId(input.graphIdPrefix, blueprintId, input.eventGraphId),
                );
                const startNode = graph.nodes[headId];
                if (!startNode || !isBlueprintEventDispatchHeadType(startNode.type)) {
                    continue;
                }
                await executeGraph({
                    graph,
                    entry: { start: { nodeId: headId, port: "then" as const } },
                    hostAdapter,
                    blueprintLocals,
                    eventName: eventId,
                    eventPayload: input.eventPayload,
                    listItemScope: drawing.listItemScope,
                    instanceKey: drawing.instanceKey,
                    executionOwner: {
                        surfaceId,
                        elementId,
                        blueprintId,
                        componentId: drawing.componentId,
                        componentParams: drawing.componentParams,
                    },
                    persistentVariables: input.persistentVariables,
                    maxSteps: input.maxSteps ?? DEFAULT_MAX_STEPS,
                    signal: execution?.signal,
                    trace: {
                        executionId,
                        graphId: graph.id,
                        blueprintId,
                        eventId,
                        surfaceId,
                        emit: e => debug.emit(e),
                    },
                });
            }
            debug.emit({ type: "execution.finished", executionId, blueprintId });
        } catch (err) {
            if (isBlueprintGraphExecutionCancelledError(err)) {
                emitExecutionCancelled({
                    debug,
                    executionId,
                    blueprintId,
                    eventId,
                    nodeId: err.nodeId,
                    reason: err.message,
                });
                continue;
            }
            if (err instanceof BlueprintGraphExecutionError) {
                emitExecutionError({
                    debug,
                    executionId,
                    message: err.message,
                    blueprintId,
                    eventId,
                    nodeId: err.nodeId,
                    surfaceId,
                    stepLimit: stepLimitOfExecutionError(err),
                });
                continue;
            }
            const message = err instanceof Error ? err.message : String(err);
            emitExecutionError({ debug, executionId, message, blueprintId, eventId, surfaceId });
        } finally {
            execution?.finish();
        }
    }
}

export async function dispatchBlueprintElementFlushEvent(options: {
    document: UIDocument;
    blueprintDocument: BlueprintDocument;
    persistentVariables: PersistentVariableRuntimeTable;
    surfaceId: string;
    runtimeScopeId?: string;
    target: BlueprintElementRef;
    eventPayload?: Record<string, unknown>;
    hostAdapter: UIHostAdapter;
    debug: DebugBridge;
    getSurfaceState: (key: string) => unknown;
    setSurfaceState: (key: string, value: unknown) => void;
    maxSteps?: number;
} & CancellableDispatchOptions): Promise<void> {
    await dispatchBlueprintElementEvent({
        ...options,
        nodeType: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH,
        eventId: "elementFlush",
        graphIdPrefix: "elementFlush",
    });
}

export async function dispatchBlueprintElementClickEvent(options: {
    document: UIDocument;
    blueprintDocument: BlueprintDocument;
    persistentVariables: PersistentVariableRuntimeTable;
    surfaceId: string;
    runtimeScopeId?: string;
    target: BlueprintElementRef;
    eventPayload?: Record<string, unknown>;
    hostAdapter: UIHostAdapter;
    debug: DebugBridge;
    getSurfaceState: (key: string) => unknown;
    setSurfaceState: (key: string, value: unknown) => void;
    maxSteps?: number;
} & CancellableDispatchOptions): Promise<boolean> {
    return dispatchBlueprintElementEvent({
        ...options,
        nodeType: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
        eventId: "elementClick",
        graphIdPrefix: "elementClick",
    });
}

function collectBroadcastHeadNodeIds(
    nodes: Record<string, { type: string; params?: Record<string, unknown> }> | undefined,
    eventName: string,
): string[] {
    const n = nodes ?? {};
    return Object.entries(n)
        .filter(([, node]) => {
            if (node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST) {
                return true;
            }
            if (node.type !== BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST) {
                return false;
            }
            return String(node.params?.event ?? "").trim() === eventName;
        })
        .map(([id]) => id)
        .sort();
}

function collectBroadcastTargets(input: {
    document: UIDocument;
    blueprintDocument: BlueprintDocument;
    surfaceId: string;
    eventName: string;
}): Array<{
    elementId?: string;
    blueprintId: string;
    bp: Blueprint;
    eventGraph: BlueprintLayer;
    ir: BlueprintGraphIr;
    headIds: string[];
}> {
    const out: Array<{
        elementId?: string;
        blueprintId: string;
        bp: Blueprint;
        eventGraph: BlueprintLayer;
        ir: BlueprintGraphIr;
        headIds: string[];
    }> = [];

    const surfaceOwnerKey = surfaceMainOwnerKey(input.surfaceId);
    const surfaceBlueprintId = input.blueprintDocument.ownerRecords[surfaceOwnerKey]?.blueprintId;
    const surfaceBlueprint = surfaceBlueprintId ? input.blueprintDocument.blueprints[surfaceBlueprintId] : undefined;
    if (surfaceBlueprintId && surfaceBlueprint) {
        for (const eventGraph of Object.values(surfaceBlueprint.graphs.events ?? {})) {
            const ir = eventGraph.graph;
            const headIds = collectBroadcastHeadNodeIds(ir?.nodes, input.eventName);
            if (ir && headIds.length > 0) {
                out.push({
                    blueprintId: surfaceBlueprintId,
                    bp: surfaceBlueprint,
                    eventGraph,
                    ir,
                    headIds,
                });
            }
        }
    }

    for (const elementId of collectSurfaceElementIds(input.document, input.surfaceId)) {
        const el = input.document.elements[elementId];
        const widgetLogicApi = getWidgetLogicApi(el?.type);
        if (!widgetLogicApi?.supportsPrivateBlueprint) {
            continue;
        }
        const ownerKey = widgetMainOwnerKey(input.surfaceId, elementId);
        const blueprintId = input.blueprintDocument.ownerRecords[ownerKey]?.blueprintId;
        const bp = blueprintId ? input.blueprintDocument.blueprints[blueprintId] : undefined;
        if (!blueprintId || !bp) {
            continue;
        }
        for (const eventGraph of Object.values(bp.graphs.events ?? {})) {
            const ir = eventGraph.graph;
            const headIds = collectBroadcastHeadNodeIds(ir?.nodes, input.eventName);
            if (ir && headIds.length > 0) {
                out.push({ elementId, blueprintId, bp, eventGraph, ir, headIds });
            }
        }
    }
    return out;
}

export function countBlueprintBroadcastListeners(options: {
    document: UIDocument;
    blueprintDocument: BlueprintDocument;
    surfaceId: string;
    eventName: string;
}): number {
    // Graph heads and script handlers both, because this backs `ctx.broadcast.listenerCount()` and
    // an author asking "is anyone listening" means anyone. Counting heads on one side and modules on
    // the other is right: a graph may subscribe to one broadcast several times, a module once.
    const scriptListeners = collectSurfaceScriptListeners({
        document: options.document,
        blueprintDocument: options.blueprintDocument,
        surfaceId: options.surfaceId,
        eventId: BROADCAST_SCRIPT_EVENT_ID,
    });
    return (
        collectBroadcastTargets(options).reduce((sum, target) => sum + target.headIds.length, 0) +
        scriptListeners.length
    );
}

/**
 * Fan an ambient event out to every widget blueprint on a surface that listens for it.
 *
 * Unlike broadcast this resolves heads through the widget logic API slot table
 * (`collectBlueprintEventHeadNodeIdsForDispatch`), so registering a new ambient event
 * in `widgetLogic.ts` is all it takes to route it here. Interaction events do NOT use
 * this path - they reach a single widget through DOM targeting instead.
 *
 * Targets come from the document, not the mounted React tree (same as broadcast), and
 * only cover the active surface - a hidden widget still hears it. A widget a list repeats
 * hears it once in each row on screen (`drawingsReachedBy`). A failing widget graph is
 * reported and skipped so one broken blueprint cannot stop the fan-out.
 */
export async function dispatchWidgetsBlueprintEvent(options: {
    document: UIDocument;
    blueprintDocument: BlueprintDocument;
    persistentVariables: PersistentVariableRuntimeTable;
    surfaceId: string;
    runtimeScopeId?: string;
    eventName: string;
    eventPayload?: Record<string, unknown>;
    hostAdapter: UIHostAdapter;
    debug: DebugBridge;
    getSurfaceState: (key: string) => unknown;
    setSurfaceState: (key: string, value: unknown) => void;
    maxSteps?: number;
} & CancellableDispatchOptions): Promise<void> {
    const {
        document,
        blueprintDocument,
        surfaceId,
        runtimeScopeId,
        eventName,
        eventPayload,
        hostAdapter,
        debug,
    } = options;

    for (const elementId of collectSurfaceElementIds(document, surfaceId)) {
        const element = document.elements[elementId];
        if (!getWidgetLogicApi(element?.type)?.supportsPrivateBlueprint) {
            continue;
        }
        const ownerKey = widgetMainOwnerKey(surfaceId, elementId);
        const blueprintId = blueprintDocument.ownerRecords[ownerKey]?.blueprintId;
        const bp = blueprintId ? blueprintDocument.blueprints[blueprintId] : undefined;
        if (!blueprintId || !bp) {
            continue;
        }
        // The slot table decides here too - it is what says this widget type raises this event at
        // all - and only the name it resolves to differs between the two kinds of layer.
        const scriptEventId = scriptEventIdForWidgetSlot(element?.type, eventName);
        await runScriptListeners({
            listeners: (scriptEventId ? resolveScriptLayerHandlers(bp, scriptEventId) : []).map(({ handler }) => ({
                blueprint: bp,
                handler,
                elementId,
            })),
            document,
            blueprintDocument,
            hostAdapter,
            debug,
            surfaceId,
            runtimeScopeId,
            eventId: eventName,
            eventPayload,
            executionManager: options.executionManager,
            allowClosedScopeExecution: options.allowClosedScopeExecution,
        });
        for (const eventGraph of Object.values(bp.graphs.events ?? {})) {
            const ir = eventGraph.graph;
            const headIds = collectBlueprintEventHeadNodeIdsForDispatch(
                ir?.nodes,
                eventName,
                element?.type,
                eventPayload,
            );
            if (!ir || headIds.length === 0) {
                continue;
            }
            await runFannedOutListener({
                document,
                blueprintDocument,
                persistentVariables: options.persistentVariables,
                hostAdapter,
                debug,
                surfaceId,
                runtimeScopeId,
                elementId,
                blueprintId,
                eventGraphId: eventGraph.id,
                ir,
                headIds,
                graphIdPrefix: "widgetEvent",
                eventId: eventName,
                eventPayload,
                maxSteps: options.maxSteps,
                executionManager: options.executionManager,
                allowClosedScopeExecution: options.allowClosedScopeExecution,
            });
        }
    }
}

export async function dispatchBlueprintBroadcastEvent(options: {
    document: UIDocument;
    blueprintDocument: BlueprintDocument;
    persistentVariables: PersistentVariableRuntimeTable;
    surfaceId: string;
    runtimeScopeId?: string;
    eventName: string;
    data: unknown;
    sender?: string;
    hostAdapter: UIHostAdapter;
    debug: DebugBridge;
    getSurfaceState: (key: string) => unknown;
    setSurfaceState: (key: string, value: unknown) => void;
    maxSteps?: number;
} & CancellableDispatchOptions): Promise<void> {
    const {
        document,
        blueprintDocument,
        surfaceId,
        runtimeScopeId,
        eventName,
        data,
        sender,
        hostAdapter,
        debug,
        getSurfaceState,
        setSurfaceState,
    } = options;
    const eventPayload = { event: eventName, data, sender: sender ?? "" };
    const targets = collectBroadcastTargets({ document, blueprintDocument, surfaceId, eventName });

    // A graph subscribes with a head that names the broadcast; a script exports `onBroadcast` and
    // reads the name off the payload. Both are subscriptions to the same fan-out.
    await runScriptListeners({
        listeners: collectSurfaceScriptListeners({
            document,
            blueprintDocument,
            surfaceId,
            eventId: BROADCAST_SCRIPT_EVENT_ID,
        }),
        document,
        blueprintDocument,
        hostAdapter,
        debug,
        surfaceId,
        runtimeScopeId,
        eventId: eventName,
        eventPayload,
        executionManager: options.executionManager,
        allowClosedScopeExecution: options.allowClosedScopeExecution,
    });

    // Each listening element once in every drawing of it on screen - a widget a list repeats hears
    // the broadcast in every row, each run reading and writing its own row. See `drawingsReachedBy`.
    for (const target of targets) {
        await runFannedOutListener({
            document,
            blueprintDocument,
            persistentVariables: options.persistentVariables,
            hostAdapter,
            debug,
            surfaceId,
            runtimeScopeId,
            elementId: target.elementId,
            blueprintId: target.blueprintId,
            eventGraphId: target.eventGraph.id,
            ir: target.ir,
            headIds: target.headIds,
            graphIdPrefix: "broadcastEvent",
            eventId: eventName,
            eventPayload,
            maxSteps: options.maxSteps,
            executionManager: options.executionManager,
            allowClosedScopeExecution: options.allowClosedScopeExecution,
        });
    }
}

// ---------------------------------------------------------------------------
// Fn invocation (Call Fn node)
// ---------------------------------------------------------------------------

/** Backstop against runaway fn recursion; the per-call maxSteps guard still applies. */
export const MAX_BLUEPRINT_FN_CALL_DEPTH = 32;

/**
 * Invoke a declared blueprint fn on behalf of a Call Fn node.
 * The fn body runs as part of the caller execution: the caller's abort signal and
 * executionId propagate, errors bubble to the caller, and the caller awaits completion.
 * Visibility is `isBlueprintFnVisibleToOwner`: globalMain fns everywhere, surfaceMain/widgetMain fns
 * only from their surface, and a component definition's fns only from inside that definition.
 */
export async function invokeBlueprintFnCall(options: {
    blueprintDocument: BlueprintDocument;
    persistentVariables: PersistentVariableRuntimeTable;
    surfaceId?: string;
    /** The component definition the calling execution belongs to, when it belongs to one. */
    callerComponentId?: string;
    /**
     * The calling instance's resolved params.
     *
     * Carried into the body rather than looked up, because a definition's fn can only be called
     * from inside that definition (see the visibility check below) - so the caller's placement IS
     * the body's placement, and it is the only thing that knows which one it is. Without this a
     * `Get Component Param` inside a fn reads nothing, and every element the fn touches is refused
     * as belonging to another surface.
     */
    callerComponentParams?: Record<string, string>;
    /**
     * Which drawing the call came from, carried into the body for the same reason as the params.
     *
     * Without it every widget the fn writes is addressed as the template rather than as this
     * placement, so the write lands where nothing reads it and the widget goes on showing what the
     * author typed - a failure that looks like the write never happened.
     */
    callerInstanceKey?: string;
    /**
     * The list row the call came from, carried into the body for the reason the instance key is:
     * a fn is a piece of the calling graph pulled out to be named, and a piece of an Item Click still
     * means the row that was pressed. Without it `Get Item Field` inside the body read nothing, so
     * moving three nodes out of Item Click into a fn quietly changed what they did.
     */
    callerListItemScope?: UIListItemScope | null;
    /**
     * The document the caller's drawing is described by, so the body's variables can be kept in the
     * drawing the fn's owner is in (see {@link ownerDrawingKey}). Absent for a caller outside any
     * drawing, which is also the one case where there is nothing to work out.
     */
    document?: UIDocument;
    runtimeScopeId?: string;
    fnRef: string;
    args: Record<string, unknown>;
    depth: number;
    signal?: AbortSignal;
    callerExecutionId?: string;
    hostAdapter: UIHostAdapter;
    debug: DebugBridge;
    maxSteps?: number;
    /**
     * The calling value binding's bookkeeping, when a binding is what called: the body's reads -
     * variables of its own blueprint, a persistent value, a saved one - are reads of the binding.
     */
    valueExecution?: BehaviorGraphValueTracking;
}): Promise<{ returns: Record<string, unknown> }> {
    const { blueprintDocument, surfaceId, runtimeScopeId, fnRef, args, depth, hostAdapter, debug } = options;

    // Plain errors: the GraphExecutor wraps them with the Call Fn node id in the caller graph.
    if (depth >= MAX_BLUEPRINT_FN_CALL_DEPTH) {
        throw new Error(`Fn call depth exceeded ${MAX_BLUEPRINT_FN_CALL_DEPTH} (recursive call?)`);
    }

    const decl = findBlueprintFnByRef(blueprintDocument, fnRef);
    if (!decl) {
        throw new Error(`Fn does not exist: ${fnRef}`);
    }
    // Asked of the shared predicate rather than restated here. It was restated here, and the copy
    // drifted the moment component definitions could declare a Fn: the editor offered the call and
    // the run refused it, which reads as a broken graph rather than as two rules disagreeing.
    //
    // The caller is named by what the running execution knows about itself - a component instance
    // knows its definition, everything else knows its surface. A caller with neither (a global
    // execution passes no surface) sees only global fns, which is what it saw before.
    const callerOwner: BlueprintOwnerRef = options.callerComponentId
        ? { kind: "componentWidgetMain", componentId: options.callerComponentId, elementId: "" }
        : { kind: "widgetMain", surfaceId: surfaceId ?? "", elementId: "" };
    if (!isBlueprintFnVisibleToOwner(decl.owner, callerOwner)) {
        throw new Error(`Fn "${decl.name}" is not available in this scope`);
    }

    const declElementId =
        decl.owner.kind === "widgetMain" || decl.owner.kind === "componentWidgetMain"
            ? decl.owner.elementId
            : undefined;
    const variableObserver = options.valueExecution
        ? { onRead: options.valueExecution.trackState, origin: options.valueExecution.stateOrigin }
        : undefined;
    const blueprintLocals = acquireBlueprintExecutionLocals(
        decl.owner.kind === "globalMain"
            ? { blueprintDocument, currentBlueprintId: decl.blueprintId, observer: variableObserver }
            : {
                  observer: variableObserver,
                  blueprintDocument,
                  currentBlueprintId: decl.blueprintId,
                  surfaceId,
                  runtimeScopeId,
                  elementId: declElementId,
                  // The owner's variables where its own events keep them: a fn on a list called
                  // from Item Click sees what Init set, and one on a card sees this placement's.
                  elementInstanceKey:
                      declElementId && options.document
                          ? ownerDrawingKey(options.document, declElementId, options.callerInstanceKey)
                          : undefined,
              },
    );
    // Seed declared parameter pins with caller args (bound by stable pinId; extras ignored).
    const seededArgs: Record<string, unknown> = {};
    for (const param of decl.params) {
        seededArgs[param.pinId] = args[param.pinId];
    }
    writeBlueprintNodeOutputValues(blueprintLocals, decl.headNodeId, seededArgs);

    const graph = adaptBlueprintGraphIr(decl.ir, buildBlueprintRunGraphId("fnCall", decl.blueprintId, decl.graphId));
    const executionOwner =
        decl.owner.kind === "globalMain"
            ? { blueprintId: decl.blueprintId }
            : {
                  surfaceId,
                  elementId: declElementId,
                  blueprintId: decl.blueprintId,
                  componentId: options.callerComponentId,
                  componentParams: options.callerComponentParams,
              };

    const result = await executeGraph({
        graph,
        entry: { start: { nodeId: decl.headNodeId, port: "then" as const } },
        hostAdapter,
        blueprintLocals,
        executionOwner,
        instanceKey: options.callerInstanceKey,
        listItemScope: options.callerListItemScope ?? null,
        persistentVariables: options.persistentVariables,
        maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
        signal: options.signal,
        fnCallDepth: depth + 1,
        valueExecution: options.valueExecution,
        trace: options.callerExecutionId
            ? {
                  executionId: options.callerExecutionId,
                  graphId: graph.id,
                  blueprintId: decl.blueprintId,
                  surfaceId,
                  emit: e => debug.emit(e),
              }
            : undefined,
    });

    const returns =
        result.returnValueSet && result.returnValue && typeof result.returnValue === "object" && !Array.isArray(result.returnValue)
            ? (result.returnValue as Record<string, unknown>)
            : {};
    return { returns };
}

// ---------------------------------------------------------------------------
// Surface lifecycle dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatch a lifecycle event into the surfaceMain blueprint for a given surface.
 * Used for events like "surfaceInit" that fire when a page is entered.
 */
export async function dispatchSurfaceBlueprintEvent(options: {
    blueprintDocument: BlueprintDocument;
    persistentVariables: PersistentVariableRuntimeTable;
    surfaceId: string;
    runtimeScopeId?: string;
    eventName: string;
    eventPayload?: Record<string, unknown>;
    eventControl?: BehaviorGraphEventControl;
    hostAdapter: UIHostAdapter;
    debug: DebugBridge;
    getSurfaceState: (key: string) => unknown;
    setSurfaceState: (key: string, value: unknown) => void;
    maxSteps?: number;
} & CancellableDispatchOptions): Promise<void> {
    const {
        blueprintDocument,
        surfaceId,
        runtimeScopeId,
        eventName,
        eventPayload,
        eventControl,
        hostAdapter,
        debug,
        getSurfaceState,
        setSurfaceState,
    } = options;

    if (eventControl?.isPropagationStopped()) {
        return;
    }

    const ownerKey = surfaceMainOwnerKey(surfaceId);
    const ownerRecord = blueprintDocument.ownerRecords[ownerKey];
    const blueprintId = ownerRecord?.blueprintId;
    if (!blueprintId) {
        return;
    }
    const bp = blueprintDocument.blueprints[blueprintId];
    if (!bp) {
        return;
    }

    const surfaceScriptEventId = scriptEventIdForSurfaceSlot(eventName);
    for (const { handler } of surfaceScriptEventId ? resolveScriptLayerHandlers(bp, surfaceScriptEventId) : []) {
        await runScriptBlueprintHandler({
            handler,
            blueprint: bp,
            blueprintDocument,
            hostAdapter,
            debug,
            eventId: eventName,
            eventPayload,
            runtimeScopeId,
            surfaceId,
            eventControl,
            executionManager: options.executionManager,
            allowClosedScopeExecution: options.allowClosedScopeExecution,
            self: scriptSelfOf({ surfaceId }),
        });
        if (eventControl?.isPropagationStopped()) {
            return;
        }
    }

    const candidateGraphs = Object.values(bp.graphs.events ?? {});
    const matchingGraphs = candidateGraphs
        .map(eventGraph => {
            const ir = eventGraph.graph;
            const headIds = collectSurfaceEventHeadNodeIdsForDispatch(ir?.nodes, eventName, eventPayload);
            return headIds.length > 0 ? { eventGraph, ir, headIds } : null;
        })
        .filter(
            (
                entry,
            ): entry is {
                eventGraph: NonNullable<(typeof candidateGraphs)[number]>;
                ir: NonNullable<(typeof candidateGraphs)[number]["graph"]>;
                headIds: string[];
            } => Boolean(entry),
        );

    if (matchingGraphs.length === 0) {
        return;
    }

    const executionId = newExecutionId();
    const execution = beginTrackedExecution({
        executionManager: options.executionManager,
        executionId,
        runtimeScopeId,
        blueprintId,
        eventId: eventName,
        allowClosedScopeExecution: options.allowClosedScopeExecution,
    });
    debug.emit({ type: "execution.started", executionId, blueprintId });
    const blueprintLocals = acquireBlueprintExecutionLocals({
        blueprintDocument,
        currentBlueprintId: blueprintId,
        surfaceId,
        runtimeScopeId,
    });

    try {
        for (const { eventGraph, ir, headIds } of matchingGraphs) {
            const graph = adaptBlueprintGraphIr(ir, buildBlueprintRunGraphId("surfaceEvent", blueprintId, eventGraph.id));
            for (const headId of headIds) {
                const entry = { start: { nodeId: headId, port: "then" as const } };
                const startNode = graph.nodes[headId];
                if (!startNode || !isBlueprintEventDispatchHeadType(startNode.type)) {
                    continue;
                }
                await executeGraph({
                    graph,
                    entry,
                    hostAdapter,
                    blueprintLocals,
                    eventName,
                    eventPayload: eventPayload ?? {},
                    eventControl,
                    executionOwner: { surfaceId, blueprintId },
                    persistentVariables: options.persistentVariables,
                    maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
                    signal: execution?.signal,
                    trace: {
                        executionId,
                        graphId: graph.id,
                        blueprintId,
                        eventId: eventName,
                        surfaceId,
                        emit: e => debug.emit(e),
                    },
                });
                if (eventControl?.isPropagationStopped()) {
                    break;
                }
            }
            if (eventControl?.isPropagationStopped()) {
                break;
            }
        }
        debug.emit({ type: "execution.finished", executionId, blueprintId });
    } catch (err) {
        if (isBlueprintGraphExecutionCancelledError(err)) {
            emitExecutionCancelled({
                debug,
                executionId,
                blueprintId,
                eventId: eventName,
                nodeId: err.nodeId,
                reason: err.message,
            });
            return;
        }
        if (err instanceof BlueprintGraphExecutionError) {
            emitExecutionError({
                debug,
                executionId,
                message: err.message,
                blueprintId,
                eventId: eventName,
                nodeId: err.nodeId,
                stepLimit: stepLimitOfExecutionError(err),
                surfaceId,
            });
            return;
        }
        const message = err instanceof Error ? err.message : String(err);
        emitExecutionError({ debug, executionId, message, blueprintId, eventId: eventName, surfaceId });
    } finally {
        execution?.finish();
    }
}

// ---------------------------------------------------------------------------
// Global lifecycle dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatch a lifecycle event into the globalMain blueprint.
 * Used for global lifecycle events such as "appBoot" and "gameReady".
 */
export async function dispatchGlobalBlueprintEvent(options: {
    blueprintDocument: BlueprintDocument;
    persistentVariables: PersistentVariableRuntimeTable;
    eventName: string;
    eventPayload?: Record<string, unknown>;
    eventControl?: BehaviorGraphEventControl;
    hostAdapter: UIHostAdapter;
    debug: DebugBridge;
    getSurfaceState: (key: string) => unknown;
    setSurfaceState: (key: string, value: unknown) => void;
    maxSteps?: number;
} & CancellableDispatchOptions): Promise<void> {
    const {
        blueprintDocument,
        eventName,
        eventPayload,
        eventControl,
        hostAdapter,
        debug,
        getSurfaceState,
        setSurfaceState,
    } = options;

    if (eventControl?.isPropagationStopped()) {
        return;
    }

    const ownerRecord = blueprintDocument.ownerRecords[GLOBAL_MAIN_OWNER_KEY];
    const blueprintId = ownerRecord?.blueprintId;
    if (!blueprintId) {
        return;
    }
    const bp = blueprintDocument.blueprints[blueprintId];
    if (!bp) {
        return;
    }

    const globalScriptEventId = scriptEventIdForProjectSlot(eventName);
    for (const { handler } of globalScriptEventId ? resolveScriptLayerHandlers(bp, globalScriptEventId) : []) {
        // The global blueprint belongs to no surface, so these run without a place: no `surfaceId`
        // goes to the runner, and their failures report without one.
        await runScriptBlueprintHandler({
            handler,
            blueprint: bp,
            blueprintDocument,
            hostAdapter,
            debug,
            eventId: eventName,
            eventPayload,
            eventControl,
            executionManager: options.executionManager,
            allowClosedScopeExecution: options.allowClosedScopeExecution,
            self: scriptSelfOf({}),
        });
        if (eventControl?.isPropagationStopped()) {
            return;
        }
    }

    const candidateGraphs = Object.values(bp.graphs.events ?? {});
    const matchingGraphs = candidateGraphs
        .map(eventGraph => {
            const ir = eventGraph.graph;
            const headIds = collectGlobalEventHeadNodeIdsForDispatch(ir?.nodes, eventName, eventPayload);
            return headIds.length > 0 ? { eventGraph, ir, headIds } : null;
        })
        .filter(
            (
                entry,
            ): entry is {
                eventGraph: NonNullable<(typeof candidateGraphs)[number]>;
                ir: NonNullable<(typeof candidateGraphs)[number]["graph"]>;
                headIds: string[];
            } => Boolean(entry),
        );

    if (matchingGraphs.length === 0) {
        return;
    }

    const executionId = newExecutionId();
    const execution = beginTrackedExecution({
        executionManager: options.executionManager,
        executionId,
        blueprintId,
        eventId: eventName,
        allowClosedScopeExecution: options.allowClosedScopeExecution,
    });
    debug.emit({ type: "execution.started", executionId, blueprintId });
    const blueprintLocals = acquireBlueprintExecutionLocals({
        blueprintDocument,
        currentBlueprintId: blueprintId,
    });

    try {
        for (const { eventGraph, ir, headIds } of matchingGraphs) {
            const graph = adaptBlueprintGraphIr(ir, buildBlueprintRunGraphId("globalEvent", blueprintId, eventGraph.id));
            for (const headId of headIds) {
                const entry = { start: { nodeId: headId, port: "then" as const } };
                const startNode = graph.nodes[headId];
                if (!startNode || !isBlueprintEventDispatchHeadType(startNode.type)) {
                    continue;
                }
                await executeGraph({
                    graph,
                    entry,
                    hostAdapter,
                    blueprintLocals,
                    eventName,
                    eventPayload: eventPayload ?? {},
                    eventControl,
                    executionOwner: { blueprintId },
                    persistentVariables: options.persistentVariables,
                    maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
                    signal: execution?.signal,
                    trace: {
                        executionId,
                        graphId: graph.id,
                        blueprintId,
                        eventId: eventName,
                        emit: e => debug.emit(e),
                    },
                });
                if (eventControl?.isPropagationStopped()) {
                    break;
                }
            }
            if (eventControl?.isPropagationStopped()) {
                break;
            }
        }
        debug.emit({ type: "execution.finished", executionId, blueprintId });
    } catch (err) {
        if (isBlueprintGraphExecutionCancelledError(err)) {
            emitExecutionCancelled({
                debug,
                executionId,
                blueprintId,
                eventId: eventName,
                nodeId: err.nodeId,
                reason: err.message,
            });
            return;
        }
        if (err instanceof BlueprintGraphExecutionError) {
            emitExecutionError({
                debug,
                executionId,
                message: err.message,
                blueprintId,
                eventId: eventName,
                nodeId: err.nodeId,
                stepLimit: stepLimitOfExecutionError(err),
            });
            return;
        }
        const message = err instanceof Error ? err.message : String(err);
        emitExecutionError({ debug, executionId, message, blueprintId, eventId: eventName });
    } finally {
        execution?.finish();
    }
}
