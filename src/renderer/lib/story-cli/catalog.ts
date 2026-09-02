/**
 * The command catalogue, read straight off the spec registry.
 *
 * Every command a story row can carry is one `defineStoryCommand` call under
 * `apps/workspace/modules/story/scene-editor/commands/specs/`, and that spec already states its
 * token, its params with their types, which of them are required, and worked examples. So this file
 * never restates any of it - it formats what the registry answers. A command added there is in
 * `story commands` on the next run, and a param renamed there renames here.
 *
 * What a command BUILDS is derived the same way rather than tabulated: `spec.build({}, …)` with no
 * args is the call the slash menu makes to get a default block, so running it says which block kind
 * and action the command lands, with nothing to keep in step.
 *
 * Comments in English per project convention.
 */

import type { StoryBlock } from "@shared/types/story";
import {
    findParam,
    paramHintKey,
    paramTypes,
    type StoryCommandDef,
    type StoryCommandParam,
    type StoryCommandParamType,
} from "@/apps/workspace/modules/story/scene-editor/storyCommandGrammar";
import { STORY_COMMAND_GROUPS } from "@/apps/workspace/modules/story/scene-editor/storyCommandCategories";
import {
    getCommandDef,
    getCommandSpec,
    listCommandDefs,
    listCommandSpecs,
    type AnyStoryCommandSpec,
} from "@/apps/workspace/modules/story/scene-editor/commands/registry";
import { buildStoryCommandContext } from "@/apps/workspace/modules/story/scene-editor/storyCommandContext";
// The family's spelling help, which lives in the interface tool because that is where it was
// first written. Imported rather than copied: a third Levenshtein in this repository would be
// two too many.
import { nearest } from "../ui-cli/text";

export const COMMAND_CATEGORIES: readonly string[] = STORY_COMMAND_GROUPS.map(group => group.id);

export type CommandSummary = {
    token: string;
    id: string;
    category: string;
    aliases: readonly string[];
    /** The first example the spec carries, which is the shortest true statement of its shape. */
    example: string | null;
};

export type CommandParamDetail = {
    name: string;
    hint: string;
    aliases: readonly string[];
    positional: boolean;
    core: boolean;
    greedy: boolean;
    skippable: boolean;
    /** One line per branch of a union type, in the order the spec declares them. */
    types: readonly string[];
};

export type CommandDetail = {
    token: string;
    id: string;
    category: string;
    aliases: readonly string[];
    params: readonly CommandParamDetail[];
    examples: readonly string[];
    /** `kind/action` of the block a bare invocation builds, or null when the spec builds nothing. */
    builds: string | null;
    /** What the command scaffolds after commit: a condition's branch, or a choice's first option. */
    scaffold: string | null;
};

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Every word a search may match a command by.
 *
 * The examples are in deliberately: a spec's examples name the things it acts on (`forest_day`,
 * `gold`), so searching for a concept finds the command that touches it even when neither the token
 * nor the param names carry the word.
 */
function searchWordsOf(spec: AnyStoryCommandSpec): string {
    const params = Object.entries(spec.params).map(([name, param]) => `${name} ${param.hint ?? ""}`);
    return [spec.token, spec.id, ...(spec.aliases ?? []), spec.category, ...params, ...(spec.examples ?? [])]
        .join(" ")
        .toLowerCase();
}

export function queryCommands(options: { search?: string; category?: string } = {}): CommandSummary[] {
    const search = options.search?.trim().toLowerCase();
    return listCommandSpecs()
        .filter(spec => !options.category || spec.category === options.category)
        .filter(spec => !search || searchWordsOf(spec).includes(search))
        .map(spec => ({
            token: spec.token,
            id: spec.id,
            category: spec.category,
            aliases: spec.aliases ?? [],
            example: spec.examples?.[0] ?? null,
        }))
        .sort((a, b) => a.category.localeCompare(b.category) || a.token.localeCompare(b.token));
}

/**
 * One command by token, id, or alias - the three spellings the parser itself accepts.
 *
 * A search that leaves exactly one command standing resolves too, so `story command background`
 * answers for `/bg` without the caller having to know which of the two is the token.
 */
