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
import type { UIListElementExtra } from "@shared/types/ui-editor/list";

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

/** Attribute selector fragment for `data-nl-stack`; IDs may contain characters special to CSS selectors. */
function nlStackSelectorValue(id: string): string {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(id);
    }
    return id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * CSS gap/padding cannot be negative. Negative gap → sibling margins on following flex items; negative padding →
 * non‑positive padding plus compensating negative margins on an inner flex wrapper.
 */
function StackInner({ element, children }: WidgetRendererProps) {
    const p = getContainerProps(element);
    const isRow = p.stackDirection === "horizontal";
    const gapPx = p.stackGap;
    const useNegGap = gapPx < 0;

    const pt = p.stackPaddingTop;
    const pr = p.stackPaddingRight;
    const pb = p.stackPaddingBottom;
    const pl = p.stackPaddingLeft;
    const hasNegPad = pt < 0 || pr < 0 || pb < 0 || pl < 0;

    const flexBox: CSSProperties = {
        display: "flex",
        flexDirection: isRow ? "row" : "column",
        gap: useNegGap ? 0 : gapPx,
        alignItems: mapAlign(p.stackAlignItems),
        justifyContent: mapJustify(p.stackJustifyContent),
        overflow: "visible",
        minWidth: 0,
        minHeight: 0,
    };

    const padPos: CSSProperties = {
        paddingTop: Math.max(0, pt),
        paddingRight: Math.max(0, pr),
        paddingBottom: Math.max(0, pb),
        paddingLeft: Math.max(0, pl),
    };

    const padNegMargins: CSSProperties = {
        marginTop: Math.min(0, pt),
        marginRight: Math.min(0, pr),
        marginBottom: Math.min(0, pb),
        marginLeft: Math.min(0, pl),
    };

    const negGapCss =
        useNegGap &&
        `[data-nl-stack="${nlStackSelectorValue(element.id)}"] > * + * { ${isRow ? "margin-left" : "margin-top"}: ${gapPx}px !important; }`;

    if (!hasNegPad) {
        const style: CSSProperties = {
            width: "100%",
            height: "100%",
            boxSizing: "border-box",
            position: "relative",
            ...flexBox,
            ...padPos,
        };
        return (
            <>
                {negGapCss ? <style dangerouslySetInnerHTML={{ __html: negGapCss }} /> : null}
                <div data-nl-stack={element.id} style={style}>
                    {children}
                </div>
            </>
        );
    }

    const shell: CSSProperties = {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        ...padPos,
    };

    const inner: CSSProperties = {
        ...flexBox,
        ...padNegMargins,
        flex: 1,
        minWidth: 0,
        minHeight: 0,
    };

    return (
        <>
            {negGapCss ? <style dangerouslySetInnerHTML={{ __html: negGapCss }} /> : null}
            <div style={shell}>
                <div data-nl-stack={element.id} style={inner}>
                    {children}
                </div>
            </div>
        </>
    );
}

function ScrollInner({ element, children }: WidgetRendererProps) {
    const p = getContainerProps(element);
    const innerDir = p.stackDirection === "horizontal" ? "row" : "column";
    const isRow = innerDir === "row";
    const gapPx = p.stackGap;
    const useNegGap = gapPx < 0;

    const pt = p.stackPaddingTop;
    const pr = p.stackPaddingRight;
    const pb = p.stackPaddingBottom;
    const pl = p.stackPaddingLeft;
    const hasNegPad = pt < 0 || pr < 0 || pb < 0 || pl < 0;

    const padPos: CSSProperties = {
        paddingTop: Math.max(0, pt),
        paddingRight: Math.max(0, pr),
        paddingBottom: Math.max(0, pb),
        paddingLeft: Math.max(0, pl),
    };

    const padNegMargins: CSSProperties = {
        marginTop: Math.min(0, pt),
        marginRight: Math.min(0, pr),
        marginBottom: Math.min(0, pb),
        marginLeft: Math.min(0, pl),
    };

    const dirMin: CSSProperties =
        innerDir === "column" ? { minWidth: "100%", minHeight: 0 } : { minHeight: "100%", minWidth: 0 };

    const scrollFlex: CSSProperties = {
        display: "flex",
        flexDirection: innerDir,
        flexWrap: "nowrap",
        alignItems: "stretch",
        justifyContent: "flex-start",
        gap: useNegGap ? 0 : gapPx,
        ...padPos,
        ...dirMin,
    };

    const scrollFlexBleed: CSSProperties = {
        display: "flex",
        flexDirection: innerDir,
        flexWrap: "nowrap",
        alignItems: "stretch",
        justifyContent: "flex-start",
        gap: useNegGap ? 0 : gapPx,
        ...padNegMargins,
        ...dirMin,
        flex: 1,
        minWidth: 0,
        minHeight: 0,
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

    const negGapCss =
        useNegGap &&
        `[data-nl-stack="${nlStackSelectorValue(element.id)}"] > * + * { ${isRow ? "margin-left" : "margin-top"}: ${gapPx}px !important; }`;

    if (!hasNegPad) {
        return (
            <>
                {negGapCss ? <style dangerouslySetInnerHTML={{ __html: negGapCss }} /> : null}
                <div style={viewport}>
                    <div data-nl-stack={element.id} style={scrollFlex}>
                        {children}
                    </div>
                </div>
            </>
        );
    }

    // Negative padding uses an outer shell with positive padding only. A fixed `width: 100%` on that shell caps
    // scrollWidth at the viewport when inner flex content overflows on the x axis, so trailing positive horizontal
    // padding is not included in the scrollable extent. Use `width: max-content` + `minWidth: 100%` for x-scroll;
    // y-scroll keeps width 100% + minHeight 100% (height stays content-driven via the inner flex column).
    const scrollAxis = p.scrollAxis;
    const negPadShellSizing: CSSProperties =
        scrollAxis === "x"
            ? {
                  width: "max-content",
                  minWidth: "100%",
                  minHeight: "100%",
              }
            : {
                  width: "100%",
                  minHeight: "100%",
              };

    return (
        <>
            {negGapCss ? <style dangerouslySetInnerHTML={{ __html: negGapCss }} /> : null}
            <div style={viewport}>
                <div
                    style={{
                        boxSizing: "border-box",
                        display: "flex",
                        flexDirection: "column",
                        ...negPadShellSizing,
                        ...padPos,
                    }}
                >
                    <div data-nl-stack={element.id} style={scrollFlexBleed}>
                        {children}
                    </div>
                </div>
            </div>
        </>
    );
}

export function ContainerRenderer(props: WidgetRendererProps) {
    const { element, children, useAppearanceInspectorPreview } = props;
    const inspectorVariantId = useEditorAppearanceInspectorVariant(element.id, useAppearanceInspectorPreview === true);
    const p = getContainerProps(element);
    const runtimeState = useWidgetRuntimeElementState(element.id);
    const listScopedVariantId =
        typeof (element.extra as UIListElementExtra | undefined)?.runtimeVariantOverrideId === "string"
            ? (element.extra as UIListElementExtra).runtimeVariantOverrideId
            : null;
    const clip = p.clipContent;
    const resolveCtx = {
        variantOverrideId: listScopedVariantId ?? runtimeState.variantOverrideId ?? inspectorVariantId ?? null,
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
