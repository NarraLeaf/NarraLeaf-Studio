import { STORY_EXPR_FUNCTIONS } from "@shared/types/story";
import { matchEnumOption, paramTypes, type StoryCommandParam, type StoryCommandParamType } from "./storyCommandGrammar";
import { listCommandDefs } from "./commands/registry";
import type { StoryCommandCursor } from "./storyCommandCursor";
import { BGM_OBJECT_NAME, type StoryCommandContext, type StoryCommandNamedRef, type StoryCommandStageObjectKind, type StoryCommandValue } from "./storyCommandValues";

/**
 * What to offer at the caret.
 *
 * Reads the same {@link StoryCommandContext} the resolver reads, so the list can never offer a name
 * that then fails to resolve, nor hide one that would have.
 *
 * Pure, and free of display strings: a command candidate carries its `commandId` so the caller can
 * translate it through the `story.command.<id>.label` catalog. The grammar holds no locale data.
 */

export type StoryCommandCandidate = {
    /** The text a completion inserts. */
    value: string;
    /** What to show. Empty for command candidates - the caller translates from `commandId`. */
    label: string;
    detail?: string;
    /** Set on command candidates only. */
    commandId?: string;
    /**
     * A name backing nothing, offered back to the author anyway. Only ever set where the grammar says
     * a free value is legal, and it is what makes the speaker list never empty - which is what removes
     * "nothing matched" as a state Tab and Enter would each need a rule for.
     */
    free?: true;
};

function startsWithFold(haystack: string, needle: string): boolean {
    return haystack.trim().toLowerCase().startsWith(needle.trim().toLowerCase());
}

function containsFold(haystack: string, needle: string): boolean {
    return haystack.trim().toLowerCase().includes(needle.trim().toLowerCase());
}

