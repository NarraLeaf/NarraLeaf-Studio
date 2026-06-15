import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { RectangleChromeRenderer } from "@/lib/ui-editor/widget-modules/shared/chrome/RectangleChromeRenderer";
import {
    resolveImageAppearanceTransitions,
    resolveImageRectangleLike,
} from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import {
    useWidgetRuntimeElementState,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { useEditorAppearanceInspectorVariant } from "@/lib/ui-editor/hooks/useEditorAppearanceInspectorVariant";

export function ImageRenderer(props: WidgetRendererProps) {
    const { element, useAppearanceInspectorPreview } = props;
    const inspectorVariantId = useEditorAppearanceInspectorVariant(element.id, useAppearanceInspectorPreview === true);
    const appearance = (element.props as { appearance?: AppearanceModel | null } | undefined)?.appearance;
    const runtimeState = useWidgetRuntimeElementState(element.id);
    const resolveCtx = {
        variantOverrideId: runtimeState.variantOverrideId ?? inspectorVariantId ?? null,
        signals: runtimeState.signals,
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
