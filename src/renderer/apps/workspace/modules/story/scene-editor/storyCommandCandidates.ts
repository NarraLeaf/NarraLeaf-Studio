import { STORY_EXPR_FUNCTIONS, STORY_VISITED_CALLS, type StoryVariableValueType, type StoryVisitedCall } from "@shared/types/story";
import { formatStoryExpressionName } from "@shared/utils/storyExpressionParser";
import { freeTargetKind, paramHintKey, paramTypes, type StoryCommandParam, type StoryCommandParamType } from "./storyCommandGrammar";
import { listCommandDefs } from "./commands/registry";
import { localizedParamKey, paramMatchesQuery } from "./commands/localizedParams";
import { localizedEnumValue, matchEnumOptionLocalized } from "./commands/localizedEnums";
import type { StoryCommandCursor } from "./storyCommandCursor";
import { BGM_OBJECT_NAME, puppetChannelNames, type StoryCommandContext, type StoryCommandNamedRef, type StoryCommandStageObjectKind, type StoryPuppetChannel, type StoryCommandValue } from "./storyCommandValues";

/**
 * What to offer at the caret.
 *
 * Reads the same {@link StoryCommandContext} the resolver reads, so the list can never offer a name
 * that then fails to resolve, nor hide one that would have.
 *
 * Pure, and free of display strings: a command candidate carries its `commandId` so the caller can
 * translate it through the `story.command.<id>.label` catalog. The grammar holds no locale data.
 */

/**
 * What a candidate IS — read by the menu to draw its leading mark.
 *
 * Structural, never visual: the kind is named here, the glyph and the picture are chosen in the view
 * layer (`storyCandidateMark.tsx`), exactly as `commandId` names a command and the caller translates
 * it. This layer must not import an icon, and it holds no locale data.
 *
 * The ids are what let a mark become a *picture* rather than a glyph — an image asset's own
 * thumbnail, a character's avatar, an appearance's sprite. They are optional on every member because
 * the same vocabulary also describes a param NAME (`转场=`, `图片=`), where the slot is known but no
 * particular value has been named yet; a mark with nothing to look up simply draws its glyph.
 */
export type StoryCandidateMark =
    | { kind: "asset"; assetType: "image" | "audio" | "video"; assetId?: string }
    | { kind: "character"; characterId?: string }
    /** The author's own text offered back — a temp speaker, an object made elsewhere. Backs nothing, so it can picture nothing. */
    | { kind: "freeName" }
    /** A named look of one character: a pose id (preset) or a tag id on `axisId` (layered). */
    | { kind: "appearance"; characterId?: string; refId?: string; axisId?: string }
    | { kind: "puppetChannel"; channel: StoryPuppetChannel }
    | { kind: "puppetParam" }
    | { kind: "scene" }
    | { kind: "choiceOption" }
    | { kind: "audioTrack" }
    | { kind: "label" }
    | { kind: "appTag" }
    | { kind: "variable"; valueType?: StoryVariableValueType }
    | { kind: "blueprint" }
    | { kind: "function" }
    | { kind: "boolean"; value?: boolean }
    /**
     * A word that means itself: an enum option or a keyword. `value` is the CANONICAL spelling, not
     * the one on show — the view's glyph table is keyed on the value the grammar declares, so a
     * locale's own word for it still finds the same picture.
     */
    | { kind: "word"; value: string }
    /**
     * A slot that takes one of a word list, before any of them is named. `lead` is the list's first
     * option, which is what gives `转场=` and `位置=` different glyphs instead of two identical lists:
     * a word list is best described by the word it leads with.
     */
    | { kind: "options"; lead?: string }
    | { kind: "stageObject"; objectKind: StoryCommandStageObjectKind }
    | { kind: "target" }
    | { kind: "content" }
    | { kind: "number"; duration?: true }
    | { kind: "color" }
    | { kind: "text" }
    | { kind: "expression" };

