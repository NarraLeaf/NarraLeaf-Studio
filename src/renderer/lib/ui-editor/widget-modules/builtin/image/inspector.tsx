import type { InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import { createRectangleInspector } from "../rectangle/inspector";
import { getImageWidgetRectangleProps } from "./helpers";

export function createImageInspector(ctx: InspectorContext) {
    return createRectangleInspector(ctx, {
        getProps: getImageWidgetRectangleProps,
        titleFallback: "Image",
        schemaTypeKey: "nl.image",
    });
}
