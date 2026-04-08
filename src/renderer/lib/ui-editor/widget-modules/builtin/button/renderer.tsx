import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import {
    buttonResolvedVisualToRectangleLike,
    resolveButtonVisualProps,
} from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import {
    useWidgetRuntimeSnapshot,
    useWidgetRuntimeStateStore,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { DEFAULT_SYSTEM_INTERACTION_SIGNALS } from "@/lib/ui-editor/runtime/appearance/SystemInteractionState";
import { RectangleChromeRenderer } from "@/lib/ui-editor/widget-modules/shared/chrome/RectangleChromeRenderer";
import { getButtonProps } from "./helpers";

export function ButtonRenderer(props: WidgetRendererProps) {
    const { element, children, hostAdapter } = props;
    useWidgetRuntimeSnapshot();
    const widgetRuntimeStore = useWidgetRuntimeStateStore();
    const p = getButtonProps(element);
    const interactionDisabled = Boolean(p.interactionDisabled);
    const resolveCtx = {
        variantOverrideId: widgetRuntimeStore?.getVariantOverride(element.id) ?? null,
        signals: widgetRuntimeStore
            ? widgetRuntimeStore.getSignalsForElement(element.id, p.interactionDisabled)
            : { ...DEFAULT_SYSTEM_INTERACTION_SIGNALS, disabled: interactionDisabled },
    };
    const v = resolveButtonVisualProps(element, p.appearance ?? undefined, resolveCtx);
    const rl = buttonResolvedVisualToRectangleLike(v);
    const rt = hostAdapter.blueprintRuntime;
    const dispatchClick =
        rt && !interactionDisabled
            ? () => {
                  void rt.dispatchElementBlueprintEvent(element.id, "click");
              }
            : undefined;

    const innerFlex: CSSProperties = {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: `${v.paddingY}px ${v.paddingX}px`,
    };

    const onKeyDown = dispatchClick
        ? (e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  dispatchClick();
              }
          }
        : undefined;

    const onClick = dispatchClick ? (_e: MouseEvent<HTMLDivElement>) => dispatchClick() : undefined;

    return (
        <RectangleChromeRenderer
            {...props}
            rectangleLike={rl}
            clipContent={v.clipContent}
            extraRootStyle={{
                cursor: dispatchClick ? "pointer" : interactionDisabled ? "not-allowed" : "default",
                opacity: interactionDisabled ? 0.45 : undefined,
            }}
            extraRootProps={{
                role: dispatchClick ? ("button" as const) : ("presentation" as const),
                tabIndex: dispatchClick ? 0 : undefined,
                onClick,
                onKeyDown,
            }}
        >
            <div style={innerFlex}>{children}</div>
        </RectangleChromeRenderer>
    );
}
