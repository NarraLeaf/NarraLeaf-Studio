import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { PropertyEditorSchema, PropertyEditorTab } from "@/apps/workspace/modules/properties/framework/types";
import type { UIElement } from "@shared/types/ui-editor/document";
import { i18nStore } from "@/lib/i18n";
import type { UIInspectorData } from "../../types";
import { ReadonlyBlueprintSection } from "./ReadonlyBlueprintSection";

/** The id the built-in widgets give the tab that holds their blueprint, which this one matches. */
const WIDGET_LOGIC_TAB_ID = "interaction";

/**
 * A widget's inspector with the Interaction tab - the one way into the widget's own blueprint -
 * added after whatever the widget declared.
 *
 * Every built-in inspector writes this tab into its own schema. A plugin cannot: the section is a host
 * component that reads the workspace, and nothing on the narrowed surface a plugin widget is given
 * could build it. So for a plugin widget whose logic API says it has a blueprint of its own, the host
 * adds it, and the events that blueprint answers are reachable the way a built-in widget's are.
 *
 * A widget that declared fields but no tabs has them put under a Properties tab, as the built-in
 * ones are laid out, so the layout rows the panel adds above them stay on the first tab.
 */
export function appendWidgetLogicTab(
    schema: PropertyEditorSchema<UIInspectorData> | undefined,
    element: UIElement,
): PropertyEditorSchema<UIInspectorData> {
    const { t } = i18nStore.getTranslator();
    const existing = schema?.tabs ?? [];
    const logicTab: PropertyEditorTab<UIInspectorData> = {
        id: existing.some(tab => tab.id === WIDGET_LOGIC_TAB_ID) ? `${WIDGET_LOGIC_TAB_ID}.host` : WIDGET_LOGIC_TAB_ID,
        title: t("widgets.tabs.interaction"),
        fields: [
            defineField<UIInspectorData, any>({
                id: "interaction.blueprint.readonly",
                type: "custom",
                label: t("widgets.blueprint.controlLabel"),
                component: ReadonlyBlueprintSection,
            }),
        ],
    };
    const tabs: PropertyEditorTab<UIInspectorData>[] = existing.length > 0
        ? [...existing, logicTab]
        : [{ id: "properties", title: t("widgets.tabs.properties"), fields: schema?.fields ?? [] }, logicTab];
    return createPropertyEditorSchema<UIInspectorData>({
        id: schema?.id ?? `ui-inspector:${element.type}:${element.id}`,
        title: schema?.title,
        fields: [],
        tabs,
        defaultTabId: schema?.defaultTabId ?? tabs[0]?.id,
        onFieldChange: schema?.onFieldChange,
        showSavingIndicator: schema?.showSavingIndicator,
    });
}