export type StoryCommandCandidate = {
    /** The text a completion inserts. */
    value: string;
    /** What to show. Empty for command candidates - the caller translates from `commandId`. */
    label: string;
    detail?: string;
    /**
     * Which world this name lives in, when the slot spans more than one. Carried as the KIND rather
     * than as text for the same reason `commandId` is: this module holds no locale data, so the caller
     * translates it through `commandCategoryLabelKey(subjectGroupId(kind))`. Writing the kind straight
     * into `detail` put a raw `audio` / `video` / `vfx` in front of a zh author.
     */
    detailKind?: StoryCommandStageObjectKind;
    /** Set on command candidates only. */
    commandId?: string;
    /**
     * Set on param-name candidates only: the `story.paramHint.*` key naming this slot, for the same
     * reason `commandId` is carried — the caller owns the locale. The word it resolves to is the one
     * the inline ghost writes in its angle brackets, so the menu and the hint name a slot alike.
     */
    hintKey?: string;
    /**
     * A name backing nothing, offered back to the author anyway. Only ever set where the grammar says
     * a free value is legal, and it is what makes the speaker list never empty - which is what removes
     * "nothing matched" as a state Tab and Enter would each need a rule for.
     */
    free?: true;
    /** What this candidate is, for the menu's leading mark. See {@link StoryCandidateMark}. */
    mark?: StoryCandidateMark;
};

function startsWithFold(haystack: string, needle: string): boolean {
    return haystack.trim().toLowerCase().startsWith(needle.trim().toLowerCase());
}

function containsFold(haystack: string, needle: string): boolean {
    return haystack.trim().toLowerCase().includes(needle.trim().toLowerCase());
}

/**
 * `mark` is a factory rather than a constant so a candidate can carry the id of the very entry it
 * came from — which is what lets the menu draw the asset instead of a glyph standing in for it.
 */
function refCandidates(
    entries: readonly StoryCommandNamedRef[],
    query: string,
    mark?: (entry: StoryCommandNamedRef) => StoryCandidateMark,
): StoryCommandCandidate[] {
    // Prefix matches first - an author typing `fo` means forest, not "the one with fo in the middle".
    const prefix = entries.filter(entry => startsWithFold(entry.name, query));
    const rest = query ? entries.filter(entry => !startsWithFold(entry.name, query) && containsFold(entry.name, query)) : [];
    return [...prefix, ...rest].map(entry => ({ value: entry.name, label: entry.name, ...(mark ? { mark: mark(entry) } : {}) }));
}

/** Plain names, prefix matches first - the same ordering {@link refCandidates} gives ids-with-names. */
function nameCandidates(names: readonly string[], query: string, mark?: StoryCandidateMark): StoryCommandCandidate[] {
    const prefix = names.filter(name => startsWithFold(name, query));
    const rest = query ? names.filter(name => !startsWithFold(name, query) && containsFold(name, query)) : [];
    return [...prefix, ...rest].map(name => ({ value: name, label: name, ...(mark ? { mark } : {}) }));
}

function assetsOfType(context: StoryCommandContext, assetType: "image" | "audio" | "video"): readonly StoryCommandNamedRef[] {
    return assetType === "image" ? context.images : assetType === "audio" ? context.audio : context.videos;
}

/** The character an owner param resolved to, whether through a `character` or a `target` slot. */
function ownerCharacterId(owner: StoryCommandValue | undefined): string | null {
    if (owner?.kind === "character") {
        return owner.characterId;
    }
    if (owner?.kind === "target" && owner.target.type === "character") {
        return owner.target.characterId;
    }
    return null;
}

function stageObjectCandidates(
    context: StoryCommandContext,
    kind: StoryCommandStageObjectKind,
    query: string,
    /** Say which world a name lives in, when the slot spans more than one. */
    labelKind: boolean,
): StoryCommandCandidate[] {
    const names = kind === "audio"
        // The background-music channel answers to its reserved name, offered first: `/vol bgm 0.5`
        // is the explicit spelling of what an omitted target means.
        ? [BGM_OBJECT_NAME, ...(context.stageObjects.audio ?? [])]
        : context.stageObjects[kind] ?? [];
    return refCandidates(names.map(name => ({ id: name, name })), query, () => ({ kind: "stageObject", objectKind: kind }))
        .map(candidate => (labelKind ? { ...candidate, detailKind: kind } : candidate));
}

