import type { UISurface } from "@shared/types/ui-editor/document";
import type { DevModeBundle } from "@shared/types/devMode";
import { BLUEPRINT_HOST_API_CONTRACT_VERSION } from "@shared/types/blueprint/hostApi";
import type { UIHostAdapter, UIHostAdapterBlueprintRuntime } from "../types";
import {
    countBlueprintBroadcastListeners,
    dispatchBlueprintElementFlushEvent,
    dispatchBlueprintBroadcastEvent,
    dispatchBlueprintUiEvent,
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

    const dispatchElementBlueprintEventNow: UIHostAdapterBlueprintRuntime["dispatchElementBlueprintEvent"] = async (
        elementId,
        eventName,
        eventPayload,
        eventOptions,
    ) => {
        const flushedElement = eventName === "flush" ? document.elements[elementId] : undefined;
        await dispatchBlueprintUiEvent({
            document,
            blueprintDocument,
            surfaceId: surface.id,
            runtimeScopeId: effectiveRuntimeScopeId,
            elementId,
            eventName,
            eventPayload,
            listItemScope: eventOptions?.listItemScope,
            instanceKey: eventOptions?.instanceKey,
            hostAdapter: adapter,
            debug,
            getSurfaceState: key => scopeBridge.getSurfaceStore(effectiveRuntimeScopeId).get(key),
            setSurfaceState: (key, value) => {
                hostApi.state.set("surface", key, value);
            },
            executionManager,
        });
        if (eventName === "flush" && flushedElement) {
            const target = {
                surfaceId: surface.id,
                elementId,
                elementType: flushedElement.type,
            };
            await dispatchBlueprintElementFlushEvent({
                document,
                blueprintDocument,
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

    blueprintRuntime.dispatchBroadcastEvent = async (eventName, data, sender) => {
        await dispatchBlueprintBroadcastEvent({
            document,
            blueprintDocument,
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

    return adapter;
}
