import { useLayoutEffect } from "react";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { InspectorContext, UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { AppearanceAuthoringPanel } from "@/lib/ui-editor/widget-modules/shared/appearance/AppearanceAuthoringPanel";
import {
    ensureContainerAppearanceHasAllKeys,
    isUsableAppearanceModel,
} from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import { getContainerProps } from "./helpers";
import { buildContainerLayoutLeadingFields } from "./inspectorLayoutFields";

/** Module-level so FieldRenderer keeps a stable component identity across schema rebuilds (preserves variant selection). */
function ContainerAppearanceField(props: CustomFieldProps<UIInspectorData>) {
    const flat = getContainerProps(props.data.element);
    const appearance = flat.appearance;
    const { documentService } = props.data;
    const element = props.data.element;

    useLayoutEffect(() => {
        if (!isUsableAppearanceModel(appearance)) {
            return;
        }
        const f = getContainerProps(element);
        const next = ensureContainerAppearanceHasAllKeys(appearance, f);
        if (next !== appearance) {
            documentService.updateElementProps(element.id, {
                ...element.props,
                appearance: next,
            });
        }
    }, [appearance, documentService, element]);

    return (
        <AppearanceAuthoringPanel
            key={element.id}
            kind="container"
            appearance={appearance ?? null}
            onReplace={next => {
                documentService.updateElementProps(props.data.element.id, {
                    ...props.data.element.props,
                    appearance: next,
                });
            }}
            inspectorData={props.data}
            draftResetKey={props.data.element.id}
        />
    );
}

export function createContainerInspector(ctx: InspectorContext) {
    type D = UIInspectorData;
    const { element } = ctx;

    return createPropertyEditorSchema<D>({
        id: `ui-inspector:nl.container:${element.id}`,
        title: element.name ?? "Container",
        fields: [],
        tabs: [
            {
                id: "properties",
                title: "Properties",
                fields: [
                    ...(buildContainerLayoutLeadingFields(ctx) as ReturnType<typeof defineField<D, any>>[]),
                    defineField<D, any>({
                        id: "section.appearanceAuthoring",
                        type: "section",
                        title: "Appearance",
                        collapsible: true,
                        defaultCollapsed: true,
                        helpText: "Compact modules with per-module state overrides (header menu: add or remove).",
                        fields: [
                            defineField<D, any>({
                                id: "container.appearance.panel",
                                type: "custom",
                                component: ContainerAppearanceField,
                            }),
                        ],
                    }),
                ],
            },
            {
                id: "interaction",
                title: "Interaction",
                fields: [
                    defineField<D, any>({
                        id: "section.blueprint",
                        type: "section",
                        title: "Attached blueprint",
                        collapsible: true,
                        defaultCollapsed: true,
                        fields: [
                            defineField<D, any>({
                                id: "interaction.blueprint.readonly",
                                type: "custom",
                                component: ReadonlyBlueprintSection,
                            }),
                        ],
                    }),
                ],
            },
        ],
    });
}