function targetCandidates(
    type: Extract<StoryCommandParamType, { kind: "target" }>,
    query: string,
    context: StoryCommandContext,
): StoryCommandCandidate[] {
    const candidates: StoryCommandCandidate[] = [];
    if (type.accepts.includes("character")) {
        candidates.push(...refCandidates(context.characters, query, entry => ({ kind: "character", characterId: entry.id })));
    }
    // A verb that reaches several worlds dispatches on WHICH one the name turns out to be, and the
    // author has to be able to see that before picking: `/pause intro` pausing a video rather than the
    // music is right only if "intro" was visibly a video. With one possible kind there is nothing to
    // disambiguate and the label would be noise. Read off `accepts`, so no command is special-cased.
    const labelKind = type.accepts.filter(kind => kind !== "character").length > 1;
    for (const kind of type.accepts) {
        if (kind !== "character") {
            candidates.push(...stageObjectCandidates(context, kind, query, labelKind));
        }
    }
    // Offer the typed name back only where a free name is legal - the same rule resolution applies,
    // so the list never offers a name that then fails. A never-empty list keeps Tab and Enter
    // single-meaning there.
    const typed = query.trim();
    if (freeTargetKind(type) && typed && !candidates.some(candidate => candidate.value.trim().toLowerCase() === typed.toLowerCase())) {
        candidates.push({ value: typed, label: typed, free: true, mark: { kind: "freeName" } });
    }
    return candidates;
}

function contentCandidates(
    type: Extract<StoryCommandParamType, { kind: "content" }>,
    query: string,
    context: StoryCommandContext,
    resolved: Readonly<Record<string, StoryCommandValue>>,
): StoryCommandCandidate[] {
    const owner = resolved[type.dependsOn];
    const target = owner?.kind === "target" ? owner.target : null;
    if (!target || target.type !== "stageObject") {
        return [];
    }
    if (target.objectKind === "image") {
        return refCandidates(context.images, query, entry => ({ kind: "asset", assetType: "image", assetId: entry.id }));
    }
    if (target.objectKind === "video") {
        return refCandidates(context.videos, query, entry => ({ kind: "asset", assetType: "video", assetId: entry.id }));
    }
    // Text content is whatever the author writes.
    return [];
}

