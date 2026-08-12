import { useSyncExternalStore } from "react";
import type { LayerStackController, SurfaceLayerEntry } from "./LayerStackController";

/** Subscribe a React tree to a LayerStackController's stack. */
export function useLayerStack(controller: LayerStackController): readonly SurfaceLayerEntry[] {
    return useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
}
