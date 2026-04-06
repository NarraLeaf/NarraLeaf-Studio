import type { InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import { createRectangleInspector } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleLikeInspector";
import { getImageWidgetRectangleProps } from "./helpers";

export function createImageInspector(ctx: InspectorContext) {
    return createRectangleInspector(ctx, {
        getProps: getImageWidgetRectangleProps,
        titleFallback: "Image",
        schemaTypeKey: "nl.image",
    });
}