function candidatesForType(
    type: StoryCommandParamType,
    query: string,
    context: StoryCommandContext,
    resolved: Readonly<Record<string, StoryCommandValue>>,
    /** The `visited(` / `picked(` the caret sits inside, when it does. See {@link StoryCommandCursor}. */
    call?: StoryVisitedCall,
): StoryCommandCandidate[] {
    switch (type.kind) {
        case "asset":
            return refCandidates(assetsOfType(context, type.assetType), query, entry => ({ kind: "asset", assetType: type.assetType, assetId: entry.id }));
        case "character": {
            const found = refCandidates(context.characters, query, entry => ({ kind: "character", characterId: entry.id }));
            if (!type.allowTemp) {
                return found;
            }
            // The speaker picker's order, which this must match: real characters, then names already
            // used in this story, then the name being typed. The last one is why the list is never
            // empty - a bare name is a temp speaker, a valid line rather than a fallback.
            const seen = new Set(found.map(candidate => candidate.value.trim().toLowerCase()));
            const candidates = [...found];
            for (const name of context.tempSpeakers) {
                const key = name.trim().toLowerCase();
                if (seen.has(key) || (query && !containsFold(name, query))) {
                    continue;
                }
                seen.add(key);
                candidates.push({ value: name, label: name, free: true, mark: { kind: "freeName" } });
            }
            const typed = query.trim();
            if (typed && !seen.has(typed.toLowerCase())) {
                candidates.push({ value: typed, label: typed, free: true, mark: { kind: "freeName" } });
            }
            return candidates;
        }
        case "characterForm": {
            const characterId = ownerCharacterId(resolved[type.dependsOn]);
            if (!characterId) {
                // The owner has not resolved to a character, so its forms are unknowable. Offering
                // every form of every character would be worse than offering none.
                return [];
            }
            return (context.appearanceByCharacterId[characterId] ?? [])
                .filter(ref => !query || containsFold(ref.name, query))
                // Both ids travel with the name: the menu draws this very look, and the look is
                // `axisId` + tag for a layered character and a bare pose for a preset one.
                .map(ref => ({ value: ref.name, label: ref.name, mark: { kind: "appearance" as const, characterId, refId: ref.id, axisId: ref.axisId } }));
        }
        case "puppetName": {
            // A puppet's motions, expressions and skins live in the model file, and the only thing
            // that can enumerate them is the live backend answering `PuppetInstance.describe`. The
            // editor asks it (`PuppetDescriptionService`) and the answer arrives on the context, so
            // this arm has a real list to offer - keyed by `type.channel` and the owner character.
            //
            // Nothing is appended for a query that matches none of them. A bare name is a legal temp
            // *speaker*, which is why that arm offers the author's own text back, but a motion the
            // model does not list is overwhelmingly a typo - and offering it as a candidate would
            // dress the typo up as a choice. It still commits (Enter submits an empty menu), and the
            // row then carries the `unknownPuppetName` mark, which is where a wrong name belongs.
            const names = puppetChannelNames(context, ownerCharacterId(resolved[type.dependsOn]) ?? undefined, type.channel);
            return nameCandidates(names, query, { kind: "puppetChannel", channel: type.channel });
        }
        case "puppetParam": {
            // The ids the model reported, each showing the range it accepts - which is the whole reason
            // a parameter is worth a command surface at all. A bare id with no bounds would be one more
            // string to remember; `ParamAngleX  -30…30` is a control the author can aim.
            const owner = ownerCharacterId(resolved[type.dependsOn]);
            const params = (owner ? context.puppetByCharacterId[owner]?.params : undefined) ?? [];
            return nameCandidates(params.map(param => param.id), query, { kind: "puppetParam" }).map(candidate => {
                const spec = params.find(param => param.id === candidate.value);
                return spec ? { ...candidate, detail: `${spec.min}…${spec.max}` } : candidate;
            });
        }
        case "scene":
            return refCandidates(context.scenes, query, () => ({ kind: "scene" }));
        case "audioTrack":
            return refCandidates(context.audioTracks, query, () => ({ kind: "audioTrack" }));
        case "label":
            return refCandidates(context.labels.map(name => ({ id: name, name })), query, () => ({ kind: "label" }));
        case "appTag":
            return refCandidates(context.appTags, query, () => ({ kind: "appTag" }));
        case "variable":
            return context.variables
                .filter(entry => !query || containsFold(entry.name, query))
                .map(entry => ({ value: entry.name, label: entry.name, detail: entry.valueType, mark: { kind: "variable" as const, valueType: entry.valueType } }));
        case "target":
            return targetCandidates(type, query, context);
        case "content":
            return contentCandidates(type, query, context, resolved);
        case "enum":
            // Completion inserts the word it is SHOWING — this locale's spelling when it has one that
            // parses, the canonical value otherwise. Storage is unaffected: resolution
            // normalizes either spelling to the canonical value, so what is banked never moves.
            //
            // The filter has to see the translated spelling too, or the list empties the moment the
            // author types the word they were just shown. `matchEnumOptionLocalized` covers the exact
            // hit; `containsFold` over the same spelling covers the partial one.
            return type.options
                .filter(option => !query || matchEnumOptionLocalized(type, query) === option || containsFold(option.value, query)
                    || containsFold(localizedEnumValue(type, option), query)
                    || (option.aliases ?? []).some(alias => containsFold(alias, query)))
                // The mark is keyed on the CANONICAL value while the row shows this locale's word, so
                // 向左滑动 and `slide-left` draw the same arrow.
                .map(option => ({ value: localizedEnumValue(type, option), label: localizedEnumValue(type, option), detail: option.aliases?.[0], mark: { kind: "word" as const, value: option.value } }));
        case "keyword":
            return !query || startsWithFold(type.value, query) ? [{ value: type.value, label: type.value, mark: { kind: "word", value: type.value } }] : [];
        case "boolean":
            return ["true", "false"].filter(value => !query || value.startsWith(query.toLowerCase()))
                .map(value => ({ value, label: value, mark: { kind: "boolean" as const, value: value === "true" } }));
        case "expression": {
            // Inside `visited(` / `picked(` the vocabulary is not the expression language's at all -
            // it is one entity name - so the whole variable/function offer is replaced rather than
            // added to. Offering `gold` where only a scene may go would be offering a line that
            // cannot resolve.
            if (call) {
                return call === "visited"
                    ? refCandidates(context.scenes, query, () => ({ kind: "scene" }))
                    : refCandidates(context.choiceOptions, query, () => ({ kind: "choiceOption" }));
            }
            // Inside an expression the query is the identifier fragment under the caret (the cursor
            // layer extracts it), so the offer is every variable in scope plus the function whitelist.
            //
            // `true`/`false` lead when the assignment target is a boolean: the overwhelmingly common
            // thing to do with a flag is set it to a constant.
            const target = type.assignTo ? resolved[type.assignTo] : undefined;
            const booleans = target?.kind === "variable" && target.valueType === "boolean"
                ? ["true", "false"].filter(value => !query || value.startsWith(query.toLowerCase()))
                    .map(value => ({ value, label: value, mark: { kind: "boolean" as const, value: value === "true" } }))
                : [];
            return [
                ...booleans,
                ...context.variables
                    .filter(entry => !query || containsFold(entry.name, query))
                    .map(entry => ({ value: entry.name, label: entry.name, detail: entry.valueType, mark: { kind: "variable" as const, valueType: entry.valueType } })),
                // Blueprints sit with the variables, not with the functions, because that is what
                // they are here: a name the project declares, offered unprompted for the same reason.
                // The inserted text is the whole CALL, and the name is quoted when the lexer would
                // otherwise split it - the default "Story Value" has a space in it, so the unquoted
                // spelling would not parse at all.
                ...context.valueBlueprints
                    .filter(entry => !query || containsFold(entry.name, query))
                    .map(entry => ({ value: `${formatStoryExpressionName(entry.name)}()`, label: entry.name, detail: "bp", mark: { kind: "blueprint" as const } })),
                ...STORY_EXPR_FUNCTIONS
                    .filter(fn => query !== "" && startsWithFold(fn, query))
                    .map(fn => ({ value: `${fn}(`, label: fn, detail: "fn", mark: { kind: "function" as const } })),
                // The two record reads complete like functions but ARE offered on an empty query,
                // where the whitelist is not. The rule the whitelist follows is "do not bury the
                // variables under ten names an author already knows"; these are two names an author
                // has no way to discover, and two rows below the variables bury nothing.
                ...STORY_VISITED_CALLS
                    .filter(name => !query || startsWithFold(name, query))
                    .map(name => ({ value: `${name}(`, label: name, detail: "fn", mark: { kind: "function" as const } })),
            ];
        }
        case "constant":
            // `true`/`false` and nothing else. A declaration's default cannot read a variable, so
            // offering variable names here pointed the author at values that would then be rejected.
            return ["true", "false"].filter(value => !query || value.startsWith(query.toLowerCase()))
                .map(value => ({ value, label: value, mark: { kind: "boolean" as const, value: value === "true" } }));
        // Nothing to enumerate: a number, a colour, free text or an unconstrained literal is whatever
        // the author types.
        case "number":
        case "color":
        case "literal":
        case "text":
            return [];
    }
}

