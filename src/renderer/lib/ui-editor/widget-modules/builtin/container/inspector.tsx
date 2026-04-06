import type { InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import { createRectangleInspector } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleLikeInspector";
import { buildContainerLayoutLeadingFields } from "./inspectorLayoutFields";

export function createContainerInspector(ctx: InspectorContext) {
    return createRectangleInspector(ctx, {
        schemaTypeKey: "nl.container",
        titleFallback: "Container",
        leadingPropertyFields: buildContainerLayoutLeadingFields(ctx),
    });
}
