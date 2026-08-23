/**
 * The zoom the graph canvas is at, and every way to change it deliberately.
 *
 * It sits in the canvas toolbar and is built out of the surface editor's own toolbar parts, so the
 * two canvases offer zoom as the same control rather than as two that merely do the same thing.
 * The vocabulary matches too - actual size, fit, fill, fit width, and a box for an exact
 * percentage. What differs is that here the modes are one-shot actions rather than standing modes:
 * a graph's bounding box changes on every node drag, so a mode that stayed live would re-frame the
 * canvas mid-gesture. Nothing is ever checked in the menu for the same reason.
 *
 * Comments in English per project convention.
 */

import { useCallback, useEffect, useState } from "react";
import { useReactFlow, useStore, useStoreApi } from "@xyflow/react";
import { ChevronDown } from "lucide-react";
import { Input } from "@/lib/components/elements/Input";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n/catalog/types";
import { CANVAS_FIT_MODES, formatZoomPercent, parseZoomPercent, type CanvasFitMode } from "@/lib/ui-editor/geometry";
import {
    SurfaceEditorToolbarButtonGroup,
    SurfaceEditorToolbarSegButton,
} from "@/apps/workspace/modules/ui-editor/editors/SurfaceEditorToolbarButtonGroup";
import {
    SurfaceToolbarPopoverPanel,
    SurfaceToolbarPopoverRow,
    SurfaceToolbarPopoverSection,
    useSurfaceToolbarPopover,
} from "@/apps/workspace/modules/ui-editor/editors/SurfaceEditorToolbarPopover";
import { boundsOfMeasuredNodes, clampBlueprintZoom, computeBlueprintZoomViewport } from "../blueprintZoom";

const FIT_MODE_LABEL_KEYS = {
    actual: "blueprint.zoom.actualSize",
    contain: "blueprint.zoom.fitArea",
    cover: "blueprint.zoom.fillArea",
    width: "blueprint.zoom.fitWidth",
} as const satisfies Record<CanvasFitMode, TranslationKey>;

export function BlueprintZoomMenu() {
    const { t } = useTranslation();
    const { zoomTo, setViewport } = useReactFlow();
    // Read at click time rather than subscribed: what a mode needs - the pane, the zoom limits and
    // every node's measured size - is a snapshot of the store, and subscribing to it would re-render
    // this control on every pointer move over the canvas.
    const store = useStoreApi();

    // The one thing it does subscribe to, because the readout has to follow the canvas live.
    const zoom = useStore(state => state.transform[2]);

    const percent = formatZoomPercent(zoom);
    const popover = useSurfaceToolbarPopover(percent);
    const [draft, setDraft] = useState(String(percent));

    // The box shows where the canvas actually is whenever the menu is opened, and follows it while
    // open - a mode clicked above it must not leave a stale number below.
    useEffect(() => {
        if (popover.open) {
            setDraft(String(percent));
        }
    }, [percent, popover.open]);

    const applyMode = useCallback(
        (mode: CanvasFitMode) => {
            const { nodeLookup, width, height, minZoom, maxZoom } = store.getState();
            const bounds = boundsOfMeasuredNodes(
                [...nodeLookup.values()].map(node => ({
                    x: node.internals.positionAbsolute.x,
                    y: node.internals.positionAbsolute.y,
                    width: node.measured.width ?? 0,
                    height: node.measured.height ?? 0,
                })),
            );
            const next = computeBlueprintZoomViewport({
                mode,
                bounds,
                container: { width, height },
                range: { min: minZoom, max: maxZoom },
            });
            if (next) {
                setViewport(next, { duration: 220 });
            }
            popover.close();
        },
        [popover, setViewport, store],
    );

    /**
     * `close` only on Enter. Blur must not close the menu, and must not apply anything either when
     * the box still reads where the canvas already is: clicking a mode row blurs the box first, and
     * a commit there would move the canvas and dismiss the panel before the row was ever hit.
     */
    const commitDraft = useCallback(
        (close: boolean) => {
            const { minZoom, maxZoom } = store.getState();
            const range = { min: minZoom, max: maxZoom };
            const parsed = parseZoomPercent(draft, range);
            if (parsed === null || formatZoomPercent(parsed) === percent) {
                setDraft(String(percent));
            } else {
                // Zooms about the middle of the pane, which is what the author is looking at.
                zoomTo(clampBlueprintZoom(parsed, range), { duration: 180 });
            }
            if (close) {
                popover.close();
            }
        },
        [draft, percent, popover, store, zoomTo],
    );

    return (
        <>
            <SurfaceEditorToolbarButtonGroup aria-label={t("blueprint.zoom.label")}>
                {/* The percentage is the one-click way back to seeing the whole graph, which is what
                    an author wants from it nine times out of ten; the chevron opens the rest. */}
                <SurfaceEditorToolbarSegButton
                    onClick={() => applyMode("contain")}
                    className="w-auto min-w-14 px-2 tabular-nums"
                    data-tip={t("blueprint.zoom.fitArea")}
                    aria-label={t("blueprint.zoom.fitArea")}
                >
                    {percent}%
                </SurfaceEditorToolbarSegButton>
                <SurfaceEditorToolbarSegButton
                    ref={popover.triggerRef}
                    active={popover.open}
                    onClick={popover.toggle}
                    data-tip={t("blueprint.zoom.label")}
                    aria-label={t("blueprint.zoom.label")}
                    aria-expanded={popover.open}
                    aria-haspopup="dialog"
                >
                    <ChevronDown className="h-4 w-4" />
                </SurfaceEditorToolbarSegButton>
            </SurfaceEditorToolbarButtonGroup>
            <SurfaceToolbarPopoverPanel popover={popover} dataAttribute="blueprint-zoom">
                {CANVAS_FIT_MODES.map(mode => (
                    <SurfaceToolbarPopoverRow
                        key={mode}
                        label={t(FIT_MODE_LABEL_KEYS[mode])}
                        shortcut={mode === "actual" ? "100%" : undefined}
                        onClick={() => applyMode(mode)}
                    />
                ))}
                <SurfaceToolbarPopoverSection label={t("blueprint.zoom.custom")}>
                    <div className="flex items-center gap-1.5 px-3 pb-1 pt-0.5">
                        <div className="min-w-0 flex-1">
                            <Input
                                size="sm"
                                fullWidth
                                inputMode="decimal"
                                className="tabular-nums"
                                aria-label={t("blueprint.zoom.custom")}
                                value={draft}
                                onChange={event => setDraft(event.target.value)}
                                onKeyDown={event => {
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        commitDraft(true);
                                    }
                                }}
                                onBlur={() => commitDraft(false)}
                            />
                        </div>
                        <span className="shrink-0 text-xs text-fg-subtle">%</span>
                    </div>
                </SurfaceToolbarPopoverSection>
            </SurfaceToolbarPopoverPanel>
        </>
    );
}
