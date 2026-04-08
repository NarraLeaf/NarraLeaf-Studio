import { useLayoutEffect } from "react";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { UIInspectorData, InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import { AppearanceAuthoringPanel } from "@/lib/ui-editor/widget-modules/shared/appearance/AppearanceAuthoringPanel";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import {
    ensureButtonAppearanceHasAllKeys,
    isUsableAppearanceModel,
} from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { getButtonProps } from "./helpers";
import type { ButtonWidgetProps } from "./types";

/** Module-level so FieldRenderer keeps a stable component identity across schema rebuilds (preserves variant selection). */
function ButtonAppearanceField(props: CustomFieldProps<UIInspectorData>) {
    const flat = getButtonProps(props.data.element);
    const appearance = flat.appearance;
    const { documentService } = props.data;
    const element = props.data.element;

    useLayoutEffect(() => {
        if (!isUsableAppearanceModel(appearance)) {
            return;
        }
        const f = getButtonProps(element);
        const next = ensureButtonAppearanceHasAllKeys(appearance, f);
        if (next !== appearance) {
            documentService.updateElementProps(element.id, {
                ...element.props,
                appearance: next,
            });
        }
    }, [appearance, documentService, element]);

    return (
        <AppearanceAuthoringPanel
            kind="button"
            appearance={appearance ?? null}
            onReplace={next => {
                documentService.updateElementProps(element.id, {
                    ...element.props,
                    appearance: next,
                });
            }}
            inspectorData={props.data}
            draftResetKey={element.id}
        />
    );
}

export function createButtonInspector(ctx: InspectorContext) {
    type D = UIInspectorData;
    const { element, documentService } = ctx;

    const patch = (partial: Partial<ButtonWidgetProps>) => {
        documentService.updateElementProps(element.id, {
            ...element.props,
            ...partial,
        });
    };

    return createPropertyEditorSchema<D>({
        id: `ui-inspector:nl.button:${element.id}`,
        title: element.name ?? "Button",
        fields: [],
        tabs: [
            {
                id: "properties",
                title: "Properties",
                fields: [
                    defineField<D, any>({
                        id: "section.appearanceAuthoring",
                        type: "section",
                        title: "Appearance",
                        helpText: "Compact modules with per-module state overrides (header menu: add or remove).",
                        fields: [
                            defineField<D, any>({
                                id: "button.appearance.panel",
                                type: "custom",
                                component: ButtonAppearanceField,
                            }),
                        ],
                    }),
                    defineField<D, any>({
                        id: "section.behavior",
                        type: "section",
                        title: "Behavior",
                        collapsible: true,
                        defaultCollapsed: true,
                        fields: [
                            defineField<D, any>({
                                id: "button.interactionDisabled",
                                type: "checkbox",
                                label: "Interaction disabled (runtime preview)",
                                getValue: (d: D) => Boolean(getButtonProps(d.element).interactionDisabled),
                                setValue: (_d: D, v: boolean) => patch({ interactionDisabled: v }),
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
                        title: "Blueprint",
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
