import { useCallback, useEffect, useState, type RefObject } from "react";
import {
    computeFitViewportTransform,
    resolveSurfaceFitInsets,
} from "@/lib/ui-editor/geometry";
import type { EditorStateService } from "@/apps/workspace/modules/ui-editor/editors/useSurfaceEditorTabModel";

export type UseSurfaceViewportAutoFitParams = {
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

/**
 * Opens an interface showing all of it, centred, and keeps it that way while the pane changes size.
 *
 * An interface is authored at its design size - 1920x1080 for a desktop game - and the canvas draws
 * it at that size. In an editing area smaller than that, the previous default of scale 1 at offset 0
 * put the interface's top left corner in the pane's top left corner and everything right of and
 * below the fold was simply not there, with nothing on screen to say so. So the editor computes the
 * fit itself on open, and re-computes it whenever the space it fitted into changes.
 *
 * The re-fit stops the moment the author zooms or pans: from then on the view is theirs, a resize
 * must not overrule it, and the fit is only reachable again through the tool bar button that returns
 * the callback below. Every editor tab shares one transform, so a tab also re-claims the viewport
 * when it becomes visible again - restoring the view it was left at, or fitting if it never had one.
 */
export function useSurfaceViewportAutoFit({
    stateService,
    surfaceId,
    designSize,
    viewportRef,
    active,
    enabled,
}: UseSurfaceViewportAutoFitParams): { fitToViewport: () => void } {
    const [outlineCollapsed, setOutlineCollapsed] = useState(
        () => stateService?.getOutlinePanelCollapsed() ?? false,
    );
    const [container, setContainer] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

    useEffect(() => {
        if (!stateService) {
            return undefined;
        }
        setOutlineCollapsed(stateService.getOutlinePanelCollapsed());
        return stateService.on("outlinePanelCollapsedChanged", setOutlineCollapsed);
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
    // callback below - and the effect that depends on it - run per revision.
    const designWidth = designSize?.width;
    const designHeight = designSize?.height;

    const fitToViewport = useCallback(() => {
        if (!stateService || !surfaceId || designWidth === undefined || designHeight === undefined) {
            return;
        }
        const transform = computeFitViewportTransform({
            container,
            designSize: { width: designWidth, height: designHeight },
            insets: resolveSurfaceFitInsets({ outlineCollapsed }),
        });
        if (!transform) {
            return;
        }
        stateService.applyFittedViewport(surfaceId, transform);
    }, [container, designWidth, designHeight, outlineCollapsed, stateService, surfaceId]);

    useEffect(() => {
        if (!enabled || !active || !stateService || !surfaceId) {
            return;
        }
        // A hidden tab measures 0x0, and a fit computed from that parks the canvas somewhere the
        // author has to hunt for once the tab is shown again.
        if (container.width <= 0 || container.height <= 0) {
            return;
        }
        if (stateService.getViewportSurfaceId() !== surfaceId) {
            // Opening, or returning to a tab that another interface has taken the viewport from.
            if (stateService.adoptSurfaceViewport(surfaceId)) {
                return;
            }
            fitToViewport();
            return;
        }
        if (stateService.isViewportAutoFitted()) {
            fitToViewport();
        }
    }, [active, container.width, container.height, enabled, fitToViewport, stateService, surfaceId]);

    return { fitToViewport };
}
