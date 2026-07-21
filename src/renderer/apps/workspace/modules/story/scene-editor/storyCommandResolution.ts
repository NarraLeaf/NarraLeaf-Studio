import type { StoryLiteralValue, StoryVariableRef, StoryVariableValueType } from "@shared/types/story";
import { storyVariableRefKey } from "@shared/types/story";
import { inferStoryExpressionType } from "@shared/utils/storyExpressionEval";
import type { StoryExpressionScope } from "@shared/utils/storyExpressionParser";
import { createStoryExpressionScope, formatStoryExpressionName, parseStoryExpression } from "@shared/utils/storyExpressionParser";
import {
    allowsFreeValue,
    paramTypes,
    matchEnumOption,
    type StoryCommandParam,
    type StoryCommandParamType,
} from "./storyCommandGrammar";
import type { StoryCommandLine, StoryCommandSpan } from "./storyCommandParser";
import { getCommandSpec } from "./commands/registry";
import type {
    StoryCommandContext,
    StoryCommandNamedRef,
    StoryCommandResolution,
    StoryCommandResolutionIssue,
    StoryCommandStageObjectKind,
    StoryCommandTargetValue,
    StoryCommandValue,
} from "./storyCommandValues";
import { BGM_OBJECT_NAME } from "./storyCommandValues";

/**
 * Resolution: parsed args → values the payload can hold.
 *
 * This is the half the parser deliberately cannot do. It turns author-typed *names* into the *ids*
 * the document stores, and performs every check that needs project state - does this asset exist, is
 * `100` a legal value for `gold`. An arg that parses is not yet an arg that resolves.
 *
 * Still pure: the project is injected as {@link StoryCommandContext}, never read from a service here.
 * The same context is what the candidate list reads, so the two can never disagree about what a name
 * means. Command-specific checks live on the specs (`validate` / `deriveArgs`) - this layer stays
 * generic and calls them blind.
 */

export type {
    StoryCommandContext,
    StoryCommandNamedRef,
    StoryCommandResolution,
    StoryCommandResolutionIssue,
    StoryCommandStageObjectKind,
    StoryCommandTargetValue,
    StoryCommandValue,
} from "./storyCommandValues";
export type { StoryCommandVariableEntry, StoryCommandStageObjects, StoryCommandResolvedArgs } from "./storyCommandValues";
export { EMPTY_STORY_COMMAND_CONTEXT, EMPTY_STORY_COMMAND_STAGE_OBJECTS } from "./storyCommandValues";

/**
 * Exact, case-insensitive match by name.
 *
 * Returns "ambiguous" rather than guessing when a name is not unique: asset names are not unique in a
 * project, and a command line addresses them by name, so `/bg forest` with two "forest" images does
 * not say which. Picking the first would silently bind to whichever happened to sort first and change
 * under the author later. Failing loudly is the honest answer.
 */
function findByName(entries: readonly StoryCommandNamedRef[], raw: string): StoryCommandNamedRef | "ambiguous" | null {
    const needle = raw.trim().toLowerCase();
    const matches = entries.filter(entry => entry.name.trim().toLowerCase() === needle);
    if (matches.length === 0) {
        return null;
    }
    return matches.length > 1 ? "ambiguous" : matches[0];
}

/** Parse a bare token into the scalar it denotes: `true` / `12` / anything else stays a string. */
export function parseLiteral(raw: string): StoryLiteralValue {
    const trimmed = raw.trim();
    if (trimmed === "true") {
        return true;
    }
    if (trimmed === "false") {
        return false;
    }
    if (trimmed !== "" && Number.isFinite(Number(trimmed))) {
        return Number(trimmed);
    }
    return raw;
}

function assetsOfType(context: StoryCommandContext, assetType: "image" | "audio" | "video"): readonly StoryCommandNamedRef[] {
    return assetType === "image" ? context.images : assetType === "audio" ? context.audio : context.videos;
}

/** The character an owner param resolved to, whether it came through a `character` or a `target` slot. */
function ownerCharacterId(owner: StoryCommandValue | undefined): string | null {
    if (owner?.kind === "character") {
        return owner.characterId;
    }
    if (owner?.kind === "target" && owner.target.type === "character") {
        return owner.target.characterId;
    }
    return null;
}

/**
 * Resolve a generic verb's subject: a character or a stage object, whichever `accepts` allows and
 * the name turns out to be. One name matching several worlds is ambiguous, not first-match.
 */
