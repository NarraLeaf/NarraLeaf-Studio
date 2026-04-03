import type { UISurface } from "@shared/types/ui-editor/document";
import type { DevModeBundle } from "@shared/types/devMode";
import type { UIHostAdapter, UIHostAdapterBlueprintRuntime } from "../types";
import { dispatchBlueprintUiEvent } from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import type { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import type { SurfaceStateStore } from "@/lib/ui-editor/blueprint-runtime/SurfaceStateStore";

export type DevModeBlueprintHostAdapterOptions = {
    bundle: DevModeBundle;
    surface: UISurface;
    surfaceState: SurfaceStateStore;
    debug: DebugBridge;
};

/**
 * Build Dev Mode UIHostAdapter base + blueprintRuntime for widget event dispatch and graph execution.
 */
export function createDevModeBlueprintHostAdapter(options: DevModeBlueprintHostAdapterOptions): UIHostAdapter {
    const { bundle, surface, surfaceState, debug } = options;
    const document = bundle.ui.uidoc;
    const blueprintDocument = bundle.ui.localBlueprints;

    const blueprintRuntime: UIHostAdapterBlueprintRuntime = {
        surfaceId: surface.id,
        setSurfaceState: (key, value) => {
            surfaceState.set(key, value);
            debug.emit({ type: "state.write", scope: "surface", key });
        },
        getSurfaceState: key => surfaceState.get(key),
        emitDebug: e => debug.emit(e),
        dispatchElementBlueprintEvent: async () => {
            /* assigned after adapter */
        },
    };

    const adapter: UIHostAdapter = {
        host: surface.host,
        effects: {
            runEffect: () => {},
        },
        blueprintRuntime,
    };

    blueprintRuntime.dispatchElementBlueprintEvent = async (elementId, eventName) => {
        await dispatchBlueprintUiEvent({
            document,
            blueprintDocument,
            surfaceId: surface.id,
            elementId,
            eventName,
            hostAdapter: adapter,
            debug,
        });
    };

    return adapter;
}
