/**
 * The interface editor's widgets as a page: for each widget an author can insert, the properties
 * panel it opens (tabs, sections, fields and the hint under each), the events its own blueprint can
 * start from, and the other nodes that only work on it.
 *
 * The properties come from each module's own `createInspector`, built once per language against a
 * document service that answers nothing - building a schema only declares fields, and nothing here
 * reads or writes a value.
 *
 * Comments in English per project convention.
 */

import type { UIElement } from "@shared/types/ui-editor/document";
import type { FieldDefinition, PropertyEditorSchema } from "@/apps/workspace/modules/properties/framework/types";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes";
import { resolveBlueprintNodeTitle } from "@/lib/ui-editor/blueprint-nodes/blueprintNodeI18n";
import type { BlueprintNodeScope } from "@/lib/ui-editor/blueprint-nodes/types";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { bilingual, generatedHeader, joinLines, oneLine, slugOf, translatorFor, type CatalogLocale } from "./catalogText";
import { ensureBlueprintNodesRegistered } from "./blueprintNodes";
import { widgetLabel, withInterfaceLocale, type WidgetNames } from "./widgetNames";

type FieldLine = { depth: number; id: string; kind: string; label?: string; hint?: string; options?: string[] };
type TabLines = { id: string; title?: string; fields: FieldLine[] };

/** A document service that has nothing in it. Every method returns an empty document. */
const EMPTY_DOCUMENT_SERVICE = new Proxy({}, {
    get: () => () => ({ elements: {}, surfaces: {} }),
}) as unknown as UIDocumentService;

function flattenFields(fields: readonly FieldDefinition[], depth: number): FieldLine[] {
    return fields.flatMap(field => {
        const record = field as FieldDefinition & {
            title?: string;
            fields?: FieldDefinition[];
            options?: unknown;
        };
        const options = Array.isArray(record.options)
            ? (record.options as { label?: string; value?: unknown }[]).map(option => option.label ?? String(option.value))
            : undefined;
        const line: FieldLine = {
            depth,
            id: field.id,
            kind: field.type,
            label: record.title ?? field.label,
            hint: field.tip ?? field.helpText,
            options,
        };
        return [line, ...(record.fields ? flattenFields(record.fields, depth + 1) : [])];
    });
}

function inspectorTabs(module: UIWidgetModule, locale: CatalogLocale): TabLines[] {
    return withInterfaceLocale(locale, () => {
        const element = { ...module.createDefaultElement(), type: module.type, id: "catalog-element" } as UIElement;
        const schema = module.createInspector?.({ element, documentService: EMPTY_DOCUMENT_SERVICE }) as
            | PropertyEditorSchema
            | undefined;
        if (!schema) {
            return [];
        }
        const tabs = schema.tabs && schema.tabs.length > 0 ? schema.tabs : [{ id: "main", title: undefined, fields: schema.fields }];
        return tabs.map(tab => ({ id: tab.id, title: tab.title, fields: flattenFields(tab.fields, 0) }));
    });
}

function renderFields(zh: FieldLine[], en: FieldLine[]): string[] {
    const english = new Map(en.map(line => [line.id, line]));
    return zh.flatMap(line => {
        const other = english.get(line.id);
        const name = bilingual(line.label, other?.label);
        if (!name) {
            // A custom field draws its own label; there is nothing to name it by here.
            return [];
        }
        const indent = "  ".repeat(line.depth);
        if (line.kind === "section") {
            return [`${indent}- **${name}**`];
        }
        const parts = [`${indent}- ${name}`];
        const options = line.options && line.options.length > 0
            ? bilingual(line.options.join(" / "), other?.options?.join(" / "))
            : "";
        if (options) {
            parts.push(`（选项 · options：${options}）`);
        }
        const hint = bilingual(oneLine(line.hint), oneLine(other?.hint));
        if (hint) {
            parts.push(`：${hint}`);
        }
        return [parts.join("")];
    });
}

function scopeMatches(scope: BlueprintNodeScope | undefined, type: string): boolean {
    if (!scope) {
        return false;
    }
    return (scope.widgetElementTypes ?? []).includes(type) || (scope.anyOf ?? []).some(clause => scopeMatches(clause, type));
}

function nodeName(displayName: string): string {
    return bilingual(
        withInterfaceLocale("zh", () => resolveBlueprintNodeTitle(displayName, translatorFor("zh"))),
        withInterfaceLocale("en", () => resolveBlueprintNodeTitle(displayName, translatorFor("en"))),
    );
}

function widgetNodes(type: string): { events: string[]; actions: string[] } {
    const events: string[] = [];
    const actions: string[] = [];
    const defs = blueprintNodeRegistry.list()
        .filter(def => !def.hideInPalette && scopeMatches(def.scope, type))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    for (const def of defs) {
        const name = `${nodeName(def.displayName)}（${slugOf(def.category)}）`;
        if (def.role === "eventHead" || def.role === "elementEventHead") {
            events.push(name);
        } else {
            actions.push(name);
        }
    }
    return { events, actions };
}

export function renderWidgetsPage(modules: readonly UIWidgetModule[], widgetNames: WidgetNames): string {
    ensureBlueprintNodesRegistered();
    const lines = generatedHeader("界面控件与属性面板 · Widgets and their properties", [
        "界面编辑器里可以插入的每种控件：属性面板里有哪些标签页和字段（含字段下方的提示），控件自己的蓝图能用哪些事件开头，以及只对它生效的节点。",
        "节点后面括号里是它在 `blueprint-nodes/` 下所在的文件名。",
        "",
        "Every widget the interface editor can insert: the tabs and fields of its properties panel, the events its own blueprint can start from, and the nodes that only work on it. The word in brackets after a node is its file under `blueprint-nodes/`.",
    ]);
    for (const module of modules) {
        lines.push(`## ${widgetLabel(widgetNames, module.type)}`, "", `元素类型 · Element type：\`${module.type}\``, "");
        const zhTabs = inspectorTabs(module, "zh");
        const enTabs = new Map(inspectorTabs(module, "en").map(tab => [tab.id, tab]));
        for (const tab of zhTabs) {
            const english = enTabs.get(tab.id);
            const fields = renderFields(tab.fields, english?.fields ?? []);
            if (fields.length === 0) {
                continue;
            }
            const title = bilingual(tab.title, english?.title);
            lines.push(title ? `### 属性面板 · Properties：${title}` : "### 属性面板 · Properties", "", ...fields, "");
        }
        const { events, actions } = widgetNodes(module.type);
        if (events.length > 0) {
            lines.push("### 控件蓝图的事件 · Events on its blueprint", "", ...events.map(name => `- ${name}`), "");
        }
        if (actions.length > 0) {
            lines.push("### 只对它生效的节点 · Nodes only for this widget", "", ...actions.map(name => `- ${name}`), "");
        }
    }
    return joinLines(lines);
}
