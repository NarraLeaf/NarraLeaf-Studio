import { useCallback, useEffect, useState, type RefObject } from "react";
import {
    SURFACE_ZOOM_MAX_SCALE,
    computeFitViewportTransform,
    computeZoomedViewportTransform,
    resolveSurfaceFitInsets,
    type SurfaceFitMode,
    type SurfaceViewportFit,
} from "@/lib/ui-editor/geometry";
import type { EditorStateService } from "@/apps/workspace/modules/ui-editor/editors/useSurfaceEditorTabModel";

export type UseSurfaceViewportZoomParams = {
    stateService: EditorStateService;
    /** The interface being edited; a component is edited through its own synthetic surface id. */
    surfaceId: string | undefined;
    /** Authored size of that interface - what the canvas node renders at scale 1. */
    designSize: { width: number; height: number } | undefined;
    /** The element the canvas is transformed inside of. */
    viewportRef: RefObject<HTMLElement | null>;
    /** Editor tabs share one viewport, so only the visible one may claim or revise it. */
    active: boolean;
    /** False while the tab is still rendering its "not found" state and has no canvas to measure. */
    enabled: boolean;
};

export type SurfaceViewportZoom = {
    /** The mode in force, or `null` once the author zoomed or panned by hand. */
    fit: SurfaceViewportFit | null;
    /** Applies a mode and keeps it live: it is recomputed whenever the editing area changes size. */
    applyFitMode: (mode: SurfaceFitMode) => void;
    /**
     * Zooms to `scale` about the middle of the editing area. A stated number, so it ends the mode
     * the same way a wheel gesture does.
     */
    setZoomScale: (scale: number) => void;
};

/**
 * The zoom model for one surface editor tab.
 *
 * An interface is authored at its design size - 1920x1080 for a desktop game - and the canvas draws
 * it at that size. In an editing area smaller than that, a plain scale of 1 at offset 0 puts the
 * interface's top left corner in the pane's top left corner and everything right of and below the
 * fold is simply not there, with nothing on screen to say so. So the editor computes a fit itself
 * on open, and re-computes it whenever the space it fitted into changes.
 *
 * A mode - fit, fill, width, actual size - is a standing answer rather than a one-off: pick one and
 * it keeps holding while the pane is resized or a panel is collapsed. Zooming, panning or typing a
 * percentage ends it, because from then on the view is a place the author chose and a resize must
 * not overrule it. Every editor tab shares one transform, so a tab also re-claims the viewport when
 * it becomes visible again - resuming the mode its interface was following, or restoring the view
 * it was left at.
 */
export function useSurfaceViewportZoom({
    stateService,
    surfaceId,
    designSize,
    viewportRef,
    active,
    enabled,
}: UseSurfaceViewportZoomParams): SurfaceViewportZoom {
    const [outlineCollapsed, setOutlineCollapsed] = useState(
        () => stateService?.getOutlinePanelCollapsed() ?? false,
    );
    const [container, setContainer] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
    const [fit, setFit] = useState<SurfaceViewportFit | null>(() => stateService?.getViewportFit() ?? null);

    useEffect(() => {
        if (!stateService) {
            return undefined;
        }
        setOutlineCollapsed(stateService.getOutlinePanelCollapsed());
        return stateService.on("outlinePanelCollapsedChanged", setOutlineCollapsed);
    }, [stateService]);

    // The mode is not its own event: every path that changes it also moves the transform, and the
    // one that does not - claiming the viewport for a tab being re-shown - is followed immediately
    // by a recompute here. Reading it back on `viewportChanged` therefore keeps the menu honest
    // about a wheel gesture having ended the mode, without a second subscription to maintain.
    useEffect(() => {
        if (!stateService) {
            return undefined;
        }
        setFit(stateService.getViewportFit());
        return stateService.on("viewportChanged", () => setFit(stateService.getViewportFit()));
    }, [stateService]);

    // `enabled` is in the deps because the canvas element only exists once the tab has an interface
    // to draw: a ref does not re-run an effect when it is filled in, but that flag flipping does.
    useEffect(() => {
        const element = viewportRef.current;
        if (!enabled || !element) {
            return undefined;
        }
        const read = () => {
            const rect = element.getBoundingClientRect();
            setContainer(previous =>
                Math.abs(previous.width - rect.width) < 0.5 && Math.abs(previous.height - rect.height) < 0.5
                    ? previous
                    : { width: rect.width, height: rect.height },
            );
        };
        read();
        const observer = new ResizeObserver(read);
        observer.observe(element);
        return () => observer.disconnect();
    }, [enabled, viewportRef]);

    // Read as numbers rather than carried as an object: the document hands back a fresh
    // `designSize` on every revision, and an identity that changes per revision would make the
    // callbacks below - and the effect that depends on them - run per revision.
    const designWidth = designSize?.width;
    const designHeight = designSize?.height;

    const applyFit = useCallback(
        (next: SurfaceViewportFit) => {
            if (!stateService || !surfaceId || designWidth === undefined || designHeight === undefined) {
                return;
            }
            const transform = computeFitViewportTransform({
                container,
                designSize: { width: designWidth, height: designHeight },
                insets: resolveSurfaceFitInsets({ outlineCollapsed }),
                mode: next.mode,
                // A mode the author picked does what it says; only the fit nobody asked for keeps
                // the magnification ceiling. See SURFACE_FIT_MAX_SCALE.
                maxScale: next.chosen ? SURFACE_ZOOM_MAX_SCALE : undefined,
            });
            if (!transform) {
                return;
            }
            stateService.applyFittedViewport(surfaceId, transform, next);
            setFit(next);
        },
        [container, designWidth, designHeight, outlineCollapsed, stateService, surfaceId],
    );

    const applyFitMode = useCallback(
        (mode: SurfaceFitMode) => applyFit({ mode, chosen: true }),
        [applyFit],
    );

    const setZoomScale = useCallback(
        (scale: number) => {
            if (!stateService) {
                return;
            }
            const transform = computeZoomedViewportTransform({
                current: stateService.getViewportTransform(),
                container,
                insets: resolveSurfaceFitInsets({ outlineCollapsed }),
                nextScale: scale,
            });
            if (!transform) {
                return;
            }
            stateService.updateViewport(transform);
            setFit(null);
        },
        [container, outlineCollapsed, stateService],
    );

    useEffect(() => {
        if (!enabled || !active || !stateService || !surfaceId) {
            return;
        }
        // A hidden tab measures 0x0, and a zoom computed from that parks the canvas somewhere the
        // author has to hunt for once the tab is shown again.
        if (container.width <= 0 || container.height <= 0) {
            return;
        }
        if (stateService.getViewportSurfaceId() !== surfaceId) {
            // Opening, or returning to a tab that another interface has taken the viewport from.
            const adopted = stateService.adoptSurfaceViewport(surfaceId);
            if (adopted) {
                applyFit(adopted);
            }
            return;
        }
        const current = stateService.getViewportFit();
        if (current) {
            applyFit(current);
        }
    }, [active, applyFit, container.width, container.height, enabled, stateService, surfaceId]);

    return { fit, applyFitMode, setZoomScale };
}
