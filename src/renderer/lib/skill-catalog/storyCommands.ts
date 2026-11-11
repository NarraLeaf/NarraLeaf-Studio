/**
 * The story editor's `/` commands as a page, grouped the way the command menu groups them: each
 * command's name and one-line description in both languages, the token and aliases it can be typed
 * as, and its parameters with the values an enumerated one accepts.
 *
 * Comments in English per project convention.
 */

import { commandDetailKey, commandLabelKey, listCommandSpecs } from "@/apps/workspace/modules/story/scene-editor/commands/registry";
import type { StoryCommandParamSpec } from "@/apps/workspace/modules/story/scene-editor/commands/spec";
import { STORY_COMMAND_GROUPS, commandCategoryLabelKey } from "@/apps/workspace/modules/story/scene-editor/storyCommandCategories";
import { bilingual, generatedHeader, joinLines, oneLine, textOf } from "./catalogText";

type ParamTypeLike = {
    kind?: string;
    options?: readonly { value: string; aliases?: readonly string[]; labelKey?: string }[];
    min?: number;
    max?: number;
    unit?: string;
};

function describeType(type: ParamTypeLike): string {
    const kind = type.kind ?? "value";
    if (type.options && type.options.length > 0) {
        const values = type.options.map(option => {
            const name = bilingual(textOf("zh", option.labelKey), textOf("en", option.labelKey));
            return name ? `\`${option.value}\`（${name}）` : `\`${option.value}\``;
        });
        return `${kind}：${values.join("、")}`;
    }
    const range = [
        type.min !== undefined ? `≥ ${type.min}` : "",
        type.max !== undefined ? `≤ ${type.max}` : "",
        type.unit ? `单位 · unit ${type.unit}` : "",
    ].filter(Boolean);
    return range.length > 0 ? `${kind}，${range.join("，")}` : kind;
}

function describeParam(name: string, param: StoryCommandParamSpec): string {
    const types = (Array.isArray(param.type) ? param.type : [param.type]) as ParamTypeLike[];
    const hintKey = `story.paramHint.${param.hint ?? name}`;
    const label = bilingual(textOf("zh", hintKey), textOf("en", hintKey));
    const spelling = [name, ...(param.aliases ?? [])].map(word => `\`${word}\``).join(" / ");
    const shape = [
        param.positional ? "按位置填写 · positional" : "写成 key=value · named",
        param.greedy ? "吃掉本行剩余文字 · takes the rest of the line" : "",
    ].filter(Boolean).join("，");
    return `- ${spelling}${label ? `（${label}）` : ""}：${types.map(describeType).join(" 或 · or ")}；${shape}`;
}

export function renderStoryCommandsPage(): string {
    const specs = listCommandSpecs();
    const lines = generatedHeader("故事命令 · Story commands", [
        `故事编辑器里输入 \`/\` 能用的 ${specs.length} 条命令，按命令菜单的分组排列。每条给出界面上的名称、说明、可输入的写法和参数。`,
        "",
        `The ${specs.length} commands the story editor offers after \`/\`, grouped as the command menu groups them.`,
    ]);
    for (const group of STORY_COMMAND_GROUPS) {
        const inGroup = specs.filter(spec => spec.category === group.id);
        if (inGroup.length === 0) {
            continue;
        }
        const groupKey = commandCategoryLabelKey(group.id);
        lines.push(`## ${bilingual(textOf("zh", groupKey), textOf("en", groupKey)) || group.id}`, "");
        for (const spec of inGroup) {
            const name = bilingual(textOf("zh", commandLabelKey(spec.id)), textOf("en", commandLabelKey(spec.id)));
            lines.push(`### /${spec.token}${name ? ` · ${name}` : ""}`, "");
            const zh = oneLine(textOf("zh", commandDetailKey(spec.id)));
            const en = oneLine(textOf("en", commandDetailKey(spec.id)));
            if (zh) {
                lines.push(zh, "");
            }
            if (en && en !== zh) {
                lines.push(en, "");
            }
            if (spec.aliases && spec.aliases.length > 0) {
                lines.push(`- 也可以写 · Also typed as：${spec.aliases.map(alias => `\`/${alias}\``).join("、")}`);
            }
            const params = Object.entries(spec.params as Record<string, StoryCommandParamSpec>);
            lines.push(...params.map(([paramName, param]) => describeParam(paramName, param)));
            lines.push("");
        }
    }
    return joinLines(lines);
}
