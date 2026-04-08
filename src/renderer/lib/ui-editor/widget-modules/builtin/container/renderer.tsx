import type { CSSProperties } from "react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { RectangleChromeRenderer } from "@/lib/ui-editor/widget-modules/shared/chrome/RectangleChromeRenderer";
import {
    resolveContainerAppearanceTransitions,
    resolveContainerRectangleLike,
} from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import {
    useWidgetRuntimeSnapshot,
    useWidgetRuntimeStateStore,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { useEditorAppearanceInspectorVariant } from "@/lib/ui-editor/hooks/useEditorAppearanceInspectorVariant";
import { DEFAULT_SYSTEM_INTERACTION_SIGNALS } from "@/lib/ui-editor/runtime/appearance/SystemInteractionState";
import { getContainerProps } from "./helpers";
import type {
    ContainerStackAlignItems,
    ContainerStackJustifyContent,
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
    const isY = p.scrollAxis === "y";
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
    const viewport: CSSProperties = {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        position: "relative",
        overflowX: isY ? "hidden" : "auto",
        overflowY: isY ? "auto" : "hidden",
    };
    return (
        <div style={viewport}>
            <div style={flexStyle}>{children}</div>
        </div>
    );
}

export function ContainerRenderer(props: WidgetRendererProps) {
    const { element, children, useAppearanceInspectorPreview } = props;
    useWidgetRuntimeSnapshot();
    const widgetRuntimeStore = useWidgetRuntimeStateStore();
    const inspectorVariantId = useEditorAppearanceInspectorVariant(element.id, useAppearanceInspectorPreview === true);
    const p = getContainerProps(element);
    const clip = p.clipContent;
    const resolveCtx = {
        variantOverrideId:
            widgetRuntimeStore?.getVariantOverride(element.id) ?? inspectorVariantId ?? null,
        signals: widgetRuntimeStore?.getSignalsForElement(element.id, false) ?? DEFAULT_SYSTEM_INTERACTION_SIGNALS,
    };
    const rectangleLike = resolveContainerRectangleLike(element, p.appearance ?? undefined, resolveCtx);
    const appearanceTransitions = resolveContainerAppearanceTransitions(p.appearance ?? undefined, resolveCtx);

    if (p.layoutKind === "free") {
        return (
            <RectangleChromeRenderer
                {...props}
                clipContent={clip}
                rectangleLike={rectangleLike}
                appearanceTransitions={appearanceTransitions}
            >
                {children}
            </RectangleChromeRenderer>
        );
    }

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
