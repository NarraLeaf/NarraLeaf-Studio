import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import { motion } from "motion/react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import {
    buttonResolvedVisualToRectangleLike,
    resolveButtonAppearanceTransitions,
    resolveButtonVisualProps,
} from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import {
    useWidgetRuntimeSnapshot,
    useWidgetRuntimeStateStore,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { useEditorAppearanceInspectorVariant } from "@/lib/ui-editor/hooks/useEditorAppearanceInspectorVariant";
import { DEFAULT_SYSTEM_INTERACTION_SIGNALS } from "@/lib/ui-editor/runtime/appearance/SystemInteractionState";
import { toRuntimeMotionTransition } from "@/lib/ui-editor/widget-modules/shared/appearance/appearanceMotion";
import { firstTransitionForKeys } from "@/lib/ui-editor/widget-modules/shared/appearance/runtimeMotionHelpers";
import { RectangleChromeRenderer } from "@/lib/ui-editor/widget-modules/shared/chrome/RectangleChromeRenderer";
import { getButtonProps } from "./helpers";

export function ButtonRenderer(props: WidgetRendererProps) {
    const { element, children, hostAdapter, useAppearanceInspectorPreview } = props;
    useWidgetRuntimeSnapshot();
    const widgetRuntimeStore = useWidgetRuntimeStateStore();
    const inspectorVariantId = useEditorAppearanceInspectorVariant(element.id, useAppearanceInspectorPreview === true);
    const p = getButtonProps(element);
    const interactionDisabled = Boolean(p.interactionDisabled);
    const resolveCtx = {
        variantOverrideId:
            widgetRuntimeStore?.getVariantOverride(element.id) ?? inspectorVariantId ?? null,
        signals: widgetRuntimeStore
            ? widgetRuntimeStore.getSignalsForElement(element.id, p.interactionDisabled)
            : { ...DEFAULT_SYSTEM_INTERACTION_SIGNALS, disabled: interactionDisabled },
    };
    const v = resolveButtonVisualProps(element, p.appearance ?? undefined, resolveCtx);
    const appearanceTransitions = resolveButtonAppearanceTransitions(p.appearance ?? undefined, resolveCtx);
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
    };
    const innerAnimate = {
        paddingTop: v.paddingY,
        paddingBottom: v.paddingY,
        paddingLeft: v.paddingX,
        paddingRight: v.paddingX,
    };
    const paddingTransition = firstTransitionForKeys(appearanceTransitions, ["paddingX", "paddingY"]);
    const innerTransition =
        paddingTransition != null
            ? {
                  paddingTop: toRuntimeMotionTransition(paddingTransition),
                  paddingBottom: toRuntimeMotionTransition(paddingTransition),
                  paddingLeft: toRuntimeMotionTransition(paddingTransition),
                  paddingRight: toRuntimeMotionTransition(paddingTransition),
              }
            : undefined;
    const paddingMotionActive = innerTransition != null;

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
            appearanceTransitions={appearanceTransitions}
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
            {paddingMotionActive ? (
                <motion.div style={innerFlex} animate={innerAnimate} transition={innerTransition}>
                    {children}
                </motion.div>
            ) : (
                <div
                    style={{
                        ...innerFlex,
                        paddingTop: v.paddingY,
                        paddingBottom: v.paddingY,
                        paddingLeft: v.paddingX,
                        paddingRight: v.paddingX,
                    }}
                >
                    {children}
                </div>
            )}
        </RectangleChromeRenderer>
    );
}
