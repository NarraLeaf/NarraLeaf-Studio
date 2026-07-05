import type { CSSProperties } from "react";
import type { UIListElementExtra } from "@shared/types/ui-editor/list";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { useEditorFontFamily } from "@/lib/workspace/hooks/useEditorFontFamily";
import { useEditorAppearanceInspectorVariant } from "@/lib/ui-editor/hooks/useEditorAppearanceInspectorVariant";
import { resolveTextVisualProps } from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import { useWidgetRuntimeElementState } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { composeTextEffectStyle } from "@/lib/ui-editor/widget-modules/shared/effects/effectStyleComposer";
import {
    lineWrapCss,
    textVerticalAlignToJustifyContent,
} from "@/lib/ui-editor/widget-modules/shared/text/textLayoutCss";
import { getTextProps } from "@/lib/ui-editor/widget-modules/builtin/text/helpers";

export type NlrHexColor = `#${string}`;

export type LiveTextStyles = {
    outerStyle: CSSProperties;
    textStyle: CSSProperties;
    textAppearanceProps: {
        defaultColor: NlrHexColor;
        fontSize: CSSProperties["fontSize"];
        fontWeight: CSSProperties["fontWeight"];
        fontWeightBold: CSSProperties["fontWeight"];
        fontFamily?: CSSProperties["fontFamily"];
    };
};

/**
 * Resolves a text-like widget's authored appearance into styles usable by NarraLeaf React
 * live text renderers (`<Texts>`), shared by the Dialog Sentence and NVL Texts widgets.
 */
export function useLiveTextStyles({
    element,
    useAppearanceInspectorPreview,
}: Pick<WidgetRendererProps, "element" | "useAppearanceInspectorPreview">): LiveTextStyles {
    const flatProps = getTextProps(element);
    const inspectorVariantId = useEditorAppearanceInspectorVariant(element.id, useAppearanceInspectorPreview === true);
    const runtimeState = useWidgetRuntimeElementState(element.id);
    const listScopedVariantId =
        typeof (element.extra as UIListElementExtra | undefined)?.runtimeVariantOverrideId === "string"
            ? (element.extra as UIListElementExtra).runtimeVariantOverrideId
            : null;
    const p = resolveTextVisualProps(element, flatProps.appearance ?? undefined, {
        variantOverrideId: listScopedVariantId ?? runtimeState.variantOverrideId ?? inspectorVariantId ?? null,
        signals: runtimeState.signals,
    });
    const { cssFamily: editorFontFamily } = useEditorFontFamily(p.fontAssetId);
    const effectTextStyle = composeTextEffectStyle(p.effects);
    const tx = Number.isFinite(p.transformOffsetX) ? p.transformOffsetX : 0;
    const ty = Number.isFinite(p.transformOffsetY) ? p.transformOffsetY : 0;
    const ts = Number.isFinite(p.transformScale) && p.transformScale > 0 ? p.transformScale : 1;
    const tr = Number.isFinite(p.transformRotation) ? p.transformRotation : 0;
    const opacity = Number.isFinite(p.transformOpacity) ? Math.max(0, Math.min(1, p.transformOpacity)) : 1;
    const useEffectShell = Boolean(effectTextStyle.filter) || Boolean(effectTextStyle.mixBlendMode);
    const baseTextStyle: CSSProperties = {
        width: "100%",
        margin: 0,
        padding: 4,
        boxSizing: "border-box",
        fontStyle: p.fontStyle,
        textAlign: p.textAlign,
        lineHeight: p.lineHeight,
        flexShrink: 0,
        ...lineWrapCss(p.textWrapMode),
        ...(effectTextStyle.textShadow ? { textShadow: effectTextStyle.textShadow } : {}),
        ...(!useEffectShell && effectTextStyle.filter ? { filter: effectTextStyle.filter } : {}),
        ...(!useEffectShell && effectTextStyle.mixBlendMode ? { mixBlendMode: effectTextStyle.mixBlendMode } : {}),
    };
    const defaultColor = p.color as NlrHexColor;
    const fontWeightBold: CSSProperties["fontWeight"] = p.fontWeight === "normal" ? "bold" : 700;

    return {
        outerStyle: {
            width: "100%",
            height: "100%",
            minHeight: 0,
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            justifyContent: textVerticalAlignToJustifyContent(p.textVerticalAlign),
            alignItems: "stretch",
            transform: `translate(${tx}px, ${ty}px) scale(${ts}) rotate(${tr}deg)`,
            opacity,
            ...(useEffectShell && effectTextStyle.filter ? { filter: effectTextStyle.filter } : {}),
            ...(useEffectShell && effectTextStyle.mixBlendMode ? { mixBlendMode: effectTextStyle.mixBlendMode } : {}),
        },
        textStyle: baseTextStyle,
        textAppearanceProps: {
            defaultColor,
            fontSize: p.fontSize,
            fontWeight: p.fontWeight,
            fontWeightBold,
            ...(editorFontFamily ? { fontFamily: editorFontFamily } : {}),
        },
    };
}
