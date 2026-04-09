import type { CSSProperties } from "react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { RectangleChromeRenderer } from "@/lib/ui-editor/widget-modules/shared/chrome/RectangleChromeRenderer";
import {
    resolveContainerAppearanceTransitions,
    resolveContainerRectangleLike,
} from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import {
    useWidgetRuntimeElementState,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { useEditorAppearanceInspectorVariant } from "@/lib/ui-editor/hooks/useEditorAppearanceInspectorVariant";
import { getContainerProps } from "./helpers";
import {
    resolveContainerScrollViewportOverflow,
    type ContainerStackAlignItems,
    type ContainerStackJustifyContent,
} from "@shared/types/ui-editor/container";

function mapAlign(v: ContainerStackAlignItems): CSSProperties["alignItems"] {
    switch (v) {
        case "start":
            return "flex-start";
        case "end":
            return "flex-end";
        case "center":
            return "center";
        case "stretch":
        default:
            return "stretch";
    }
}

function mapJustify(v: ContainerStackJustifyContent): CSSProperties["justifyContent"] {
    switch (v) {
        case "start":
            return "flex-start";
        case "end":
            return "flex-end";
        case "center":
            return "center";
        case "space-between":
            return "space-between";
        case "space-around":
            return "space-around";
        default:
            return "flex-start";
    }
}

function StackInner({ element, children }: WidgetRendererProps) {
    const p = getContainerProps(element);
    const style: CSSProperties = {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        position: "relative",
        display: "flex",
        flexDirection: p.stackDirection === "horizontal" ? "row" : "column",
        gap: p.stackGap,
        paddingTop: p.stackPaddingTop,
        paddingRight: p.stackPaddingRight,
        paddingBottom: p.stackPaddingBottom,
        paddingLeft: p.stackPaddingLeft,
        alignItems: mapAlign(p.stackAlignItems),
        justifyContent: mapJustify(p.stackJustifyContent),
        overflow: "visible",
    };
    return <div style={style}>{children}</div>;
}

function ScrollInner({ element, children }: WidgetRendererProps) {
    const p = getContainerProps(element);
    const innerDir = p.stackDirection === "horizontal" ? "row" : "column";
    const flexStyle: CSSProperties = {
        display: "flex",
        flexDirection: innerDir,
        flexWrap: "nowrap",
        alignItems: "stretch",
        justifyContent: "flex-start",
        gap: p.stackGap,
        paddingTop: p.stackPaddingTop,
        paddingRight: p.stackPaddingRight,
        paddingBottom: p.stackPaddingBottom,
        paddingLeft: p.stackPaddingLeft,
        minWidth: innerDir === "column" ? "100%" : undefined,
        minHeight: innerDir === "row" ? "100%" : undefined,
    };
    const scrollOverflow = resolveContainerScrollViewportOverflow(p.scrollAxis);
    const viewport: CSSProperties = {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        position: "relative",
        overflowX: scrollOverflow.overflowX,
        overflowY: scrollOverflow.overflowY,
    };
    return (
        <div style={viewport}>
            <div style={flexStyle}>{children}</div>
        </div>
    );
}

export function ContainerRenderer(props: WidgetRendererProps) {
    const { element, children, useAppearanceInspectorPreview } = props;
    const inspectorVariantId = useEditorAppearanceInspectorVariant(element.id, useAppearanceInspectorPreview === true);
    const p = getContainerProps(element);
    const runtimeState = useWidgetRuntimeElementState(element.id);
    const clip = p.clipContent;
    const resolveCtx = {
        variantOverrideId: runtimeState.variantOverrideId ?? inspectorVariantId ?? null,
        signals: runtimeState.signals,
    };
    const rectangleLike = resolveContainerRectangleLike(element, p.appearance ?? undefined, resolveCtx);
    const appearanceTransitions = resolveContainerAppearanceTransitions(p.appearance ?? undefined, resolveCtx);

    // Free layout: keep absolute children OUTSIDE appearance transform (scale/rotate on chrome).
    // Otherwise layout x/y are in unscaled space but the containing block is scaled — parent drags look "proportional".
    // Host stays overflow: visible so chrome box-shadow / filter are not clipped; when clipContent is on, only the
    // children layer clips (same bounds as the host).
    if (p.layoutKind === "free") {
        const hostStyle: CSSProperties = {
            position: "relative",
            width: "100%",
            height: "100%",
            boxSizing: "border-box",
            overflow: "visible",
        };
        const chromeLayerStyle: CSSProperties = {
            position: "absolute",
            inset: 0,
            zIndex: 0,
            pointerEvents: "none",
        };
        const childrenLayerStyle: CSSProperties = {
            position: "absolute",
            inset: 0,
            zIndex: 1,
            pointerEvents: "auto",
            overflow: clip ? "hidden" : "visible",
        };
        return (
            <div style={hostStyle}>
                <div style={chromeLayerStyle}>
                    <RectangleChromeRenderer
                        {...props}
                        clipContent={false}
                        rectangleLike={rectangleLike}
                        appearanceTransitions={appearanceTransitions}
                    >
                        {null}
                    </RectangleChromeRenderer>
                </div>
                <div style={childrenLayerStyle}>{children}</div>
            </div>
        );
    }

    // Stack: flex inner uses overflow visible; optional clip is only on RectangleChromeRenderer.
    // Scroll: single-axis viewport overflow is owned by ScrollInner (see resolveContainerScrollViewportOverflow);
    // clipContent still clips the outer chrome + viewport stack to the container box when true.
    const inner = p.layoutKind === "scroll" ? <ScrollInner {...props} /> : <StackInner {...props} />;

    return (
        <RectangleChromeRenderer
            {...props}
            clipContent={clip}
            rectangleLike={rectangleLike}
            appearanceTransitions={appearanceTransitions}
        >
            {inner}
        </RectangleChromeRenderer>
    );
}
