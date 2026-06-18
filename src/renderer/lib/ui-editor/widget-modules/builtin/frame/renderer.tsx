import type { CSSProperties, ReactElement } from "react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { getFrameProps } from "./helpers";

function FramePlaceholder({ label }: { label: string }): ReactElement {
    return (
        <div className="flex h-full w-full items-center justify-center border border-dashed border-white/20 bg-black/20 px-3 text-center text-xs text-gray-400">
            {label}
        </div>
    );
}

export function FrameRenderer(props: WidgetRendererProps): ReactElement {
    const { element, document, hostAdapter, renderSurface, instanceKey } = props;
    const frame = getFrameProps(element);
    const targetSurface = frame.targetSurfaceId
        ? document.surfaces.find(surface => surface.id === frame.targetSurfaceId)
        : null;

    if (!frame.targetSurfaceId) {
        return <FramePlaceholder label="Select a Page" />;
    }
    if (!targetSurface) {
        return <FramePlaceholder label="Missing Page" />;
    }
    if (targetSurface.kind !== "appSurface") {
        return <FramePlaceholder label="Target is not a Page" />;
    }
    if (!renderSurface) {
        return <FramePlaceholder label="Page preview unavailable" />;
    }

    const width = Math.max(1, Math.abs(element.layout.width));
    const height = Math.max(1, Math.abs(element.layout.height));
    // Fill the Page component instead of letterboxing. The element keeps target Page ratio by default,
    // but existing documents or manual layout edits can drift by subpixels and reveal white surface edges.
    const scale = Math.max(width / targetSurface.designSize.width, height / targetSurface.designSize.height);
    const scaledWidth = targetSurface.designSize.width * scale;
    const scaledHeight = targetSurface.designSize.height * scale;

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
        width: targetSurface.designSize.width,
        height: targetSurface.designSize.height,
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
