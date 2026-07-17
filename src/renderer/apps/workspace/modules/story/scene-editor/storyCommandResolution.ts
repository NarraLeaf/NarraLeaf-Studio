import type { StoryLiteralValue, StoryVariableRef, StoryVariableValueType } from "@shared/types/story";
import {
    allowsFreeValue,
    matchEnumOption,
    paramTypes,
    type StoryCommandParam,
    type StoryCommandParamType,
} from "./storyCommandGrammar";
import type { StoryCommandLine, StoryCommandSpan } from "./storyCommandParser";

/**
 * Resolution: parsed args → values the payload can hold.
 *
 * This is the half the parser deliberately cannot do. It turns author-typed *names* into the *ids*
 * the document stores, and performs every check that needs project state — does this asset exist, is
 * `100` a legal value for `gold`. An arg that parses is not yet an arg that resolves.
 *
 * Still pure: the project is injected as {@link StoryCommandContext}, never read from a service here.
 * The same context is what the candidate list will read, so the two can never disagree about what a
 * name means — see the plan's §3.3.
 */

export type StoryCommandNamedRef = { id: string; name: string };

export type StoryCommandVariableEntry = {
    name: string;
    ref: StoryVariableRef;
    valueType: StoryVariableValueType;
};

/** The five kinds of named object a `show`/`hide`/`set` command can address by `objectName`. */
export type StoryCommandStageObjectKind = "image" | "text" | "layer" | "video" | "audio";

/** The object names on stage, per kind — the candidate source for `{ kind: "stageObject" }` params. */
export type StoryCommandStageObjects = Readonly<Record<StoryCommandStageObjectKind, readonly string[]>>;

export const EMPTY_STORY_COMMAND_STAGE_OBJECTS: StoryCommandStageObjects = {
    image: [], text: [], layer: [], video: [], audio: [],
};

export type StoryCommandContext = {
    images: readonly StoryCommandNamedRef[];
    audio: readonly StoryCommandNamedRef[];
    videos: readonly StoryCommandNamedRef[];
    characters: readonly StoryCommandNamedRef[];
    /**
     * Bare speaker names already used somewhere in this story. They back no character record, so they
     * carry no id — but they are what the speaker picker offers between the real characters and the
     * name being typed, and the command line must offer the same list.
     */
    tempSpeakers: readonly string[];
    scenes: readonly StoryCommandNamedRef[];
    variables: readonly StoryCommandVariableEntry[];
    /** Form / appearance names per character id — the candidates for `form=`, which only exist once the character resolves. */
    formsByCharacterId: Readonly<Record<string, readonly string[]>>;
    /** Named objects on stage in the current scene, per kind — the picker `/imgshow`, `/settext`, `/stop` lead with. */
    stageObjects: StoryCommandStageObjects;
};

export const EMPTY_STORY_COMMAND_CONTEXT: StoryCommandContext = {
    images: [], audio: [], videos: [], characters: [], tempSpeakers: [], scenes: [], variables: [], formsByCharacterId: {},
    stageObjects: EMPTY_STORY_COMMAND_STAGE_OBJECTS,
};

export type StoryCommandValue =
    | { kind: "asset"; assetId: string }
    | { kind: "color"; color: string }
    | { kind: "character"; characterId: string }
    /** A name backing no character — legal only where the param opted in via `allowTemp`. */
    | { kind: "speakerName"; speakerName: string }
    | { kind: "characterForm"; formName: string }
    | { kind: "scene"; sceneId: string }
    | { kind: "variable"; ref: StoryVariableRef; valueType: StoryVariableValueType }
    | { kind: "enum"; value: string }
    | { kind: "keyword"; value: string }
    | { kind: "number"; value: number }
    | { kind: "boolean"; value: boolean }
    | { kind: "literal"; value: StoryLiteralValue }
    | { kind: "text"; value: string };

export type StoryCommandResolvedArgs = Readonly<Record<string, StoryCommandValue>>;