export function describeCommand(query: string): CommandDetail | null {
    const trimmed = query.trim().replace(/^\//, "");
    if (!trimmed) {
        return null;
    }
    const def = getCommandDef(trimmed);
    if (def) {
        return detailOf(def);
    }
    const matches = queryCommands({ search: trimmed });
    if (matches.length !== 1) {
        return null;
    }
    const only = getCommandDef(matches[0].token);
    return only ? detailOf(only) : null;
}

/**
 * The spellings closest to a word that named no command.
 *
 * Over every spelling the parser accepts - token, id and alias - rather than tokens alone, because
 * the miss worth answering is usually a misspelt long word: `backgrund` is one edit from
 * `background` and six from `bg`, so a search over tokens would have nothing to offer for it.
 */
export function nearestCommands(query: string): string[] {
    const spellings = listCommandDefs().flatMap(def => [def.token, def.commandId, ...(def.aliases ?? [])]);
    return nearest(query.replace(/^\//, ""), [...new Set(spellings)], 3);
}

function detailOf(def: StoryCommandDef): CommandDetail {
    const spec = getCommandSpec(def.commandId);
    return {
        token: def.token,
        id: def.commandId,
        category: spec?.category ?? "",
        aliases: def.aliases ?? [],
        params: def.params.map(paramDetail),
        examples: spec?.examples ?? [],
        builds: spec ? blockShapeOf(spec) : null,
        scaffold: spec?.scaffold ?? null,
    };
}

function paramDetail(param: StoryCommandParam): CommandParamDetail {
    return {
        name: param.name,
        hint: paramHintKey(param),
        aliases: param.aliases ?? [],
        positional: param.positional === true,
        core: param.core === true,
        greedy: param.greedy === true,
        skippable: param.skippable === true,
        types: paramTypes(param).map(describeParamType),
    };
}

/**
 * The block a bare invocation lands, as `kind/action`.
 *
 * `build` is documented to return a valid block for any args, including none - that is the call the
 * slash menu makes - so this is the registry answering rather than a table beside it. A spec whose
 * build throws on empty args reports nothing rather than taking the command down: the catalogue is
 * the surface an author reaches for when something is already wrong.
 */
function blockShapeOf(spec: AnyStoryCommandSpec): string | null {
    if (!spec.build) {
        return null;
    }
    let counter = 0;
    const context = buildStoryCommandContext({
        assets: undefined,
        characters: [],
        document: null,
        sceneId: null,
        scene: null,
    });
    let block: StoryBlock;
    try {
        block = spec.build({}, { generateId: () => `catalog_${counter++}`, context });
    } catch {
        return null;
    }
    const action = (block as { payload?: { action?: string } }).payload?.action;
    return action ? `${block.kind}/${action}` : block.kind;
}

/**
 * A param type as one readable clause.
 *
 * Spelled out rather than printed as the raw discriminant, because the discriminant is a payload
 * word: `characterForm` is what the grammar calls it and "a pose or tag of <param>" is what the
 * author has to type. Every branch that depends on another param says which one, since that
 * dependency is the difference between a slot with candidates and a slot with none.
 */
export function describeParamType(type: StoryCommandParamType): string {
    switch (type.kind) {
        case "asset":
            return `${type.assetType} asset${type.allowSets ? " or asset set" : ""}`;
        case "character":
            return type.allowTemp ? "character, or a bare name for a one-off speaker" : "character";
        case "characterForm":
            return `a pose or tag of the character in "${type.dependsOn}"`;
        case "puppetName":
            return `a ${type.channel} named by the model behind "${type.dependsOn}" (free text)`;
        case "puppetParam":
            return `a parameter of the model behind "${type.dependsOn}"`;
        case "scene":
            return "scene";
        case "audioTrack":
            return "audio track";
        case "label":
            return "a label row in this scene";
        case "appTag":
            return "build variant";
        case "surface":
            return "UI page";
        case "variable":
            return "variable";
        case "target": {
            const reserved = type.reserved?.length ? `, or ${type.reserved.join(" / ")}` : "";
            const refuses = type.refuses?.length ? ` (refuses ${type.refuses.join(", ")})` : "";
            return `stage object: ${type.accepts.join(" / ")}${reserved}${refuses}`;
        }
        case "content":
            return `new content, typed by what "${type.dependsOn}" resolved to`;
        case "enum": {
            const words = type.options.map(option => option.value).join(" | ");
            return `${words}${type.freeform ? " (or one free-form value)" : ""}`;
        }
        case "keyword":
            return `the word "${type.value}"`;
        case "number": {
            const bounds = [
                type.min !== undefined ? `min ${type.min}` : null,
                type.max !== undefined ? `max ${type.max}` : null,
                type.integer ? "integer" : null,
                type.unit ? `may be written with "${type.unit}"` : null,
            ].filter(Boolean);
            return bounds.length > 0 ? `number, ${bounds.join(", ")}` : "number";
        }
        case "boolean":
            return "boolean";
        case "color":
            return "colour";
        case "literal":
            return "any scalar - checked once the slot it belongs to resolves";
        case "constant":
            return "constant";
        case "text":
            return "text";
        case "expression":
            return "expression";
        default: {
            // A new grammar kind reaches the catalogue before anything else, so it names itself
            // rather than vanishing from the one surface an author consults about it.
            const unknown = type as { kind: string };
            return unknown.kind;
        }
    }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatCommandList(commands: readonly CommandSummary[], limit: number): string {
    if (commands.length === 0) {
        return "Nothing matches.";
    }
    const shown = limit > 0 ? commands.slice(0, limit) : commands;
    const width = Math.max(...shown.map(command => command.token.length)) + 2;
    const lines: string[] = [];
    let category = "";
    for (const command of shown) {
        if (command.category !== category) {
            category = command.category;
            lines.push(lines.length > 0 ? `\n${category}` : category);
        }
        const aliases = command.aliases.length > 0 ? `  (${command.aliases.join(", ")})` : "";
        lines.push(`  /${command.token.padEnd(width)}${command.example ?? ""}${aliases}`);
    }
    if (limit > 0 && commands.length > shown.length) {
        lines.push(`\n${commands.length} matches, ${commands.length - shown.length} not shown. --limit 0 for all.`);
    }
    return lines.join("\n");
}

export function formatCommandDetail(detail: CommandDetail): string {
    const lines: string[] = [`/${detail.token}`];
    lines.push(`  id         ${detail.id}`);
    lines.push(`  category   ${detail.category}`);
    if (detail.aliases.length > 0) {
        lines.push(`  aliases    ${detail.aliases.map(alias => `/${alias}`).join(", ")}`);
    }
    if (detail.builds) {
        lines.push(`  builds     ${detail.builds}`);
    }
    if (detail.scaffold) {
        lines.push(
            `  scaffold   ${detail.scaffold === "condition" ? "an if-branch under the row" : "a first option under the row"}`,
        );
    }

    const positional = detail.params.filter(param => param.positional);
    const named = detail.params.filter(param => !param.positional);
    if (positional.length > 0) {
        lines.push("", "  positional (in this order)");
        lines.push(...positional.map(param => formatParam(param, false)));
    }
    if (named.length > 0) {
        lines.push("", "  named (key=value, any order)");
        lines.push(...named.map(param => formatParam(param, true)));
    }
    if (detail.examples.length > 0) {
        lines.push("", "  examples");
        lines.push(...detail.examples.map(example => `    ${example}`));
    }
    return lines.join("\n");
}

function formatParam(param: CommandParamDetail, named: boolean): string {
    const marks = [
        param.core ? "required" : null,
        param.greedy ? "takes the rest of the line" : null,
        param.skippable ? "may be left out" : null,
    ].filter(Boolean);
    const aliases = param.aliases.length > 0 ? ` [also ${param.aliases.join(", ")}]` : "";
    const head = `    ${named ? `${param.name}=` : `<${param.name}>`}${aliases}`;
    const tail = marks.length > 0 ? `  - ${marks.join(", ")}` : "";
    // A union prints one branch per line under the name: the branches are alternatives, and running
    // them together on one line reads as a single compound type.
    const types = param.types.length === 1
        ? param.types[0]
        : param.types.map(type => `\n        ${type}`).join("");
    // Padded to a column, but never glued to the name: a long name with aliases overruns the column
    // and still has to be a space away from its type.
    return `${head.padEnd(28)}${head.length >= 28 ? "  " : ""}${types}${tail}`;
}

export function formatCategories(): string {
    const counts = new Map<string, number>();
    for (const command of queryCommands()) {
        counts.set(command.category, (counts.get(command.category) ?? 0) + 1);
    }
    return COMMAND_CATEGORIES.map(id => `  ${id.padEnd(12)}${counts.get(id) ?? 0}`).join("\n");
}

/** Named-param lookup, exposed for the checker so it reports the same name the parser reads. */
export { findParam };