function refCandidates(entries: readonly StoryCommandNamedRef[], query: string): StoryCommandCandidate[] {
    // Prefix matches first - an author typing `fo` means forest, not "the one with fo in the middle".
    const prefix = entries.filter(entry => startsWithFold(entry.name, query));
    const rest = query ? entries.filter(entry => !startsWithFold(entry.name, query) && containsFold(entry.name, query)) : [];
    return [...prefix, ...rest].map(entry => ({ value: entry.name, label: entry.name }));
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

function stageObjectCandidates(context: StoryCommandContext, kind: StoryCommandStageObjectKind, query: string): StoryCommandCandidate[] {
    const names = kind === "audio"
        // The background-music channel answers to its reserved name, offered first: `/vol bgm 0.5`
        // is the explicit spelling of what an omitted target means.
        ? [BGM_OBJECT_NAME, ...(context.stageObjects.audio ?? [])]
        : context.stageObjects[kind] ?? [];
    return refCandidates(names.map(name => ({ id: name, name })), query);
}

function targetCandidates(
    type: Extract<StoryCommandParamType, { kind: "target" }>,
    query: string,
    context: StoryCommandContext,
): StoryCommandCandidate[] {
    const candidates: StoryCommandCandidate[] = [];
    if (type.accepts.includes("character")) {
        candidates.push(...refCandidates(context.characters, query));
    }
    for (const kind of type.accepts) {
        if (kind !== "character") {
            candidates.push(...stageObjectCandidates(context, kind, query));
        }
    }
    // Offer the typed name back only where a free name is legal - one possible kind, so resolution
    // can still dispatch. A never-empty list keeps Tab and Enter single-meaning there.
    const stageKinds = type.accepts.filter(kind => kind !== "character");
    const typed = query.trim();
    if (stageKinds.length === 1 && typed && !candidates.some(candidate => candidate.value.trim().toLowerCase() === typed.toLowerCase())) {
        candidates.push({ value: typed, label: typed, free: true });
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
        return refCandidates(context.images, query);
    }
    if (target.objectKind === "video") {
        return refCandidates(context.videos, query);
    }
    // Text content is whatever the author writes.
    return [];
}

function candidatesForType(
    type: StoryCommandParamType,
    query: string,
    context: StoryCommandContext,
    resolved: Readonly<Record<string, StoryCommandValue>>,
): StoryCommandCandidate[] {
    switch (type.kind) {
        case "asset":
            return refCandidates(assetsOfType(context, type.assetType), query);
        case "character": {
            const found = refCandidates(context.characters, query);
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
                candidates.push({ value: name, label: name, free: true });
            }
            const typed = query.trim();
            if (typed && !seen.has(typed.toLowerCase())) {
                candidates.push({ value: typed, label: typed, free: true });
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
            return (context.formsByCharacterId[characterId] ?? [])
                .filter(form => !query || containsFold(form, query))
                .map(form => ({ value: form, label: form }));
        }
        case "scene":
            return refCandidates(context.scenes, query);
        case "variable":
            return context.variables
                .filter(entry => !query || containsFold(entry.name, query))
                .map(entry => ({ value: entry.name, label: entry.name, detail: entry.valueType }));
        case "target":
            return targetCandidates(type, query, context);
        case "content":
            return contentCandidates(type, query, context, resolved);
        case "enum":
            // Completion inserts the CANONICAL value (bible B6): what you pick is what is stored, and
            // an alias you typed still finds its option.
            return type.options
                .filter(option => !query || matchEnumOption(type, query) === option || containsFold(option.value, query)
                    || (option.aliases ?? []).some(alias => containsFold(alias, query)))
                .map(option => ({ value: option.value, label: option.value, detail: option.aliases?.[0] }));
        case "keyword":
            return !query || startsWithFold(type.value, query) ? [{ value: type.value, label: type.value }] : [];
        case "boolean":
            return ["true", "false"].filter(value => !query || value.startsWith(query.toLowerCase())).map(value => ({ value, label: value }));
        case "expression": {
            // Inside an expression the query is the identifier fragment under the caret (the cursor
            // layer extracts it), so the offer is every variable in scope plus the function whitelist.
            //
            // `true`/`false` lead when the assignment target is a boolean: the overwhelmingly common
            // thing to do with a flag is set it to a constant.
            const target = type.assignTo ? resolved[type.assignTo] : undefined;
            const booleans = target?.kind === "variable" && target.valueType === "boolean"
                ? ["true", "false"].filter(value => !query || value.startsWith(query.toLowerCase())).map(value => ({ value, label: value }))
                : [];
            return [
                ...booleans,
                ...context.variables
                    .filter(entry => !query || containsFold(entry.name, query))
                    .map(entry => ({ value: entry.name, label: entry.name, detail: entry.valueType })),
                ...STORY_EXPR_FUNCTIONS
                    .filter(fn => query !== "" && startsWithFold(fn, query))
                    .map(fn => ({ value: `${fn}(`, label: fn, detail: "fn" })),
            ];
        }
        case "constant":
            // `true`/`false` and nothing else. A declaration's default cannot read a variable, so
            // offering variable names here pointed the author at values that would then be rejected.
            return ["true", "false"].filter(value => !query || value.startsWith(query.toLowerCase())).map(value => ({ value, label: value }));
        // Nothing to enumerate: a number, a colour, free text or an unconstrained literal is whatever
        // the author types.
        case "number":
        case "color":
        case "literal":
        case "text":
            return [];
    }
}

function candidatesForParam(
    param: StoryCommandParam,
    query: string,
    context: StoryCommandContext,
    resolved: Readonly<Record<string, StoryCommandValue>>,
): StoryCommandCandidate[] {
    // A union offers every branch's candidates, in declaration order.
    return paramTypes(param).flatMap(type => candidatesForType(type, query, context, resolved));
}

/**
 * Whether this param has anything to enumerate at all.
 *
 * The difference between "nothing matched" and "nothing to match": an asset name that finds no asset
 * is worth telling the author about, a half-typed number is not. Callers use it to decide whether an
 * empty list deserves an empty *state* or no menu at all.
 */
export function hasCandidateSource(param: StoryCommandParam): boolean {
    return paramTypes(param).some(type => {
        switch (type.kind) {
            case "asset":
            case "character":
            case "characterForm":
            case "scene":
            case "variable":
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
        case "expression":
            return candidatesForParam(cursor.param, cursor.query, context, resolved);
        case "paramName":
            return cursor.params
                .filter(param => !cursor.query || startsWithFold(param.name, cursor.query)
                    || (param.aliases ?? []).some(alias => startsWithFold(alias, cursor.query)))
                .map(param => ({ value: param.name, label: param.name, detail: param.aliases?.[0] }));
        case "characterName":
            return candidatesForType({ kind: "character", allowTemp: true }, cursor.query, context, {});
        case "greedy":
        case "none":
            return [];
    }
}
