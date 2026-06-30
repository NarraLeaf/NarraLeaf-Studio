import { MessageSquareText, UserRound } from "lucide-react";
import { Nametag, Texts } from "narraleaf-react";
import type { CSSProperties } from "react";
import type { UIListElementExtra } from "@shared/types/ui-editor/list";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { colorValueToCss } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { useEditorFontFamily } from "@/lib/workspace/hooks/useEditorFontFamily";
import { useEditorAppearanceInspectorVariant } from "@/lib/ui-editor/hooks/useEditorAppearanceInspectorVariant";
import { resolveTextVisualProps } from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import { useWidgetRuntimeElementState } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { composeTextEffectStyle } from "@/lib/ui-editor/widget-modules/shared/effects/effectStyleComposer";
import {
    lineWrapCss,
    textVerticalAlignToJustifyContent,
} from "@/lib/ui-editor/widget-modules/shared/text/textLayoutCss";
import { createInitialTextAppearance } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { TextRenderer } from "./text/renderer";
import { createTextInspector } from "./text/inspector";
import { createTextDockerBarItems } from "./text/dockerBar";
import { defaultTextWidgetProps } from "./text/types";
import { getTextProps } from "./text/helpers";

const DIALOG_SENTENCE_TYPE = "nl.dialog.sentence";
const DIALOG_NAMETAG_TYPE = "nl.dialog.nametag";
type NlrHexColor = `#${string}`;

function isLiveDialogRuntime(props: WidgetRendererProps): boolean {
    return props.hostAdapter.gameUiRuntime?.slotId === "dialog";
}

function useDialogTextStyles({
    element,
    useAppearanceInspectorPreview,
}: Pick<WidgetRendererProps, "element" | "useAppearanceInspectorPreview">): {
    outerStyle: CSSProperties;
    textStyle: CSSProperties;
    defaultColor: NlrHexColor;
} {
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
    const color = colorValueToCss({ hex: p.color, alpha: 1 });
    const tx = Number.isFinite(p.transformOffsetX) ? p.transformOffsetX : 0;
    const ty = Number.isFinite(p.transformOffsetY) ? p.transformOffsetY : 0;
    const ts = Number.isFinite(p.transformScale) && p.transformScale > 0 ? p.transformScale : 1;
    const tr = Number.isFinite(p.transformRotation) ? p.transformRotation : 0;
    const opacity = Number.isFinite(p.transformOpacity) ? Math.max(0, Math.min(1, p.transformOpacity)) : 1;
    const useEffectShell = Boolean(effectTextStyle.filter) || Boolean(effectTextStyle.mixBlendMode);

    return {
        defaultColor: p.color as NlrHexColor,
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
        textStyle: {
            width: "100%",
            margin: 0,
            padding: 4,
            boxSizing: "border-box",
            fontSize: p.fontSize,
            fontWeight: p.fontWeight,
            fontStyle: p.fontStyle,
            color,
            textAlign: p.textAlign,
            lineHeight: p.lineHeight,
            flexShrink: 0,
            ...lineWrapCss(p.textWrapMode),
            ...(editorFontFamily ? { fontFamily: editorFontFamily } : {}),
            ...(effectTextStyle.textShadow ? { textShadow: effectTextStyle.textShadow } : {}),
            ...(!useEffectShell && effectTextStyle.filter ? { filter: effectTextStyle.filter } : {}),
            ...(!useEffectShell && effectTextStyle.mixBlendMode ? { mixBlendMode: effectTextStyle.mixBlendMode } : {}),
        },
    };
}

function LiveSentenceRenderer(props: WidgetRendererProps) {
    const { outerStyle, textStyle, defaultColor } = useDialogTextStyles(props);
    return (
        <div style={outerStyle}>
            <Texts defaultColor={defaultColor} style={textStyle} />
        </div>
    );
}

function LiveNametagRenderer(props: WidgetRendererProps) {
    const { outerStyle, textStyle } = useDialogTextStyles(props);
    return (
        <div style={outerStyle}>
            <Nametag style={textStyle} />
        </div>
    );
}

function DialogSentenceRenderer(props: WidgetRendererProps) {
    if (!isLiveDialogRuntime(props)) {
        return <TextRenderer {...props} />;
    }
    return <LiveSentenceRenderer {...props} />;
}

function DialogNametagRenderer(props: WidgetRendererProps) {
    if (!isLiveDialogRuntime(props)) {
        return <TextRenderer {...props} />;
    }
    return <LiveNametagRenderer {...props} />;
}

function createDialogTextDefault(type: typeof DIALOG_SENTENCE_TYPE | typeof DIALOG_NAMETAG_TYPE) {
    const isSentence = type === DIALOG_SENTENCE_TYPE;
    return {
        type,
        name: isSentence ? "Sentence" : "Nametag",
        layout: {
            x: 0,
            y: 0,
            width: isSentence ? 560 : 220,
            height: isSentence ? 72 : 36,
            opacity: 1,
            visible: true,
        },
        props: {
            ...defaultTextWidgetProps,
            text: isSentence ? "The current line will appear here." : "Speaker",
            fontSize: isSentence ? 24 : 22,
            color: isSentence ? "#f8fafc" : "#f8d37a",
            fontWeight: isSentence ? "normal" : "600",
            lineHeight: isSentence ? 1.45 : 1.2,
            appearance: createInitialTextAppearance({
                ...defaultTextWidgetProps,
                text: isSentence ? "The current line will appear here." : "Speaker",
                fontSize: isSentence ? 24 : 22,
                color: isSentence ? "#f8fafc" : "#f8d37a",
                fontWeight: isSentence ? "normal" : "600",
                lineHeight: isSentence ? 1.45 : 1.2,
            }),
        },
    } as const;
}

export const DialogSentenceWidgetModule: UIWidgetModule = {
    type: DIALOG_SENTENCE_TYPE,
    logicApi: getWidgetLogicApi(DIALOG_SENTENCE_TYPE),
    displayName: "Sentence",
    icon: MessageSquareText,
    createDefaultElement: () => createDialogTextDefault(DIALOG_SENTENCE_TYPE),
    render: DialogSentenceRenderer,
    createInspector: createTextInspector,
    createDockerBarItems: createTextDockerBarItems,
    createMultiSelectDockerBarItems: createTextDockerBarItems,
};

export const DialogNametagWidgetModule: UIWidgetModule = {
    type: DIALOG_NAMETAG_TYPE,
    logicApi: getWidgetLogicApi(DIALOG_NAMETAG_TYPE),
    displayName: "Nametag",
    icon: UserRound,
    createDefaultElement: () => createDialogTextDefault(DIALOG_NAMETAG_TYPE),
    render: DialogNametagRenderer,
    createInspector: createTextInspector,
    createDockerBarItems: createTextDockerBarItems,
    createMultiSelectDockerBarItems: createTextDockerBarItems,
};