export type StoryCommandResolutionIssue =
    | { code: "unknownAsset"; span: StoryCommandSpan; value: string; assetType: "image" | "audio" | "video" }
    | { code: "unknownCharacter"; span: StoryCommandSpan; value: string }
    | { code: "unknownScene"; span: StoryCommandSpan; value: string }
    | { code: "unknownVariable"; span: StoryCommandSpan; value: string }
    | { code: "unknownForm"; span: StoryCommandSpan; value: string; characterName: string }
    /** Two things share this name, so the line does not say which one. See the note on `findByName`. */
    | { code: "ambiguousName"; span: StoryCommandSpan; value: string }
    /** `/set gold true` where `gold` is a number. The dependent type, finally checked. */
    | { code: "valueTypeMismatch"; span: StoryCommandSpan; value: string; expected: StoryVariableValueType }
    /**
     * Two args that a one-op-per-block command cannot honour together — `/font title 48 color=#f00`
     * would set the size and silently drop the colour. Faulting keeps the line uncommitted (author
     * splits it into two) rather than losing the second value without a word.
     */
    | { code: "conflictingParams"; span: StoryCommandSpan; keys: readonly string[] };

export type StoryCommandResolution = {
    args: StoryCommandResolvedArgs;
    issues: StoryCommandResolutionIssue[];
};

/**
 * Exact, case-insensitive match by name.
 *
 * Returns "ambiguous" rather than guessing when a name is not unique: asset names are not unique in a
 * project, and a command line addresses them by name, so `/bg forest` with two "forest" images does
 * not say which. Picking the first would silently bind to whichever happened to sort first and change
 * under the author later. Failing loudly is the honest answer — see the plan's §8 for the gap this
 * leaves.
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

function literalMatchesType(value: StoryLiteralValue, valueType: StoryVariableValueType): boolean {
    switch (valueType) {
        case "boolean":
            return typeof value === "boolean";
        case "number":
            return typeof value === "number";
        case "string":
            return typeof value === "string";
        case "json":
            return true;
    }
}

function assetsOfType(context: StoryCommandContext, assetType: "image" | "audio" | "video"): readonly StoryCommandNamedRef[] {
    return assetType === "image" ? context.images : assetType === "audio" ? context.audio : context.videos;
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
            const owner = resolved[type.dependsOn];
            if (!owner || owner.kind !== "character") {
                // The character is unresolved or is a temp speaker, so there are no forms to check
                // against. Not this param's error to report — the character's own issue already stands.
                return { value: { kind: "characterForm", formName: value.trim() } };
            }
            const forms = context.formsByCharacterId[owner.characterId] ?? [];
            const match = forms.find(form => form.trim().toLowerCase() === value.trim().toLowerCase());
            if (match) {
                return { value: { kind: "characterForm", formName: match } };
            }
            const characterName = context.characters.find(entry => entry.id === owner.characterId)?.name ?? "";
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
            return { value: { kind: "variable", ref: matches[0].ref, valueType: matches[0].valueType } };
        }
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
            const normalized = value.trim().toLowerCase();
            return normalized === "true" || normalized === "false"
                ? { value: { kind: "boolean", value: normalized === "true" } }
                : null;
        }
        case "displayable":
            // Displayables are static and bound to their creator block; resolving one needs the scene
            // graph, which arrives with the displayable candidate work. No P0 command uses it.
            return null;
        case "stageObject":
            // The name a `show`/`hide`/`set` addresses is just a string the payload stores as `objectName`
            // — no binding to resolve. A free-typed name is legal (see `allowsFreeValue`), so this always
            // succeeds; the candidate list is what makes it a pick rather than a guess. Carried as a text
            // value so `applyArgs` writes it exactly as it writes a `create`'s free name.
            return { value: { kind: "text", value: value.trim() } };
        case "literal":
        // A dependent value carries the same literal the payload stores; the candidate list is the only
        // thing `dependsOn` changes. The type check against the variable happens in the post-pass below.
        case "variableValue":
            return { value: { kind: "literal", value: parseLiteral(value) } };
        case "text":
            return { value: { kind: "text", value } };
    }
}

/**
 * Resolve every arg on a parsed command line.
 *
 * Params resolve in grammar order so a dependent param (`form=`) sees the value it depends on
 * (`character`) already resolved.
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

    // `/set gold true` where `gold` is a number: only checkable now that both params have resolved.
    const target = resolved.variable;
    const literal = resolved.value;
    if (target?.kind === "variable" && literal?.kind === "literal" && !literalMatchesType(literal.value, target.valueType)) {
        const span = line.args.find(arg => arg.param?.name === "value")?.valueSpan;
        if (span) {
            issues.push({ code: "valueTypeMismatch", span, value: String(literal.value), expected: target.valueType });
        }
    }

    autoNameCreatedObject(line.def.commandId, resolved, context);

    // `/font title 48 color=#f00`: one block runs one op, so honouring both is impossible. Fault on the
    // colour rather than let `applyArgs` keep the size and drop the colour on the floor.
    if (line.def.commandId === "textFont" && resolved.size?.kind === "number" && resolved.color?.kind === "color") {
        const span = line.args.find(arg => arg.param?.name === "color")?.valueSpan;
        if (span) {
            issues.push({ code: "conflictingParams", span, keys: ["size", "color"] });
        }
    }

    return { args: resolved, issues };
}

/**
 * A `create` command whose object the author need not name: what to derive the name from, and the list
 * to dedupe it against. `assetParam` is the positional whose filename seeds the name (image/video);
 * text and layer have no asset, so they fall back to `base`.
 */
