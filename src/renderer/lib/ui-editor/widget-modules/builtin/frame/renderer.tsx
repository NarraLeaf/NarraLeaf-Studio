import { useRef, type CSSProperties, type ReactElement } from "react";
import { useTranslation } from "@/lib/i18n";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { getFrameProps } from "./helpers";

function FramePlaceholder({ label }: { label: string }): ReactElement {
    return (
        <div className="flex h-full w-full items-center justify-center border border-dashed border-edge-strong bg-fill-subtle px-3 text-center text-xs text-fg-muted">
            {label}
        </div>
    );
}

export function FrameRenderer(props: WidgetRendererProps): ReactElement | null {
    const { t } = useTranslation();
    const { element, document, hostAdapter, renderSurface, instanceKey } = props;
    const frame = getFrameProps(element);
    const targetSurface = frame.targetSurfaceId
        ? document.surfaces.find(surface => surface.id === frame.targetSurfaceId)
        : null;
    const lastPageSurfaceRef = useRef(targetSurface?.kind === "appSurface" ? targetSurface : null);
    const shouldRenderClearingSurface = !frame.targetSurfaceId && Boolean(hostAdapter.blueprintRuntime && renderSurface);

    if (targetSurface?.kind === "appSurface") {
        lastPageSurfaceRef.current = targetSurface;
    }

    if (!frame.targetSurfaceId && !shouldRenderClearingSurface) {
        return null;
    }
    if (frame.targetSurfaceId && !targetSurface) {
        return <FramePlaceholder label={t("widgets.frame.missingPage")} />;
    }
    if (targetSurface && targetSurface.kind !== "appSurface") {
        return <FramePlaceholder label={t("widgets.frame.targetNotPage")} />;
    }
    if (!renderSurface) {
        return <FramePlaceholder label={t("widgets.frame.previewUnavailable")} />;
    }

    const layoutSurface = targetSurface ?? lastPageSurfaceRef.current;
    const width = Math.max(1, Math.abs(element.layout.width));
    const height = Math.max(1, Math.abs(element.layout.height));
    if (!layoutSurface) {
        return (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    overflow: "hidden",
                    position: "relative",
                    background: "transparent",
                }}
            >
                {renderSurface({
                    targetSurfaceId: null,
                    frameElement: element,
                    params: frame.params,
                    instanceKey,
                })}
            </div>
        );
    }

    // Fill the Page component instead of letterboxing. The element keeps target Page ratio by default,
    // but existing documents or manual layout edits can drift by subpixels and reveal white surface edges.
    const scale = Math.max(width / layoutSurface.designSize.width, height / layoutSurface.designSize.height);
    const scaledWidth = layoutSurface.designSize.width * scale;
    const scaledHeight = layoutSurface.designSize.height * scale;

    const viewportStyle: CSSProperties = {
        width: "100%",
        height: "100%",
        overflow: "hidden",
        position: "relative",
        background: "transparent",
    };
    const surfaceStyle: CSSProperties = {
        position: "absolute",
        left: (width - scaledWidth) / 2,
        top: (height - scaledHeight) / 2,
        width: layoutSurface.designSize.width,
        height: layoutSurface.designSize.height,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        pointerEvents: hostAdapter.blueprintRuntime ? "auto" : "none",
    };

    return (
        <div style={viewportStyle}>
            <div style={surfaceStyle}>
                {renderSurface({
                    targetSurfaceId: frame.targetSurfaceId,
                    frameElement: element,
                    params: frame.params,
                    instanceKey,
                })}
            </div>
        </div>
    );
}
