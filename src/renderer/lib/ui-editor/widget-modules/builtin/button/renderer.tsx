import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { colorValueToCss, parseColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { resolveButtonVisualProps } from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import {
    useWidgetRuntimeSnapshot,
    useWidgetRuntimeStateStore,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { DEFAULT_SYSTEM_INTERACTION_SIGNALS } from "@/lib/ui-editor/runtime/appearance/SystemInteractionState";
import { getButtonProps } from "./helpers";

export function ButtonRenderer({ element, children, hostAdapter }: WidgetRendererProps) {
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
    const bg = colorValueToCss(parseColorValue(v.backgroundColor, { hex: "#374151", alpha: 1 }));
    const borderColor = colorValueToCss(parseColorValue(v.borderColor, { hex: "#000000", alpha: 1 }));
    const rt = hostAdapter.blueprintRuntime;
    const dispatchClick =
        rt && !interactionDisabled
            ? () => {
                  void rt.dispatchElementBlueprintEvent(element.id, "click");
              }
            : undefined;

    const style: CSSProperties = {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bg,
        borderRadius: v.borderRadius,
        padding: `${v.paddingY}px ${v.paddingX}px`,
        overflow: v.clipContent ? "hidden" : "visible",
        cursor: dispatchClick ? "pointer" : interactionDisabled ? "not-allowed" : "default",
        opacity: interactionDisabled ? 0.45 : undefined,
    };

    if (v.borderStyle !== "none" && v.borderWidth > 0) {
        style.border = `${v.borderWidth}px ${v.borderStyle} ${borderColor}`;
    } else {
        style.border = "none";
    }

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
        <div
            style={style}
            role={dispatchClick ? "button" : "presentation"}
            tabIndex={dispatchClick ? 0 : undefined}
            onClick={onClick}
            onKeyDown={onKeyDown}
        >
            {children}
        </div>
    );
}