function resolveTarget(
    type: Extract<StoryCommandParamType, { kind: "target" }>,
    value: string,
    span: StoryCommandSpan,
    context: StoryCommandContext,
): { value: StoryCommandValue } | { issue: StoryCommandResolutionIssue } {
    const needle = value.trim().toLowerCase();
    const matches: StoryCommandTargetValue[] = [];

    if (type.accepts.includes("character")) {
        const found = context.characters.filter(entry => entry.name.trim().toLowerCase() === needle);
        if (found.length > 1) {
            return { issue: { code: "ambiguousName", span, value } };
        }
        if (found.length === 1) {
            matches.push({ type: "character", characterId: found[0].id, name: found[0].name });
        }
    }

    for (const kind of type.accepts) {
        if (kind === "character") {
            continue;
        }
        // The background-music channel answers to the reserved name; it is always "on stage".
        if (kind === "audio" && needle === BGM_OBJECT_NAME) {
            matches.push({ type: "stageObject", objectKind: "audio", name: BGM_OBJECT_NAME, known: true });
            continue;
        }
        const names = context.stageObjects[kind] ?? [];
        const found = names.find(name => name.trim().toLowerCase() === needle);
        if (found !== undefined) {
            matches.push({ type: "stageObject", objectKind: kind, name: found, known: true });
        }
    }

    if (matches.length > 1) {
        return { issue: { code: "ambiguousName", span, value } };
    }
    if (matches.length === 1) {
        return { value: { kind: "target", target: matches[0] } };
    }

    // Nothing on stage answers. A free-typed name can stand only where exactly one object kind is
    // possible (made dynamically, or in another scene); with several kinds there is nothing to
    // dispatch the block type on.
    const stageKinds = type.accepts.filter((kind): kind is StoryCommandStageObjectKind => kind !== "character");
    if (stageKinds.length === 1 && value.trim() !== "") {
        return { value: { kind: "target", target: { type: "stageObject", objectKind: stageKinds[0], name: value.trim(), known: false } } };
    }
    return { issue: { code: "unknownTarget", span, value } };
}

/** Resolve a `/swap` content by what its target turned out to be: an asset for image, words for text. */
function resolveContent(
    type: Extract<StoryCommandParamType, { kind: "content" }>,
    value: string,
    span: StoryCommandSpan,
    context: StoryCommandContext,
    resolved: Record<string, StoryCommandValue>,
): { value: StoryCommandValue } | { issue: StoryCommandResolutionIssue } {
    const owner = resolved[type.dependsOn];
    const target = owner?.kind === "target" ? owner.target : null;
    if (!target || target.type !== "stageObject" || target.objectKind === "text") {
        // Text content, or an unresolved target whose own issue already stands: pass the words through.
        return { value: { kind: "text", value } };
    }
    const assetType = target.objectKind === "video" ? "video" : "image";
    const found = findByName(assetsOfType(context, assetType), value);
    if (found === "ambiguous") {
        return { issue: { code: "ambiguousName", span, value } };
    }
    if (!found) {
        return { issue: { code: "unknownAsset", span, value, assetType } };
    }
    return { value: { kind: "asset", assetId: found.id } };
}

/**
 * Resolve one value against one branch of a param's type union. Returns the value, or an issue, or
 * `null` meaning "this branch does not accept it" so the caller can try the next branch.
 */
