import { memo, type ReactElement } from "react";
import { MotionConfig } from "motion/react";
import { useTranslation } from "@/lib/i18n";
import type { UIStageSlotId, UISurfaceId } from "@shared/types/ui-editor/document";
import type { UIHostAdapter, RenderSurfaceOptions } from "@/lib/ui-editor/runtime/types";
import type { GameUiReferenceLayer } from "@/lib/ui-editor/preview/gameUiReferenceLayers";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";

/**
 * How strongly another Game UI surface is drawn on the canvas. One value rather than a setting: the
 * reference has to read as a backdrop the author lines things up against, and the surface being
 * edited has to stay the one that reads as the work - over a busy dialogue box and over the empty
 * canvas alike.
 */
export const GAME_UI_REFERENCE_OPACITY = 0.4;

/** A reference never writes anywhere, so it is given no editor service to write through. */
const REFERENCE_HOST_ADAPTER: UIHostAdapter = { host: "player" };

type Props = {
    /** The workspace's bridge: it draws from the live document, so a rebuild picks up the latest. */
    runtimeBridge: { renderSurface(options: RenderSurfaceOptions): ReactElement | null };
    slotId: UIStageSlotId;
    surfaceId: UISurfaceId;
    /**
     * Moves only when the referenced surface's own content changed (`getSurfaceContentRevision`).
     * It is what lets an edit to the surface being edited leave the reference's tree alone: the
     * canvas around this redraws on every document change, and this does not.
     */
    contentRevision: number;
    /** `nlbrand:` colours resolve while the tree is built, so a palette edit is a reason to rebuild. */
    brandRevision: number;
};

/**
 * One other Game UI surface, drawn faintly where the game draws it.
 *
 * Mount inside the transformed canvas node, at its top-left: slot surfaces are drawn at one design
 * pixel each from the stage's top-left corner, so that is also where the surface being edited
 * starts. Whether it goes before or after the edited surface is the game's stacking order
 * (`planGameUiReferenceLayers`).
 *
 * Nothing on it can be reached. The tree is drawn without the editor's element chrome, so none of its
 * nodes carries an element id or the class the selection tools pick from; and the wrapper is
 * `inert`, which takes the whole subtree out of hit testing - `pointer-events: none` alone would not,
 * because every widget wrapper sets it back to `auto` on itself. A press over a reference element
 * lands on whatever is drawn beneath it, exactly as it would with the reference switched off.
 */
export const SurfaceReferenceLayer = memo(function SurfaceReferenceLayer({ runtimeBridge, slotId, surfaceId }: Props) {
    const rendered = runtimeBridge.renderSurface({
        surfaceId,
        hostAdapter: REFERENCE_HOST_ADAPTER,
        // What is drawn here is the game's own surface, so it keeps its motion like the canvas does.
        className: "nl-motion-keep",
        editorChrome: false,
    });
    if (!rendered) {
        return null;
    }
    return (
        <div
            data-surface-reference-layer={slotId}
            className="pointer-events-none absolute left-0 top-0 select-none"
            style={{ opacity: GAME_UI_REFERENCE_OPACITY }}
            inert
            aria-hidden="true"
        >
            {/* Its own widget state, so nothing the canvas records about hover or press reaches it. */}
            <WidgetRuntimeStateProvider>
                <MotionConfig reducedMotion="never">{rendered}</MotionConfig>
            </WidgetRuntimeStateProvider>
        </div>
    );
});

/**
 * Says which shown references are not the size of the surface being edited, in words.
 *
 * They are still drawn where the game draws them, so their contents sit right; it is their frames
 * that no longer agree with this one, and that is not something the canvas can show by itself.
 * Mount outside the zoomed canvas node, beside the screen preview readout.
 */
export function SurfaceReferenceLayersReadout({ layers }: { layers: readonly GameUiReferenceLayer[] }) {
    const { t } = useTranslation();
    const differing = layers.filter(layer => layer.sizeDiffers);
    if (differing.length === 0) {
        return null;
    }
    return (
        <div
            data-surface-reference-readout
            className="rounded-md border border-edge-strong bg-surface-canvas/80 px-2 py-1 text-2xs tabular-nums text-fg-muted"
        >
            {differing
                .map(layer =>
                    t("uiEditor.reference.sizeDiffers", {
                        name: layer.name,
                        width: layer.designSize.width,
                        height: layer.designSize.height,
                    }),
                )
                .join("  ·  ")}
        </div>
    );
}
