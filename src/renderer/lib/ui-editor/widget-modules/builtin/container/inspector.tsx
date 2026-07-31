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
import { i18nStore } from "@/lib/i18n";
import { getContainerProps } from "./helpers";
import { buildContainerLayoutLeadingFields } from "./inspectorLayoutFields";

/** Module-level so FieldRenderer keeps a stable component identity across schema rebuilds (preserves variant selection). */
function ContainerAppearanceField(props: CustomFieldProps<UIInspectorData>) {
    const flat = getContainerProps(props.data.element);
    const appearance = flat.appearance;
    const { documentService } = props.data;
    const element = props.data.element;

    // Deferred, not refused, while the workspace is read-only: this is bookkeeping nobody asked for
    // - it fills in appearance keys a document predates - and running it on a frozen project raised
    // "Nothing is being saved right now" about a write the author never made, just for selecting an
    // element. `readOnly` is an input of the effect, so it happens as soon as writing is possible
    // again; the model that was out of date still is.
    useLayoutEffect(() => {
        if (props.readOnly || !isUsableAppearanceModel(appearance)) {
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
    }, [appearance, documentService, element, props.readOnly]);

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
            readOnly={props.readOnly}
        />
    );
}

export function createContainerInspector(ctx: InspectorContext) {
    type D = UIInspectorData;
    const { t } = i18nStore.getTranslator();
    const { element } = ctx;

    return createPropertyEditorSchema<D>({
        id: `ui-inspector:nl.container:${element.id}`,
        title: element.name ?? t("widgets.container.title"),
        fields: [],
        tabs: [
            {
                id: "properties",
                title: t("widgets.tabs.properties"),
                fields: [
                    ...(buildContainerLayoutLeadingFields(ctx) as ReturnType<typeof defineField<D, any>>[]),
                    defineField<D, any>({
                        id: "section.appearanceAuthoring",
                        type: "section",
                        title: t("widgets.appearance.title"),
                        collapsible: true,
                        defaultCollapsed: true,
                        helpText: t("widgets.appearance.modulesHelp"),
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
                title: t("widgets.tabs.interaction"),
                fields: [
                    defineField<D, any>({
                        id: "interaction.blueprint.readonly",
                        type: "custom",
                        label: t("widgets.blueprint.controlLabel"),
                        component: ReadonlyBlueprintSection,
                    }),
                ],
            },
        ],
    });
}
