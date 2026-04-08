import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { RectangleChromeRenderer } from "@/lib/ui-editor/widget-modules/shared/chrome/RectangleChromeRenderer";
import {
    resolveImageAppearanceTransitions,
    resolveImageRectangleLike,
} from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import {
    useWidgetRuntimeSnapshot,
    useWidgetRuntimeStateStore,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { useEditorAppearanceInspectorVariant } from "@/lib/ui-editor/hooks/useEditorAppearanceInspectorVariant";
import { DEFAULT_SYSTEM_INTERACTION_SIGNALS } from "@/lib/ui-editor/runtime/appearance/SystemInteractionState";

export function ImageRenderer(props: WidgetRendererProps) {
    const { element, useAppearanceInspectorPreview } = props;
    useWidgetRuntimeSnapshot();
    const widgetRuntimeStore = useWidgetRuntimeStateStore();
    const inspectorVariantId = useEditorAppearanceInspectorVariant(element.id, useAppearanceInspectorPreview === true);
    const appearance = (element.props as { appearance?: AppearanceModel | null } | undefined)?.appearance;
    const resolveCtx = {
        variantOverrideId:
            widgetRuntimeStore?.getVariantOverride(element.id) ?? inspectorVariantId ?? null,
        signals: widgetRuntimeStore?.getSignalsForElement(element.id, false) ?? DEFAULT_SYSTEM_INTERACTION_SIGNALS,
    };
    const rectangleLike = resolveImageRectangleLike(element, appearance ?? undefined, resolveCtx);
    const appearanceTransitions = resolveImageAppearanceTransitions(appearance ?? undefined, resolveCtx);

    return (
        <RectangleChromeRenderer
            {...props}
            rectangleLike={rectangleLike}
            appearanceTransitions={appearanceTransitions}
        />
    );
}
