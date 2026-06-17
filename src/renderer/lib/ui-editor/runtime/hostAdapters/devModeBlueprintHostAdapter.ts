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
    scopeBridge: ScopeStoreBridge;
    debug: DebugBridge;
    hostApi: BlueprintHostApiRuntime;
};

/**
 * Build Dev Mode UIHostAdapter base + blueprintRuntime for widget event dispatch and graph execution.
 */
export function createDevModeBlueprintHostAdapter(options: DevModeBlueprintHostAdapterOptions): UIHostAdapter {
    const { bundle, surface, scopeBridge, debug, hostApi } = options;
    const document = bundle.ui.uidoc;
    const blueprintDocument = bundle.ui.localBlueprints;
    const surfaceStore = scopeBridge.getSurfaceStore(surface.id);

    const blueprintRuntime: UIHostAdapterBlueprintRuntime = {
        surfaceId: surface.id,
        hostApi,
        setSurfaceState: (key, value) => {
            hostApi.state.set("surface", key, value);
        },
        getSurfaceState: key => surfaceStore.get(key),
        emitDebug: e => debug.emit(e),
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
            elementId,
            eventName,
            eventPayload,
            hostAdapter: adapter,
            debug,
            getSurfaceState: key => scopeBridge.getSurfaceStore(surface.id).get(key),
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
            eventName,
            data,
            sender,
            hostAdapter: adapter,
            debug,
            getSurfaceState: key => scopeBridge.getSurfaceStore(surface.id).get(key),
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
