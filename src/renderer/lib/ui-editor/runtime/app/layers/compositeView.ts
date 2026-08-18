import type {
  GameAppCompositeLayer,
  GameAppCompositeQueuedLayer,
  GameAppCompositeSlot,
  GameAppCompositeView
} from "../GameAppHost";
import type { SurfaceLayerEntry } from "./LayerStackController";
import type { CompositeInputResolution } from "./compositeInput";

export type CompositeViewInput = {
  /** The entry the page lane is settling on, or null while it has none. */
  activePageEntry: { key: string; surfaceId: string } | null;
  /** The mounted stack, bottom to top. */
  layers: readonly SurfaceLayerEntry[];
  /** Layers waiting for an occupied group, in arrival order. */
  queued: readonly SurfaceLayerEntry[];
  /** The subset of {@link layers} the host actually put on screen this frame. */
  renderedLayerKeys: ReadonlySet<string>;
  /** The answer `resolveCompositeInput` already gave, passed through rather than recomputed. */
  resolution: CompositeInputResolution;
  /** True while a removed layer is still animating out. */
  exitPending: boolean;
  /** The surface's authored name, or null when the running bundle has no surface with that id. */
  surfaceName: (surfaceId: string) => string | null;
};

/**
 * Describe the composite stack for a reader.
 *
 * Takes the input resolution instead of deriving one. There is a single arbiter of who takes the
 * keys and who takes a click, and the whole point of a panel that reports it is to show what that
 * arbiter decided; a second derivation would agree right up until the frame someone needed it not
 * to.
 *
 * The one thing it does add is `onScreen`, which no other reader has: the stack holds layers the
 * render dropped for want of a surface, and "the controller says it is there and the screen does
 * not" is the difference this exists to make visible.
 */
export function buildCompositeView(input: CompositeViewInput): GameAppCompositeView {
  const page: GameAppCompositeSlot | null = input.activePageEntry
    ? {
        key: input.activePageEntry.key,
        surfaceId: input.activePageEntry.surfaceId,
        surfaceName: input.surfaceName(input.activePageEntry.surfaceId),
        interactive: input.resolution.interactiveKeys.has(input.activePageEntry.key),
        keyboardOwner: input.resolution.keyboardOwnerKey === input.activePageEntry.key
      }
    : null;

  const layers: GameAppCompositeLayer[] = input.layers.map((layer) => ({
    key: layer.key,
    surfaceId: layer.surfaceId,
    surfaceName: input.surfaceName(layer.surfaceId),
    interactive: input.resolution.interactiveKeys.has(layer.key),
    keyboardOwner: input.resolution.keyboardOwnerKey === layer.key,
    modal: layer.modal,
    dismissible: layer.dismissible,
    group: layer.group,
    ownerScopeId: layer.ownerScopeId,
    onScreen: input.renderedLayerKeys.has(layer.key)
  }));

  const queued: GameAppCompositeQueuedLayer[] = input.queued.map((layer) => ({
    key: layer.key,
    surfaceId: layer.surfaceId,
    surfaceName: input.surfaceName(layer.surfaceId),
    modal: layer.modal,
    group: layer.group,
    ownerScopeId: layer.ownerScopeId
  }));

  return { page, layers, queued, exitPending: input.exitPending };
}