const CREATE_AUTO_NAME: Record<string, { stageKind: StoryCommandStageObjectKind; assetParam?: string; base: string }> = {
    imageCreate: { stageKind: "image", assetParam: "image", base: "image" },
    videoCreate: { stageKind: "video", assetParam: "video", base: "video" },
    textCreate: { stageKind: "text", base: "text" },
    layerCreate: { stageKind: "layer", base: "layer" },
};

/**
 * Fill in the object name a `create` line left blank, so `/image forest.png` lands an image called
 * `forest` — the same "no name needed" feel as `/bg`. Derived from the asset's filename when there is
 * one, else a deduped default, so two `/text` lines become `text` and `text2` rather than colliding.
 * Skipped when the author named it (`name=`) — their choice wins.
 */
function autoNameCreatedObject(commandId: string, resolved: Record<string, StoryCommandValue>, context: StoryCommandContext): void {
    const spec = CREATE_AUTO_NAME[commandId];
    if (!spec || resolved.name) {
        return;
    }
    const asset = spec.assetParam ? resolved[spec.assetParam] : undefined;
    const seed = asset?.kind === "asset" ? assetBaseName(context, spec.stageKind, asset.assetId) ?? spec.base : spec.base;
    resolved.name = { kind: "text", value: dedupeObjectName(seed, context.stageObjects[spec.stageKind]) };
}

/** The asset's display name without its extension — `forest.png` → `forest` — or null when unknown. */
function assetBaseName(context: StoryCommandContext, stageKind: StoryCommandStageObjectKind, assetId: string): string | null {
    const list = stageKind === "video" ? context.videos : context.images;
    const found = list.find(entry => entry.id === assetId);
    const base = found?.name.replace(/\.[^./\\]+$/, "").trim();
    return base ? base : null;
}

/** `base`, or `base2`, `base3`… — the first not already taken (case-insensitive) by an object on stage. */
function dedupeObjectName(base: string, existing: readonly string[]): string {
    const taken = new Set(existing.map(name => name.trim().toLowerCase()));
    if (!taken.has(base.trim().toLowerCase())) {
        return base;
    }
    for (let suffix = 2; ; suffix += 1) {
        const candidate = `${base}${suffix}`;
        if (!taken.has(candidate.toLowerCase())) {
            return candidate;
        }
    }
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
        default:
            return { code: "unknownCharacter", span, value };
    }
}