/**
 * The mark a param NAME wears: the same vocabulary its values wear, minus the ids no value has been
 * named for yet. `t=` is a transition slot before it is any particular transition, and saying so is
 * what makes a column of `t` `d` `at` readable at a glance rather than three letters to decode.
 *
 * The first branch of a union speaks for the param — `amount` accepting a placement or a number is
 * primarily a placement, which is what its own `hint` already says.
 */
function paramNameMark(param: StoryCommandParam): StoryCandidateMark | undefined {
    const [type] = paramTypes(param);
    switch (type?.kind) {
        case "asset":
            return { kind: "asset", assetType: type.assetType };
        case "character":
            return { kind: "character" };
        case "characterForm":
            return { kind: "appearance" };
        case "puppetName":
            return { kind: "puppetChannel", channel: type.channel };
        case "puppetParam":
            return { kind: "puppetParam" };
        case "scene":
            return { kind: "scene" };
        case "audioTrack":
            return { kind: "audioTrack" };
        case "label":
            return { kind: "label" };
        case "appTag":
            return { kind: "appTag" };
        case "variable":
            return { kind: "variable" };
        case "target":
            return { kind: "target" };
        case "content":
            return { kind: "content" };
        case "enum":
            return { kind: "options", lead: type.options[0]?.value };
        case "keyword":
            return { kind: "options", lead: type.value };
        case "boolean":
            return { kind: "boolean" };
        case "number":
            // The unit is the whole difference between "how long" and "how many", and it is the one
            // the ghost hint and the committed row already print.
            return { kind: "number", ...(type.unit === "s" ? { duration: true as const } : {}) };
        case "color":
            return { kind: "color" };
        case "expression":
            return { kind: "expression" };
        case "text":
        case "literal":
        case "constant":
            return { kind: "text" };
        default:
            return undefined;
    }
}

