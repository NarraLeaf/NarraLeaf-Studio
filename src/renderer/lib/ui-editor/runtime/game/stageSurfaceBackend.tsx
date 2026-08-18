import { createRoot, type Root } from "react-dom/client";
import type { PuppetBackend, PuppetInstance, PuppetSize } from "narraleaf-react";
import type { UIDocument, UIStageSurface } from "@shared/types/ui-editor/document";
import {
    parseStageSurfaceSrc,
    readStageSurfaceMountOptions,
    STAGE_SURFACE_BACKEND_NAME,
} from "@shared/utils/stageSurfaceBackend";
import { EmbeddedStageSurface } from "@/lib/ui-editor/runtime/app/EmbeddedStageSurface";
import type { GameUiSlotHostOptions } from "@/lib/ui-editor/runtime/app/StageSlotSurfaceShell";

export { STAGE_SURFACE_BACKEND_NAME };

/**
 * Studio's own puppet backend: it draws a Game UI surface inside a stage element's box.
 *
 * The puppet seam exists so that a host can draw inside an element the engine owns, and that is
 * exactly what an element-mounted surface needs — which is why this feature costs the engine
 * nothing. `puppetBackendHost.ts` is the author-facing half of the same seam and stays what it is:
 * it finds renderers the author supplied and never names one. This half names no renderer either;
 * what it mounts is Studio's own React.
 *
 * Registered per game session, before the `Player` mounts, for the reason the author's backends
 * are: a puppet looks its backend up once, when its component mounts.
 */
export function createStageSurfaceBackend(input: {
    uidoc: UIDocument;
    slotHostOptions: GameUiSlotHostOptions;
    log?: (level: "info" | "warning" | "error", message: string) => void;
}): PuppetBackend {
    const { uidoc, slotHostOptions, log } = input;
    return {
        name: STAGE_SURFACE_BACKEND_NAME,
        mount(container: HTMLElement, ctx): PuppetInstance {
            const surfaceId = parseStageSurfaceSrc(ctx.src);
            const { objectName } = readStageSurfaceMountOptions(ctx.options);
            const surface = uidoc.surfaces.find(
                (item): item is UIStageSurface =>
                    item.id === surfaceId && item.kind === "stageSurface" && item.mount.kind === "element",
            );
            let root: Root | null = createRoot(container);

            if (!surface) {
                // A missing surface leaves an empty box rather than taking the stage down — the same
                // bargain the engine strikes for a missing backend.
                log?.("warning", `[${STAGE_SURFACE_BACKEND_NAME}] no element-mounted surface with id "${surfaceId ?? ctx.src}"`);
            }

            const draw = (size: PuppetSize) => {
                if (!root || !surface) {
                    return;
                }
                root.render(
                    <EmbeddedStageSurface
                        options={slotHostOptions}
                        surface={surface}
                        objectName={objectName ?? surface.id}
                        size={{ width: size.width, height: size.height }}
                    />,
                );
            };
            draw(ctx.size);

            return {
                ready: () => Promise.resolve(),
                // Nothing to apply yet: what a frame shows is decided by the widgets inside it,
                // which read the game themselves. The channel stays open for when a row addresses
                // the frame rather than the character.
                apply: () => undefined,
                command: () => undefined,
                resize: (size: PuppetSize) => draw(size),
                dispose: () => {
                    const disposing = root;
                    root = null;
                    // Deferred: the engine calls `dispose` inside the React commit that is removing
                    // this backend's own host element, and unmounting a root from inside a commit
                    // warns and can drop the unmount entirely.
                    queueMicrotask(() => disposing?.unmount());
                },
            };
        },
    };
}
