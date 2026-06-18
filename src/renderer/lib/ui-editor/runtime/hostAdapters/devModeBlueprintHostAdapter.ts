import type { UISurface } from "@shared/types/ui-editor/document";
import type { DevModeBundle } from "@shared/types/devMode";
import { BLUEPRINT_HOST_API_CONTRACT_VERSION } from "@shared/types/blueprint/hostApi";
import type { UIHostAdapter, UIHostAdapterBlueprintRuntime } from "../types";
import {
    countBlueprintBroadcastListeners,
    dispatchBlueprintBroadcastEvent,
    dispatchBlueprintUiEvent,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import type { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import type { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import type { BlueprintHostApiRuntime } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";

export type DevModeBlueprintHostAdapterOptions = {
    bundle: DevModeBundle;
    surface: UISurface;
    runtimeScopeId?: string;
    scopeBridge: ScopeStoreBridge;
    debug: DebugBridge;
    hostApi: BlueprintHostApiRuntime;
};

/**
 * Build Dev Mode UIHostAdapter base + blueprintRuntime for widget event dispatch and graph execution.
 */
export function createDevModeBlueprintHostAdapter(options: DevModeBlueprintHostAdapterOptions): UIHostAdapter {
    const { bundle, surface, runtimeScopeId, scopeBridge, debug, hostApi } = options;
    const effectiveRuntimeScopeId = runtimeScopeId ?? surface.id;
    const document = bundle.ui.uidoc;
    const blueprintDocument = bundle.ui.localBlueprints;
    const surfaceStore = scopeBridge.getSurfaceStore(effectiveRuntimeScopeId);

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

    blueprintRuntime.dispatchElementBlueprintEvent = async (elementId, eventName, eventPayload) => {
        await dispatchBlueprintUiEvent({
            document,
            blueprintDocument,
            surfaceId: surface.id,
            runtimeScopeId: effectiveRuntimeScopeId,
            elementId,
            eventName,
            eventPayload,
            hostAdapter: adapter,
            debug,
            getSurfaceState: key => scopeBridge.getSurfaceStore(effectiveRuntimeScopeId).get(key),
            setSurfaceState: (key, value) => {
                hostApi.state.set("surface", key, value);
            },
        });
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
