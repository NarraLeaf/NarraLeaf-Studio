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
import { variantOverrideIdFor } from "@/lib/ui-editor/hooks/enteredStateContext";
import { useEnteredElementState } from "@/lib/ui-editor/hooks/useEnteredElementState";

export function ImageRenderer(props: WidgetRendererProps) {
    const { element, useAppearanceInspectorPreview } = props;
    const enteredState = useEnteredElementState(element.id, useAppearanceInspectorPreview === true);
    const appearance = (element.props as { appearance?: AppearanceModel | null } | undefined)?.appearance;
    const runtimeState = useWidgetRuntimeElementState(element.id);
    const resolveCtx = {
        variantOverrideId: variantOverrideIdFor(enteredState, runtimeState.variantOverrideId),
        signals: runtimeState.signals,
    };
    const rectangleLike = resolveImageRectangleLike(element, appearance ?? undefined, resolveCtx);
    const appearanceTransitions = resolveImageAppearanceTransitions(appearance ?? undefined, resolveCtx, rectangleLike);

    return (
        <RectangleChromeRenderer
            {...props}
            rectangleLike={rectangleLike}
            appearanceTransitions={appearanceTransitions}
        />
    );
}
