import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type {
    CustomFieldProps,
    FieldDefinition,
    PropertyEditorSchema,
    PropertyEditorTab,
} from "@/apps/workspace/modules/properties/framework/types";
import { selfReadOnly } from "@/apps/workspace/modules/properties/framework/fields/fieldReadOnlyStrategy";
import type { UIElement } from "@shared/types/ui-editor/document";
import { uiTextSiteLabel, type UITextSite } from "@shared/types/ui-editor/textSource";
import { i18nStore } from "@/lib/i18n";
import { withLiveDocumentService } from "@/lib/plugins/pluginWidgetHostData";
import type { UIInspectorData } from "../../types";
import { createLabelSourceField } from "./LabelSourceField";
import type { MarkedLabelProps } from "./markedLabel";

/** The id the built-in widgets give the tab their own fields are on, which this section goes to the top of. */
const PROPERTIES_TAB_ID = "properties";

/**
 * A plugin prop's words as the shared source field reads and writes them: a plain string, with no
 * marks, because the plugin's renderer is handed a string to draw.
 */
function plainLabelOf(site: UITextSite): MarkedLabelProps {
    return {
        read: element => {
            const value = (element.props as Record<string, unknown> | undefined)?.[site.textProp];
            return { text: typeof value === "string" ? value : "", rich: undefined, color: "" };
        },
        write: text => ({ [site.textProp]: text }),
    };
}

/**
 * One source field per declared prop, kept across schema rebuilds: the properties panel rebuilds the
 * schema on every selection and document change, and a field component made afresh each time would
 * remount, dropping the box an author is typing in.
 */
const fieldsBySite = new Map<string, ReturnType<typeof createPluginTextSourceField>>();

function createPluginTextSourceField(site: UITextSite) {
    const SourceField = createLabelSourceField({
        site,
        label: plainLabelOf(site),
        singleLine: site.multiline !== true,
        withoutMarks: true,
    });
    // The panel hands a plugin widget's fields the narrowed document service; this field is the
    // host's, and reads the live one (see `pluginWidgetHostData`).
    return selfReadOnly(function PluginTextSourceField(props: CustomFieldProps<UIInspectorData>) {
        return <SourceField {...props} data={withLiveDocumentService(props.data)} />;
    });
}

function pluginTextSourceField(site: UITextSite) {
    const id = `${site.widgetType}\u0000${site.textProp}\u0000${site.keyProp ?? ""}\u0000${site.multiline === true}`;
    let field = fieldsBySite.get(id);
    if (!field) {
        field = createPluginTextSourceField(site);
        fieldsBySite.set(id, field);
    }
    return field;
}

/**
 * A plugin widget's inspector with a Content section at the top of its Properties tab, holding the
 * words of every prop the widget declares in its manifest (`contributes.widgetText`).
 *
 * Each is the field Studio's own text and button labels are (`createLabelSourceField`): written
 * directly or read from a translation key, one of the two, with a key's source words editable in
 * place. A plugin cannot build it - it is a host component that reads the key registry and the
 * workspace - so the host adds it, as it adds the Interaction tab (`widgetLogicTab.ts`). The
 * widget's own fields stay below it on the same tab. A widget that declared fields but no tabs has
 * them put under a Properties tab, as the built-in ones are laid out.
 */
export function prependPluginTextSection(
    schema: PropertyEditorSchema<UIInspectorData> | undefined,
    element: UIElement,
    sites: readonly UITextSite[],
): PropertyEditorSchema<UIInspectorData> | undefined {
    if (sites.length === 0) {
        return schema;
    }
    const { t } = i18nStore.getTranslator();
    const locale = i18nStore.getLocale();
    const section: FieldDefinition<UIInspectorData> = defineField<UIInspectorData, any>({
        id: "section.pluginTextContent",
        type: "section",
        title: t("widgets.content"),
        fields: sites.map(site => defineField<UIInspectorData, any>({
            id: `pluginText.${site.textProp}`,
            type: "custom",
            // One unnamed prop reads as the widget's text, as a button's label does; several are told
            // apart by what the plugin calls them.
            label: sites.length === 1 && !site.label ? t("widgets.textLabel") : uiTextSiteLabel(site, locale),
            component: pluginTextSourceField(site),
        })),
    });
    const existing = schema?.tabs ?? [];
    const tabs: PropertyEditorTab<UIInspectorData>[] = existing.length > 0
        ? existing.some(tab => tab.id === PROPERTIES_TAB_ID)
            ? existing.map(tab => (tab.id === PROPERTIES_TAB_ID ? { ...tab, fields: [section, ...tab.fields] } : tab))
            : [{ id: PROPERTIES_TAB_ID, title: t("widgets.tabs.properties"), fields: [section] }, ...existing]
        : [{ id: PROPERTIES_TAB_ID, title: t("widgets.tabs.properties"), fields: [section, ...(schema?.fields ?? [])] }];
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