function candidatesForParam(
    param: StoryCommandParam,
    query: string,
    context: StoryCommandContext,
    resolved: Readonly<Record<string, StoryCommandValue>>,
    call?: StoryVisitedCall,
): StoryCommandCandidate[] {
    // A union offers every branch's candidates, in declaration order.
    return paramTypes(param).flatMap(type => candidatesForType(type, query, context, resolved, call));
}

/**
 * Whether this param has anything to enumerate at all.
 *
 * The difference between "nothing matched" and "nothing to match": an asset name that finds no asset
 * is worth telling the author about, a half-typed number is not. Callers use it to decide whether an
 * empty list deserves an empty *state* or no menu at all.
 */
export function hasCandidateSource(
    param: StoryCommandParam,
    context?: StoryCommandContext,
    resolved: Readonly<Record<string, StoryCommandValue>> = {},
): boolean {
    return paramTypes(param).some(type => {
        switch (type.kind) {
            case "asset":
            case "character":
            case "characterForm":
            case "scene":
            // Every project has at least the three built-ins, so "no matches" here always means what
            // it says - unlike a puppet channel, whose empty list may only mean nobody could ask.
            case "audioTrack":
            case "variable":
            case "label":
            // Every project has the release variant, so "no matches" here always means what it says.
            case "appTag":
            case "target":
            case "content":
            case "enum":
            case "keyword":
            case "boolean":
            // An expression always has the variable list to offer, so an empty result really does mean
            // "nothing matched what you typed" - worth saying, unlike a half-typed number.
            case "expression":
            // A constant enumerates true/false, so "no matches" is meaningful once something is typed.
            case "constant":
                return true;
            // The only param whose answer is not a property of the grammar. A model that has been
            // asked and answered has a list, so "no matches" means what it says; a model nobody could
            // ask has none, and the honest response is no menu at all - the author is typing a name
            // only the model knows, and telling them it "does not match" would be Studio blaming them
            // for a runtime it never loaded. Answering `true` unconditionally is what made the arm
            // look broken in projects that carry no runtime.
            case "puppetName":
                return context !== undefined
                    && puppetChannelNames(context, ownerCharacterId(resolved[type.dependsOn]) ?? undefined, type.channel).length > 0;
            case "puppetParam": {
                const owner = context && ownerCharacterId(resolved[type.dependsOn]);
                return Boolean(owner && (context?.puppetByCharacterId[owner]?.params.length ?? 0) > 0);
            }
            case "number":
            case "color":
            case "literal":
            case "text":
                return false;
        }
    });
}

/**
 * Candidates for the caret's position.
 *
 * `resolved` carries the args resolved so far, which a dependent param needs - a form can only list
 * the forms of the character this line already named.
 */
export function getCommandCandidates(
    cursor: StoryCommandCursor,
    context: StoryCommandContext,
    resolved: Readonly<Record<string, StoryCommandValue>> = {},
): StoryCommandCandidate[] {
    switch (cursor.kind) {
        case "commandName":
            return listCommandDefs()
                .filter(def => !cursor.query
                    || startsWithFold(def.token, cursor.query)
                    || (def.aliases ?? []).some(alias => startsWithFold(alias, cursor.query))
                    || startsWithFold(def.commandId, cursor.query))
                .map(def => ({ value: def.token, label: "", commandId: def.commandId }));
        case "positional":
        case "paramValue":
            return candidatesForParam(cursor.param, cursor.query, context, resolved);
        case "expression":
            return candidatesForParam(cursor.param, cursor.query, context, resolved, cursor.call);
        case "paramName":
            // `paramMatchesQuery` extends the canonical name/alias filter with the active command
            // locale's spelling: the menu shows "位置" next to `at`, and a filter blind to it would
            // empty the list the moment the author typed the word they were just shown.
            //
            // The completion writes that same word (`localizedParamKey`), not the canonical key — the
            // rule commands and enum values already follow. `label` stays the canonical key so the
            // menu can keep showing it alongside; it is still the shortest thing to type by hand and
            // it parses in every locale.
            return cursor.params
                .filter(param => paramMatchesQuery(cursor.def, param, cursor.query))
                .map(param => ({
                    value: localizedParamKey(cursor.def, param),
                    label: param.name,
                    hintKey: paramHintKey(param),
                    mark: paramNameMark(param),
                }));
        case "characterName":
            return candidatesForType({ kind: "character", allowTemp: true }, cursor.query, context, {});
        case "greedy":
        case "none":
            return [];
    }
}