function resolveAgainstType(
    type: StoryCommandParamType,
    value: string,
    span: StoryCommandSpan,
    context: StoryCommandContext,
    resolved: Record<string, StoryCommandValue>,
): { value: StoryCommandValue } | { issue: StoryCommandResolutionIssue } | null {
    switch (type.kind) {
        case "asset": {
            const found = findByName(assetsOfType(context, type.assetType), value);
            if (found === "ambiguous") {
                return { issue: { code: "ambiguousName", span, value } };
            }
            return found ? { value: { kind: "asset", assetId: found.id } } : null;
        }
        case "color":
            return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim())
                ? { value: { kind: "color", color: value.trim() } }
                : null;
        case "character": {
            const found = findByName(context.characters, value);
            if (found === "ambiguous") {
                return { issue: { code: "ambiguousName", span, value } };
            }
            if (found) {
                return { value: { kind: "character", characterId: found.id } };
            }
            // No character by that name. A speaker may still stand as a bare name; a portrait may not.
            return type.allowTemp
                ? { value: { kind: "speakerName", speakerName: value.trim() } }
                : { issue: { code: "unknownCharacter", span, value } };
        }
        case "characterForm": {
            const characterId = ownerCharacterId(resolved[type.dependsOn]);
            if (!characterId) {
                // The owner is unresolved, a temp speaker, or a stage object - there are no forms to
                // check against. Not this param's error to report; the owner's own issue (or the
                // spec's validate) already stands.
                return { value: { kind: "characterForm", formName: value.trim() } };
            }
            const forms = context.formsByCharacterId[characterId] ?? [];
            const match = forms.find(form => form.trim().toLowerCase() === value.trim().toLowerCase());
            if (match) {
                return { value: { kind: "characterForm", formName: match } };
            }
            const characterName = context.characters.find(entry => entry.id === characterId)?.name ?? "";
            return { issue: { code: "unknownForm", span, value, characterName } };
        }
        case "scene": {
            const found = findByName(context.scenes, value);
            if (found === "ambiguous") {
                return { issue: { code: "ambiguousName", span, value } };
            }
            return found ? { value: { kind: "scene", sceneId: found.id } } : { issue: { code: "unknownScene", span, value } };
        }
        case "variable": {
            const needle = value.trim().toLowerCase();
            const matches = context.variables.filter(entry => entry.name.trim().toLowerCase() === needle);
            if (matches.length > 1) {
                return { issue: { code: "ambiguousName", span, value } };
            }
            if (matches.length === 0) {
                return { issue: { code: "unknownVariable", span, value } };
            }
            return { value: { kind: "variable", ref: matches[0].ref, valueType: matches[0].valueType, name: matches[0].name, defaultValue: matches[0].defaultValue } };
        }
        case "target":
            return resolveTarget(type, value, span, context);
        case "content":
            return resolveContent(type, value, span, context, resolved);
        case "enum": {
            const option = matchEnumOption(type, value);
            // Normalizing the alias to its canonical value happens here, not in the parser: the parser
            // stays faithful to what was typed, the payload gets what it can store.
            return option ? { value: { kind: "enum", value: option.value } } : null;
        }
        case "keyword":
            return value.trim().toLowerCase() === type.value.toLowerCase()
                ? { value: { kind: "keyword", value: type.value } }
                : null;
        case "number": {
            const parsed = Number(value);
            return value.trim() !== "" && Number.isFinite(parsed) ? { value: { kind: "number", value: parsed } } : null;
        }
        case "boolean": {
            // The human spellings collapse to the canonical pair here (bible B5).
            const normalized = value.trim().toLowerCase();
            if (["true", "on", "yes"].includes(normalized)) {
                return { value: { kind: "boolean", value: true } };
            }
            if (["false", "off", "no"].includes(normalized)) {
                return { value: { kind: "boolean", value: false } };
            }
            return null;
        }
        case "literal":
        // A constant resolves exactly like a literal - the difference between them is what each
        // *offers* and what each *forbids*, both of which are settled before we get here.
        case "constant":
            return { value: { kind: "literal", value: parseLiteral(value) } };
        case "expression":
            return resolveExpression(type, value, span, context, resolved);
        case "text":
            return { value: { kind: "text", value } };
    }
}

/**
 * Parse an expression against the variables this project declares.
 *
 * The compound-assignment sugar is desugared here rather than in the expression language, because
 * `+=` is a property of *assignment*, not of values. Rewriting `/set gold += 1` into the source
 * `gold + (1)` also means the stored tree is exactly the one the longhand would have produced.
 */
function resolveExpression(
    type: Extract<StoryCommandParamType, { kind: "expression" }>,
    value: string,
    span: StoryCommandSpan,
    context: StoryCommandContext,
    resolved: Record<string, StoryCommandValue>,
): { value: StoryCommandValue } | { issue: StoryCommandResolutionIssue } {
    let source = value;
    const compound = type.assignTo ? matchCompoundAssignment(value) : null;
    if (compound) {
        const target = resolved[type.assignTo!];
        if (target?.kind !== "variable") {
            // `+= 1` with no variable to add to: the target's own issue already stands, and inventing
            // a second one here would double-report the same mistake.
            return { issue: { code: "compoundWithoutTarget", span, value } };
        }
        // The name goes back through the expression lexer, so it must be spelled the way the lexer
        // reads one reference: bare when it can be, `'…'`-quoted when a space or dot would split it.
        source = `${formatStoryExpressionName(target.name)} ${compound.op} (${compound.rest})`;
    }

    const { expression, issues } = parseStoryExpression(source, expressionScope(context));
    if (issues.length > 0) {
        return { issue: { code: "expressionError", span, value: source, issue: issues[0] } };
    }

    if (type.expects === "boolean") {
        const inferred = inferStoryExpressionType(expression.ast, ref => variableTypeOf(context, ref));
        // `unknown` passes: a `json` variable or a mixed ternary defeats inference, and refusing a
        // correct condition is worse than letting a truthy number through.
        if (inferred !== "boolean" && inferred !== "unknown") {
            return { issue: { code: "expressionNotBoolean", span, value: source, received: inferred } };
        }
    }

    return { value: { kind: "expression", expression, source } };
}

