/**
 * Two pages about operating Studio rather than about a project's content: every default shortcut
 * and mouse gesture, and the full text of every F1 help topic.
 *
 * The shortcuts are the defaults. An author can rebind them, so the page says so instead of
 * pretending a chord is fixed.
 *
 * Comments in English per project convention.
 */

import type { TranslationKey } from "@shared/i18n";
import { ALL_HELP_TOPICS, HELP_SECTIONS, helpBodyKey, helpSectionKey, helpTitleKey, type HelpTopic } from "@/lib/help/helpTopics";
import { parseHelpBody } from "@/lib/help/helpBody";
import { KEYBINDING_CATALOG, KEYBINDING_CATEGORY } from "@/lib/workspace/services/ui/keybindingCatalog";
import { FIXED_INPUT_CATALOG, formatFixedInput, resolveFixedInputDisplay } from "@/lib/workspace/services/ui/fixedInputCatalog";
import { formatKeybinding } from "@/lib/workspace/services/ui/keybindingFormat";
import { bilingual, generatedHeader, joinLines, textOf, translatorFor, type CatalogLocale } from "./catalogText";
import { withInterfaceLocale } from "./widgetNames";

function both(key: string): string {
    return bilingual(textOf("zh", key), textOf("en", key));
}

/** A chord on both platforms, e.g. `⇧⌘P` (macOS) / `Ctrl+Shift+P` (Windows). */
function chord(binding: string): string {
    const mac = withInterfaceLocale("en", () => formatKeybinding(binding, true));
    const other = withInterfaceLocale("en", () => formatKeybinding(binding, false));
    return mac === other ? `\`${mac}\`` : `\`${mac}\`（macOS）/ \`${other}\`（Windows）`;
}

function gesture(input: (typeof FIXED_INPUT_CATALOG)[number]["inputs"][number], locale: CatalogLocale): string {
    const t = translatorFor(locale) as (key: TranslationKey, params?: Record<string, string>) => string;
    return withInterfaceLocale(locale, () => formatFixedInput(input, false, t));
}

export function renderShortcutsPage(): string {
    const lines = generatedHeader("快捷键与鼠标操作 · Shortcuts and gestures", [
        "Studio 的默认快捷键和鼠标操作，按设置里「快捷键」表的分组排列。快捷键可以在设置里改，这里列的是默认值。",
        "",
        "Studio's default shortcuts and mouse gestures, grouped as the Keyboard Shortcuts settings table groups them. Shortcuts can be rebound in settings; these are the defaults.",
    ]);
    for (const categoryKey of Object.values(KEYBINDING_CATEGORY)) {
        const bindings = KEYBINDING_CATALOG.filter(entry => entry.categoryKey === categoryKey);
        const gestures = FIXED_INPUT_CATALOG.filter(item => resolveFixedInputDisplay(item)?.categoryKey === categoryKey && !item.extends);
        if (bindings.length === 0 && gestures.length === 0) {
            continue;
        }
        lines.push(`## ${both(categoryKey)}`, "");
        for (const binding of bindings) {
            const extra = FIXED_INPUT_CATALOG
                .filter(item => item.extends === binding.id)
                .flatMap(item => item.inputs)
                .map(input => bilingual(gesture(input, "zh"), gesture(input, "en")));
            lines.push(`- ${both(binding.labelKey)}：${chord(binding.key)}${extra.length > 0 ? `；也可以 · also：${extra.join("；")}` : ""}`);
        }
        for (const item of gestures) {
            const display = resolveFixedInputDisplay(item);
            if (!display) {
                continue;
            }
            const inputs = item.inputs.map(input => bilingual(gesture(input, "zh"), gesture(input, "en")));
            lines.push(`- ${both(display.labelKey)}：${inputs.join("；")}（不可改 · fixed）`);
        }
        lines.push("");
    }
    return joinLines(lines);
}

function bodyLines(locale: CatalogLocale, topic: HelpTopic): string[] {
    const body = textOf(locale, helpBodyKey(topic.id));
    if (!body) {
        return [];
    }
    return parseHelpBody(body).flatMap(block =>
        block.kind === "paragraph" ? [block.text, ""] : [...block.items.map(item => `- ${item}`), ""]);
}

function topicShortcuts(topic: HelpTopic): string[] {
    return (topic.shortcuts ?? []).flatMap(id => {
        const binding = KEYBINDING_CATALOG.find(entry => entry.id === id);
        if (binding) {
            return [`- ${both(binding.labelKey)}：${chord(binding.key)}`];
        }
        const fixed = FIXED_INPUT_CATALOG.find(item => item.id === id);
        const display = fixed ? resolveFixedInputDisplay(fixed) : null;
        if (fixed && display) {
            return [`- ${both(display.labelKey)}：${fixed.inputs.map(input => bilingual(gesture(input, "zh"), gesture(input, "en"))).join("；")}`];
        }
        return [];
    });
}

export function renderHelpPage(): string {
    const lines = generatedHeader("Studio 内置帮助全文 · In-Studio help topics", [
        "Studio 里按 F1 或点 `?` 打开的帮助主题全文，按帮助浏览器的分区排列。每个主题先中文后英文。",
        "",
        "The full text of the help topics F1 and `?` open inside Studio, in the help browser's sections. Each topic gives Chinese first, then English.",
    ]);
    for (const section of HELP_SECTIONS) {
        const topics = ALL_HELP_TOPICS.filter(topic => topic.section === section);
        if (topics.length === 0) {
            continue;
        }
        lines.push(`## ${both(helpSectionKey(section))}`, "");
        for (const topic of topics) {
            lines.push(`### ${both(helpTitleKey(topic.id))}`, "");
            lines.push(...bodyLines("zh", topic));
            lines.push(...bodyLines("en", topic));
            const shortcuts = topicShortcuts(topic);
            if (shortcuts.length > 0) {
                lines.push("相关快捷键 · Shortcuts：", "", ...shortcuts, "");
            }
            if (topic.related && topic.related.length > 0) {
                lines.push(`相关主题 · Related：${topic.related.map(id => both(helpTitleKey(id))).join("、")}`, "");
            }
            if (topic.learnMore) {
                lines.push(`详细说明 · Learn more：${topic.learnMore}`, "");
            }
        }
    }
    return joinLines(lines);
}
