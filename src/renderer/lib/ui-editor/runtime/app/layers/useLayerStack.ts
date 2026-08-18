import { useSyncExternalStore } from "react";
import type { LayerStackController, LayerStackSnapshot } from "./LayerStackController";

/**
 * Subscribe a React tree to a LayerStackController.
 *
 * The whole snapshot rather than the mounted layers alone: a layer joining the queue and an exit
 * animation finishing both change what the stack is doing without changing what is on screen, and
 * the composite-stack panel exists to show exactly those two.
 */
export function useLayerStack(controller: LayerStackController): LayerStackSnapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}
