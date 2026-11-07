/**
 * The blueprint node catalogue as pages a person or a search index can read: one page per palette
 * category, every node under the names the palette shows in both languages, with its description,
 * its pins and where it may be placed.
 *
 * Everything comes from the registry through `describeNode`, the same answer the blueprint command
 * line gives, so this page and the editor cannot disagree about a pin.
 *
 * Comments in English per project convention.
 */

import { describeNode, type NodeDetail } from "@/lib/blueprint-cli/catalog";
import { registerBuiltInPluginBlueprintNodes } from "@/lib/blueprint-cli/builtinPluginNodes";
import { blueprintNodeRegistry, registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes";
import {
    resolveBlueprintCategoryLabel,
    resolveBlueprintLabel,
    resolveBlueprintNodeTitle,
} from "@/lib/ui-editor/blueprint-nodes/blueprintNodeI18n";
import type { BlueprintNodeDef, BlueprintNodeScope } from "@/lib/ui-editor/blueprint-nodes/types";
import {
    bilingual,
    generatedHeader,
    joinLines,
    oneLine,
    slugOf,
    textOf,
    translatorFor,
} from "./catalogText";
import { widgetLabel, withInterfaceLocale, type WidgetNames } from "./widgetNames";

export type NodeCategoryPage = {
    category: string;
    label: string;
    file: string;
    count: number;
    text: string;
};

const ROLE_WORDS: Record<string, string> = {
    eventHead: "事件：一张图从这里开始 · Event: a graph starts here",
    elementEventHead: "控件事件：一张图从这里开始 · Element event: a graph starts here",
    fnHead: "函数开头 · Function head",
    functionEntry: "函数入口 · Function entry",
    valueReturn: "返回值 · Value return",
    dataLiteral: "常量 · Literal",
    elementLiteral: "控件引用 · Element reference",
    imageAssetLiteral: "图片资源 · Image asset",
    comment: "注释 · Comment",
};

const OWNER_FALLBACK: Record<string, { zh: string; en: string }> = {
    componentWidgetMain: { zh: "组件内的控件逻辑", en: "Widget logic inside a component" },
};

function ownerLabel(kind: string): string {
    const key = `uiEditor.ownerLabel.${kind}`;
    const zh = textOf("zh", key) ?? OWNER_FALLBACK[kind]?.zh;
    const en = textOf("en", key) ?? OWNER_FALLBACK[kind]?.en;
    return bilingual(zh, en) || kind;
}

function label(text: string | undefined): string {
    if (!text) {
        return "";
    }
    return bilingual(
        withInterfaceLocale("zh", () => resolveBlueprintLabel(text, translatorFor("zh"))),
        withInterfaceLocale("en", () => resolveBlueprintLabel(text, translatorFor("en"))),
    );
}

function nodeTitle(displayName: string): string {
    return bilingual(
        withInterfaceLocale("zh", () => resolveBlueprintNodeTitle(displayName, translatorFor("zh"))),
        withInterfaceLocale("en", () => resolveBlueprintNodeTitle(displayName, translatorFor("en"))),
    );
}

function categoryLabel(category: string): string {
    return bilingual(
        withInterfaceLocale("zh", () => resolveBlueprintCategoryLabel(category, translatorFor("zh"))),
        withInterfaceLocale("en", () => resolveBlueprintCategoryLabel(category, translatorFor("en"))),
    );
}

function scopeWidgetTypes(scope: BlueprintNodeScope | undefined): string[] {
    if (!scope) {
        return [];
    }
    const own = scope.widgetElementTypes ?? [];
    const nested = (scope.anyOf ?? []).flatMap(clause => scopeWidgetTypes(clause));
    return [...new Set([...own, ...nested])];
}

function describePin(pin: NodeDetail["pins"][number]): string {
    const direction = pin.kind === "input" ? "输入 · In" : "输出 · Out";
    const flow = pin.semantic === "exec" ? "执行 · exec" : pin.valueType ?? "data";
    const notes: string[] = [];
    if (pin.optional) {
        notes.push("可不连 · optional");
    }
    if (pin.acceptsLiteral) {
        notes.push("可直接填值 · accepts a typed value");
    }
    if (pin.alternatives && pin.alternatives.length > 0) {
        notes.push(`与 ${pin.alternatives.map(id => `\`${id}\``).join("、")} 任选其一 · one of a group`);
    }
    const name = label(pin.label) || pin.id;
    return `- ${direction}：${name}（\`${pin.id}\`，${flow}${notes.length > 0 ? `；${notes.join("；")}` : ""}）`;
}

function describeField(field: NodeDetail["fields"][number]): string {
    const options = field.options && field.options.length > 0
        ? `：${field.options.map(option => label(option.label) || option.value).join(" / ")}`
        : "";
    return `- 设置 · Setting：${label(field.label) || field.key}（\`${field.key}\`${options}）`;
}

function renderNode(def: BlueprintNodeDef, widgetNames: WidgetNames): string[] {
    const detail = describeNode(def.type);
    if (!detail) {
        return [];
    }
    const lines: string[] = [`### ${nodeTitle(def.displayName)}`, ""];
    const traits: string[] = [`\`${def.type}\``];
    const role = def.role ? ROLE_WORDS[def.role] : undefined;
    if (role) {
        traits.push(role);
    }
    if (def.isPure) {
        traits.push("纯数据节点，没有执行针脚 · Pure: no exec pins");
    }
    if (def.isLatent) {
        traits.push("会等待，完成后才继续 · Latent: waits before continuing");
    }
    lines.push(traits.join(" · "), "");
    const zh = oneLine(textOf("zh", def.description));
    const en = oneLine(textOf("en", def.description));
    if (zh) {
        lines.push(zh, "");
    }
    if (en && en !== zh) {
        lines.push(en, "");
    }
    const widgets = scopeWidgetTypes(def.scope);
    if (widgets.length > 0) {
        lines.push(`- 只用于这些控件的蓝图 · Only on: ${widgets.map(type => widgetLabel(widgetNames, type)).join("、")}`);
    }
    if (detail.owners.length > 0) {
        lines.push(`- 可放在 · Allowed in: ${detail.owners.map(ownerLabel).join("、")}`);
    }
    if (def.requiresListItemContext) {
        lines.push("- 只能用在列表项里 · Only inside a list item");
    }
    lines.push(...detail.pins.map(describePin));
    lines.push(...detail.fields.map(describeField));
    if (detail.dynamicPins) {
        lines.push(`- 可增加针脚 · Grows pins: ${label(detail.dynamicPins.addButtonLabel) || detail.dynamicPins.generatedIdPrefix}`);
    }
    lines.push("");
    return lines;
}

/** Register the nodes a fresh process has none of. Both calls are idempotent. */
export function ensureBlueprintNodesRegistered(): void {
    registerCoreBlueprintNodes();
    registerBuiltInPluginBlueprintNodes();
}

export function renderBlueprintNodePages(widgetNames: WidgetNames): NodeCategoryPage[] {
    ensureBlueprintNodesRegistered();
    const byCategory = new Map<string, BlueprintNodeDef[]>();
    for (const def of blueprintNodeRegistry.list()) {
        if (def.hideInPalette) {
            continue;
        }
        const list = byCategory.get(def.category) ?? [];
        list.push(def);
        byCategory.set(def.category, list);
    }
    return [...byCategory.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category, defs]) => {
            defs.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.type.localeCompare(b.type));
            const title = categoryLabel(category);
            const lines = [
                ...generatedHeader(`蓝图节点：${title}`, [
                    `「${title}」分类下的 ${defs.length} 个节点。标题是节点面板里显示的名字（中文 · English）。`,
                    "",
                    `The ${defs.length} nodes in the "${category}" palette category, titled as the node palette shows them.`,
                ]),
                ...defs.flatMap(def => renderNode(def, widgetNames)),
            ];
            return {
                category,
                label: title,
                file: `blueprint-nodes/${slugOf(category)}.md`,
                count: defs.length,
                text: joinLines(lines),
            };
        });
}
