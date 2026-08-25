import type { UIComponentId, UIElement, UISurface } from "@shared/types/ui-editor/document";
import type { DevModeBundle } from "@shared/types/devMode";
import { isPointerPositionElementEvent } from "@shared/types/ui-editor/widgetLogic";
import { UI_SURFACE_INPUT_ACTION_EVENT } from "@shared/types/ui-editor/inputActionEvent";
import { isUIListItemInstanceKeyOf } from "@shared/types/ui-editor/list";
import { BLUEPRINT_HOST_API_CONTRACT_VERSION } from "@shared/types/blueprint/hostApi";
import type { UIHostAdapter, UIHostAdapterBlueprintRuntime, UIHostAdapterElementEventOptions } from "../types";
import {
    countBlueprintBroadcastListeners,
    dispatchBlueprintElementClickEvent,
    dispatchBlueprintElementFlushEvent,
    dispatchBlueprintBroadcastEvent,
    dispatchSurfaceBlueprintEvent,
    dispatchBlueprintUiEvent,
    invokeBlueprintFnCall,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import type { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import type { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import type { BlueprintHostApiRuntime } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import type { BlueprintExecutionManager } from "@/lib/ui-editor/blueprint-runtime/BlueprintExecutionManager";

const MAX_FLUSH_CASCADE_ROUNDS = 24;

export type DevModeBlueprintHostAdapterOptions = {
    bundle: DevModeBundle;
    surface: UISurface;
    runtimeScopeId?: string;
    scopeBridge: ScopeStoreBridge;
    debug: DebugBridge;
    hostApi: BlueprintHostApiRuntime;
    executionManager?: BlueprintExecutionManager;
};

/**
 * Build Dev Mode UIHostAdapter base + blueprintRuntime for widget event dispatch and graph execution.
 */
export function createDevModeBlueprintHostAdapter(options: DevModeBlueprintHostAdapterOptions): UIHostAdapter {
    const { bundle, surface, runtimeScopeId, scopeBridge, debug, hostApi, executionManager } = options;
    const effectiveRuntimeScopeId = runtimeScopeId ?? surface.id;
    const document = bundle.ui.uidoc;
    const blueprintDocument = bundle.ui.localBlueprints;
    const persistentVariables = bundle.ui.persistentVariables;
    const surfaceStore = scopeBridge.getSurfaceStore(effectiveRuntimeScopeId);
    type PendingFlush = {
        payload?: Record<string, unknown>;
        queuedDuringFlush: boolean;
        resolve: Array<() => void>;
    };
    const pendingFlushes = new Map<string, PendingFlush>();
    let flushDrainScheduled = false;
    let flushDraining = false;
    let flushCascadeRounds = 0;

    const readRuntimeElement = (elementId: string, componentId?: UIComponentId): UIElement | undefined => {
        if (componentId) {
            return document.components?.find(component => component.id === componentId)?.elements[elementId];
        }
        return document.elements[elementId];
    };

    const blueprintRuntime: UIHostAdapterBlueprintRuntime = {
        surfaceId: surface.id,
        runtimeScopeId: effectiveRuntimeScopeId,
        hostApi,
        setSurfaceState: (key, value) => {
            hostApi.state.set("surface", key, value);
        },
        getSurfaceState: key => surfaceStore.get(key),
        emitDebug: e => debug.emit(e),
        frame: {
            getParam: key => hostApi.frame.getParam(key),
            emit: (eventName, data) => hostApi.frame.emit(eventName, data),
        },
        dispatchElementBlueprintEvent: async () => {
            /* assigned after adapter */
        },
    };

    const adapter: UIHostAdapter = {
        host: surface.host,
        blueprintHostApiVersion: BLUEPRINT_HOST_API_CONTRACT_VERSION,
        blueprintRuntime,
    };

    /**
     * Run everything that listens for this event on exactly one element.
     *
     * Three listener kinds, all of which the element may have at once: the element's own private
     * blueprint (its `mouseClick` graph), the surface-wide `On Element Flush` heads that name it,
     * and the surface-wide `On Element Click` heads that name it.
     */
    const fireElementListeners = async (
        elementId: string,
        eventName: string,
        eventPayload?: Record<string, unknown>,
        eventOptions?: UIHostAdapterElementEventOptions,
    ): Promise<void> => {
        const flushedElement = eventName === "flush" ? readRuntimeElement(elementId, eventOptions?.componentId) : undefined;
        const clickedElement = eventName === "mouseClick" ? readRuntimeElement(elementId, eventOptions?.componentId) : undefined;
        await dispatchBlueprintUiEvent({
            document,
            blueprintDocument,
            persistentVariables,
            surfaceId: surface.id,
            runtimeScopeId: effectiveRuntimeScopeId,
            elementId,
            eventName,
            eventPayload,
            listItemScope: eventOptions?.listItemScope,
            instanceKey: eventOptions?.instanceKey,
            componentId: eventOptions?.componentId,
            componentParams: eventOptions?.componentParams,
            eventControl: eventOptions?.eventControl,
            hostAdapter: adapter,
            debug,
            getSurfaceState: key => scopeBridge.getSurfaceStore(effectiveRuntimeScopeId).get(key),
            setSurfaceState: (key, value) => {
                hostApi.state.set("surface", key, value);
            },
            executionManager,
            allowClosedScopeExecution: eventOptions?.allowClosedScopeExecution,
        });
        if (eventOptions?.eventControl?.isPropagationStopped()) {
            return;
        }
        if (eventName === "flush" && flushedElement) {
            const target = {
                surfaceId: surface.id,
                elementId,
                elementType: flushedElement.type,
            };
            await dispatchBlueprintElementFlushEvent({
                document,
                blueprintDocument,
                persistentVariables,
                surfaceId: surface.id,
                runtimeScopeId: effectiveRuntimeScopeId,
                target,
                eventPayload: eventPayload ?? { element: target },
                hostAdapter: adapter,
                debug,
                getSurfaceState: key => scopeBridge.getSurfaceStore(effectiveRuntimeScopeId).get(key),
                setSurfaceState: (key, value) => {
                    hostApi.state.set("surface", key, value);
                },
                executionManager,
            });
        }
        if (eventName === "mouseClick" && clickedElement) {
            const target = {
                surfaceId: surface.id,
                elementId,
                elementType: clickedElement.type,
            };
            await dispatchBlueprintElementClickEvent({
                document,
                blueprintDocument,
                persistentVariables,
                surfaceId: surface.id,
                runtimeScopeId: effectiveRuntimeScopeId,
                target,
                eventPayload: { ...(eventPayload ?? {}), element: target },
                hostAdapter: adapter,
                debug,
                getSurfaceState: key => scopeBridge.getSurfaceStore(effectiveRuntimeScopeId).get(key),
                setSurfaceState: (key, value) => {
                    hostApi.state.set("surface", key, value);
                },
                executionManager,
            });
        }
    };

    /**
     * Fire this event on the hit element and then on every ancestor up to the surface root.
     *
     * A head on an element says "I want this", not "I own this". Before, an element with a listener
     * kept the event and only a run of elements with none passed it along - so a decorative image
     * laid over a clickable panel was fine, but a panel that listened *and* sat inside a page that
     * also listened was not: the inner one silently took every click away from the outer, and the
     * only fix was for the author to notice and forward it by hand from each element in turn.
     *
     * Now every element in the chain that declares a head fires, innermost first, and one that
     * declares none is simply skipped. Innermost-first is the order the walk happens to run in and
     * not a promise: nothing in the interface offers to order two heads against each other, because
     * an author who needs one thing to happen after another has a graph to say so in.
     *
     * The propagation control still ends the walk. It is the DOM half of the same event, and it is
     * how something that really does own a pointer for the moment - a scroller mid-scroll, a drag in
     * progress - says so; "I am listening" never was that statement, which is the whole change here.
     */
    const dispatchElementBlueprintEventNow: UIHostAdapterBlueprintRuntime["dispatchElementBlueprintEvent"] = async (
        elementId,
        eventName,
        eventPayload,
        eventOptions,
    ) => {
        await fireElementListeners(elementId, eventName, eventPayload, eventOptions);
        if (!isPointerPositionElementEvent(eventName)) {
            return;
        }
        let currentId = elementId;
        let options = eventOptions;
        // The chain is bounded by the document tree, but a malformed `parentId` cycle would not be:
        // this runs on every click, so it ends at a visited element rather than hanging the renderer.
        const visited = new Set<string>([currentId]);
        while (!options?.eventControl?.isPropagationStopped()) {
            const parentId = readRuntimeElement(currentId, options?.componentId)?.parentId;
            if (!parentId || visited.has(parentId)) {
                return;
            }
            visited.add(parentId);
            options = leavingListRow(parentId, options);
            await fireElementListeners(parentId, eventName, eventPayload, options);
            currentId = parentId;
        }
    };

    /**
     * The row context an event leaves behind when it is handed past the list that made it.
     *
     * A row event carries the scope and the instance key of the row it started in, and everything
     * keyed by that key - runtime element state, and the blueprint variable record - belongs to that
     * row. Once the event reaches the list itself it is no longer inside any row, so carrying the key
     * further would hand an ancestor a private copy of its own variables, freshly defaulted, for as
     * long as the pointer happened to be over a row. That reads as an ancestor whose variables never
     * remember anything, which is not a failure any author could see the cause of.
     */
    const leavingListRow = (parentId: string, options: UIHostAdapterElementEventOptions | undefined): UIHostAdapterElementEventOptions | undefined => {
        if (!options || !isUIListItemInstanceKeyOf(options.instanceKey, parentId)) {
            return options;
        }
        const { listItemScope: _scope, instanceKey: _key, ...rest } = options;
        return rest;
    };

    const resolvePendingFlushes = (items: PendingFlush[]) => {
        for (const item of items) {
            for (const resolve of item.resolve) {
                resolve();
            }
        }
    };

    // Flush is an after-commit notification: property setters mark elements dirty,
    // then this queue drains one de-duplicated batch per frame. Flush handlers that
    // mutate more elements enqueue the next frame instead of re-entering synchronously.
    const scheduleFlushDrain = () => {
        if (flushDrainScheduled) {
            return;
        }
        flushDrainScheduled = true;
        const run = () => {
            flushDrainScheduled = false;
            void drainFlushQueue();
        };
        if (typeof globalThis.requestAnimationFrame === "function") {
            globalThis.requestAnimationFrame(run);
        } else {
            setTimeout(run, 0);
        }
    };

    const drainFlushQueue = async (): Promise<void> => {
        if (flushDraining) {
            scheduleFlushDrain();
            return;
        }
        if (pendingFlushes.size === 0) {
            flushCascadeRounds = 0;
            return;
        }

        const batch = [...pendingFlushes.entries()];
        pendingFlushes.clear();
        const hasExternalFlush = batch.some(([, item]) => !item.queuedDuringFlush);
        flushCascadeRounds = hasExternalFlush ? 1 : flushCascadeRounds + 1;

        if (flushCascadeRounds > MAX_FLUSH_CASCADE_ROUNDS) {
            const droppedItems = [...batch.map(([, item]) => item), ...pendingFlushes.values()];
            const elementIds = batch.map(([elementId]) => elementId).join(", ");
            pendingFlushes.clear();
            flushCascadeRounds = 0;
            debug.emit({
                type: "execution.error",
                executionId: `flush-cascade-${Date.now()}`,
                eventId: "flush",
                message: `Flush cascade exceeded ${MAX_FLUSH_CASCADE_ROUNDS} rounds; dropped pending element flush events: ${elementIds}`,
                surfaceId: surface.id,
            });
            resolvePendingFlushes(droppedItems);
            return;
        }

        flushDraining = true;
        try {
            for (const [elementId, item] of batch) {
                try {
                    await dispatchElementBlueprintEventNow(elementId, "flush", item.payload);
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    debug.emit({
                        type: "execution.error",
                        executionId: `flush-${Date.now()}`,
                        eventId: "flush",
                        message,
                        surfaceId: surface.id,
                    });
                } finally {
                    resolvePendingFlushes([item]);
                }
            }
        } finally {
            flushDraining = false;
            if (pendingFlushes.size > 0) {
                scheduleFlushDrain();
            } else {
                flushCascadeRounds = 0;
            }
        }
    };

    const enqueueElementFlush = (elementId: string, eventPayload?: Record<string, unknown>): Promise<void> => {
        const queuedDuringFlush = flushDraining;
        return new Promise(resolve => {
            const existing = pendingFlushes.get(elementId);
            if (existing) {
                existing.payload = eventPayload ?? existing.payload;
                existing.queuedDuringFlush = existing.queuedDuringFlush && queuedDuringFlush;
                existing.resolve.push(resolve);
            } else {
                pendingFlushes.set(elementId, {
                    payload: eventPayload,
                    queuedDuringFlush,
                    resolve: [resolve],
                });
            }
            scheduleFlushDrain();
        });
    };

    blueprintRuntime.dispatchElementBlueprintEvent = async (elementId, eventName, eventPayload, eventOptions) => {
        if (eventName === "flush") {
            await enqueueElementFlush(elementId, eventPayload);
            return;
        }
        await dispatchElementBlueprintEventNow(elementId, eventName, eventPayload, eventOptions);
    };

    /**
     * Hand this element's event to its structural parent on request.
     *
     * A pointer event already reaches every ancestor by itself now, so asking for one to be handed
     * up is asking for something that has already happened: dispatching it here would fire each
     * ancestor twice, once for the request and once for the walk that runs when this element's graph
     * finishes. So the request is answered - there was a parent, or there was not - without a second
     * dispatch.
     *
     * Events outside the bubbling set are unchanged. `mouseEnter` and the rest deliberately do not
     * travel on their own (an ancestor chain reported as hovered all at once is nobody's idea of
     * hover), so for those this really does forward.
     */
    blueprintRuntime.continueElementEventBubble = async (elementId, eventName, eventPayload, eventOptions) => {
        const current = readRuntimeElement(elementId, eventOptions?.componentId);
        const parentId = current?.parentId ?? null;
        if (!parentId) {
            return false;
        }
        if (isPointerPositionElementEvent(eventName)) {
            return true;
        }
        await blueprintRuntime.dispatchElementBlueprintEvent(parentId, eventName, eventPayload, eventOptions);
        return true;
    };

    blueprintRuntime.dispatchSurfaceBlueprintEvent = async (eventName, eventPayload) => {
        await dispatchSurfaceBlueprintEvent({
            blueprintDocument,
            persistentVariables,
            surfaceId: surface.id,
            runtimeScopeId: effectiveRuntimeScopeId,
            eventName,
            eventPayload,
            hostAdapter: adapter,
            debug,
            getSurfaceState: key => scopeBridge.getSurfaceStore(effectiveRuntimeScopeId).get(key),
            setSurfaceState: (key, value) => {
                hostApi.state.set("surface", key, value);
            },
            executionManager,
        });
    };

    /**
     * Raise one of this surface's declared actions on its surfaceMain blueprint.
     *
     * Deliberately the ordinary surface-event path under one reserved event name rather than a
     * channel of its own: an action head is then started, traced, cancelled and scoped by exactly
     * the code every other surface event already is, and the only thing new about it is the
     * `actionId` its head filters on.
     */
    blueprintRuntime.dispatchSurfaceInputAction = async payload => {
        await blueprintRuntime.dispatchSurfaceBlueprintEvent?.(UI_SURFACE_INPUT_ACTION_EVENT, { ...payload });
    };

    blueprintRuntime.dispatchBroadcastEvent = async (eventName, data, sender) => {
        await dispatchBlueprintBroadcastEvent({
            document,
            blueprintDocument,
            persistentVariables,
            surfaceId: surface.id,
            runtimeScopeId: effectiveRuntimeScopeId,
            eventName,
            data,
            sender,
            hostAdapter: adapter,
            debug,
            getSurfaceState: key => scopeBridge.getSurfaceStore(effectiveRuntimeScopeId).get(key),
            setSurfaceState: (key, value) => {
                hostApi.state.set("surface", key, value);
            },
            executionManager,
        });
    };

    blueprintRuntime.getBroadcastListenerCount = eventName =>
        countBlueprintBroadcastListeners({
            document,
            blueprintDocument,
            surfaceId: surface.id,
            eventName,
        });

    blueprintRuntime.invokeBlueprintFn = async input =>
        invokeBlueprintFnCall({
            blueprintDocument,
            persistentVariables,
            // Visibility follows the calling execution, not this adapter's surface
            // (global callers pass no surface and only see global fns).
            surfaceId: input.callerSurfaceId,
            callerComponentId: input.callerComponentId,
            callerComponentParams: input.callerComponentParams,
            callerInstanceKey: input.callerInstanceKey,
            runtimeScopeId: effectiveRuntimeScopeId,
            hostAdapter: adapter,
            debug,
            fnRef: input.fnRef,
            args: input.args,
            depth: input.depth,
            signal: input.signal,
            callerExecutionId: input.callerExecutionId,
        });

    return adapter;
}