/** `+= 1` → `{ op: "+", rest: "1" }`. Anything else is an ordinary expression. */
function matchCompoundAssignment(value: string): { op: "+" | "-" | "*" | "/"; rest: string } | null {
    const match = /^\s*([+\-*/])=\s*(.*)$/.exec(value);
    return match && match[2].trim() !== "" ? { op: match[1] as "+" | "-" | "*" | "/", rest: match[2] } : null;
}

/** The scope chain an expression's identifiers resolve through, built from the same context everything else reads. */
export function expressionScope(context: StoryCommandContext): StoryExpressionScope {
    return createStoryExpressionScope(context.variables.map(entry => ({ name: entry.name, ref: entry.ref })));
}

function variableTypeOf(context: StoryCommandContext, ref: StoryVariableRef): StoryVariableValueType | undefined {
    const key = storyVariableRefKey(ref);
    return context.variables.find(entry => storyVariableRefKey(entry.ref) === key)?.valueType;
}

/**
 * Resolve every arg on a parsed command line.
 *
 * Params resolve in grammar order so a dependent param (a form, a swap's content) sees the value it
 * depends on already resolved. After the generic pass, the owning spec gets its say: `deriveArgs`
 * fills what the author may omit (auto-names), `validate` reports what no single param can know.
 */
export function resolveCommandLine(line: StoryCommandLine, context: StoryCommandContext): StoryCommandResolution {
    const issues: StoryCommandResolutionIssue[] = [];
    const resolved: Record<string, StoryCommandValue> = {};
    if (line.kind !== "command" || !line.def) {
        return { args: resolved, issues };
    }

    for (const param of line.def.params) {
        const arg = line.args.find(candidate => candidate.param?.name === param.name);
        if (!arg || !arg.value) {
            continue;
        }
        const outcome = resolveParam(param, arg.value, arg.valueSpan, context, resolved);
        if ("issue" in outcome) {
            issues.push(outcome.issue);
            continue;
        }
        resolved[param.name] = outcome.value;
    }

    const spec = getCommandSpec(line.def.commandId);
    if (spec?.deriveArgs) {
        Object.assign(resolved, spec.deriveArgs(resolved, context));
    }
    if (spec?.validate) {
        const spanOf = (paramName: string): StoryCommandSpan | undefined =>
            line.args.find(arg => arg.param?.name === paramName)?.valueSpan;
        issues.push(...spec.validate(resolved, { context, spanOf }));
    }

    return { args: resolved, issues };
}

function resolveParam(
    param: StoryCommandParam,
    value: string,
    span: StoryCommandSpan,
    context: StoryCommandContext,
    resolved: Record<string, StoryCommandValue>,
): { value: StoryCommandValue } | { issue: StoryCommandResolutionIssue } {
    const types = paramTypes(param);
    const deferred: StoryCommandResolutionIssue[] = [];
    for (const type of types) {
        const outcome = resolveAgainstType(type, value, span, context, resolved);
        if (outcome && "value" in outcome) {
            return outcome;
        }
        if (outcome && "issue" in outcome) {
            // Hold it: another branch of the union may still accept the value.
            deferred.push(outcome.issue);
        }
    }
    if (deferred.length > 0) {
        return { issue: deferred[0] };
    }
    // Nothing accepted and nothing complained. Report against the first branch that must resolve;
    // if every branch tolerates a free value there is nothing to report.
    const strict = types.find(type => !allowsFreeValue(type));
    if (!strict) {
        return { value: { kind: "text", value } };
    }
    return { issue: issueForUnresolvable(strict, value, span) };
}

function issueForUnresolvable(type: StoryCommandParamType, value: string, span: StoryCommandSpan): StoryCommandResolutionIssue {
    switch (type.kind) {
        case "asset":
            return { code: "unknownAsset", span, value, assetType: type.assetType };
        case "scene":
            return { code: "unknownScene", span, value };
        case "variable":
            return { code: "unknownVariable", span, value };
        case "target":
            return { code: "unknownTarget", span, value };
        default:
            return { code: "unknownCharacter", span, value };
    }
}
