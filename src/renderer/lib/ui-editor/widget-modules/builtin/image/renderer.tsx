import type { CSSProperties } from "react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { getImageProps } from "./helpers";

const objectFitMap: Record<string, CSSProperties["objectFit"]> = {
    cover: "cover",
    contain: "contain",
    fill: "fill",
};

export function ImageRenderer({ element, children }: WidgetRendererProps) {
    const p = getImageProps(element);
    const { url: assetUrl } = useAssetObjectUrl(p.assetId?.trim() ? p.assetId : null);
    const displayUrl = assetUrl || (p.imageUrl?.trim() ? p.imageUrl.trim() : null);
    const opacity = Math.max(0, Math.min(1, p.imageOpacity));

    const shell: CSSProperties = {
        width: "100%",
        height: "100%",
        position: "relative",
        borderRadius: p.borderRadius,
        overflow: "hidden",
        boxSizing: "border-box",
    };

    const fit = objectFitMap[p.objectFit] ?? "cover";

    return (
        <div style={shell}>
            {displayUrl ? (
                <img
                    src={displayUrl}
                    alt=""
                    draggable={false}
                    style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: fit,
                        opacity,
                        pointerEvents: "none",
                    }}
                />
            ) : (
                <div
                    className="flex items-center justify-center w-full h-full text-[11px] text-white/40 border border-dashed border-white/25 bg-white/[0.03]"
                    style={{ borderRadius: p.borderRadius }}
                >
                    No image
                </div>
            )}
            {children}
        </div>
    );
}
