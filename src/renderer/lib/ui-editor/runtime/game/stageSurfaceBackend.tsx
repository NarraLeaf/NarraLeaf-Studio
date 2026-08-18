import { createRoot, type Root } from "react-dom/client";
import type { PuppetBackend, PuppetInstance, PuppetSize } from "narraleaf-react";
import type { UIDocument, UIStageSurface } from "@shared/types/ui-editor/document";
import { EmbeddedStageSurface } from "@/lib/ui-editor/runtime/app/EmbeddedStageSurface";
import type { GameUiSlotHostOptions } from "@/lib/ui-editor/runtime/app/StageSlotSurfaceShell";

/**
 * SPIKE (2026-08-17): Studio's own puppet backend, drawing a Game UI surface inside a stage element.
 *
 * The puppet seam is "the engine owns the box, the host draws inside it" — which is exactly what an
 * element-mounted surface needs, so this asks for no engine change at all. Which surface to draw
 * arrives through `options.surfaceId`, a value the engine forwards without reading.
 */
export const STAGE_SURFACE_BACKEND_NAME = "nl.surface";

export function createStageSurfaceBackend(input: {
    uidoc: UIDocument;
    slotHostOptions: GameUiSlotHostOptions;
    log?: (level: "info" | "warning" | "error", message: string) => void;
}): PuppetBackend {
    const { uidoc, slotHostOptions, log } = input;
    return {
        name: STAGE_SURFACE_BACKEND_NAME,
        mount(container: HTMLElement, ctx): PuppetInstance {
            const surfaceId = String((ctx.options as Record<string, unknown> | undefined)?.surfaceId ?? "");
            const surface = uidoc.surfaces.find(
                item => item.id === surfaceId && item.kind === "stageSurface",
            ) as UIStageSurface | undefined;
            let root: Root | null = createRoot(container);
            const draw = (size: PuppetSize) => {
                if (!root) {
                    return;
                }
                if (!surface) {
                    log?.("warning", `[nl.surface] no stage surface with id "${surfaceId}"`);
                    root.render(null);
                    return;
                }
                root.render(
                    <EmbeddedStageSurface
                        options={slotHostOptions}
                        surface={surface}
                        size={{ width: size.width, height: size.height }}
                    />,
                );
            };
            draw(ctx.size);
            return {
                ready: () => Promise.resolve(),
                apply: () => undefined,
                command: () => undefined,
                resize: (size: PuppetSize) => draw(size),
                dispose: () => {
                    const disposing = root;
                    root = null;
                    // Unmounting synchronously would land inside the React commit that is removing
                    // the puppet's own host element.
                    queueMicrotask(() => disposing?.unmount());
                },
            };
        },
    };
}
