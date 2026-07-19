import { STORY_EXPR_FUNCTIONS } from "@shared/types/story";
import { listCommandDefs, matchEnumOption, paramTypes, type StoryCommandParam, type StoryCommandParamType } from "./storyCommandGrammar";
import type { StoryCommandCursor } from "./storyCommandCursor";
import type { StoryCommandContext, StoryCommandNamedRef, StoryCommandValue } from "./storyCommandResolution";

/**
 * What to offer at the caret.
 *
 * Reads the same {@link StoryCommandContext} the resolver reads, so the list can never offer a name
 * that then fails to resolve, nor hide one that would have - the drift the plan's §3.3 is about.
 *
 * Pure, and free of display strings: a command candidate carries its `commandId` so the caller can
 * translate it through the existing `story.actionCommand.<id>.label` catalog. The grammar holds no
 * locale data (§3.6).
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
            const owner = resolved[type.dependsOn];
            if (owner?.kind !== "character") {
                // The character has not resolved, so its forms are unknowable. Offering every form of
                // every character would be worse than offering none.
                return [];
            }
            return (context.formsByCharacterId[owner.characterId] ?? [])
                .filter(form => !query || containsFold(form, query))
                .map(form => ({ value: form, label: form }));
        }
        case "scene":
            return refCandidates(context.scenes, query);
        case "variable":
            return context.variables
                .filter(entry => !query || containsFold(entry.name, query))
                .map(entry => ({ value: entry.name, label: entry.name, detail: entry.valueType }));
        case "enum":
            return type.options
                .filter(option => !query || matchEnumOption(type, query) === option || containsFold(option.value, query)
                    || (option.aliases ?? []).some(alias => containsFold(alias, query)))
                .map(option => ({ value: option.aliases?.[0] ?? option.value, label: option.aliases?.[0] ?? option.value, detail: option.value }));
        case "keyword":
            return !query || startsWithFold(type.value, query) ? [{ value: type.value, label: type.value }] : [];
        case "boolean":
            return ["true", "false"].filter(value => !query || value.startsWith(query.toLowerCase())).map(value => ({ value, label: value }));
        case "stageObject": {
            // The names on stage of this kind - sourced from the same collector the inspector's target
            // picker reads, so the two never disagree about what exists.
            const found = refCandidates((context.stageObjects[type.objectKind] ?? []).map(name => ({ id: name, name })), query);
            // Offer the typed name back, as the speaker picker does: an object may be created dynamically
            // or in another scene, so an unmatched name is a valid reference, and a never-empty list is
            // what keeps Tab and Enter single-meaning.
            const typed = query.trim();
            if (typed && !found.some(candidate => candidate.value.trim().toLowerCase() === typed.toLowerCase())) {
                found.push({ value: typed, label: typed, free: true });
            }
            return found;
        }
        case "expression": {
            // Inside an expression the query is the identifier fragment under the caret (the cursor
            // layer extracts it), so the offer is every variable in scope plus the function whitelist.
            // Without this, `/set gold ` would be the one slot in the whole command line where the
            // author has to remember a name instead of picking it.
            //
            // `true`/`false` lead when the assignment target is a boolean. That is the behaviour the
            // old dependent-literal slot had, and it is worth keeping: the overwhelmingly common thing
            // to do with a flag is set it to a constant, so that has to be the first thing offered
            // rather than something the author scrolls past a list of variable names to reach.
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
            // offering variable names here — which is what modelling this slot as an expression did —
            // pointed the author at values that would then be rejected.
            return ["true", "false"].filter(value => !query || value.startsWith(query.toLowerCase())).map(value => ({ value, label: value }));
        // Nothing to enumerate: a number, a colour, free text or an unconstrained literal is whatever
        // the author types.
        case "number":
        case "color":
        case "literal":
        case "text":
        case "displayable":
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
            case "enum":
            case "keyword":
            case "boolean":
            case "stageObject":
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
            case "displayable":
                return false;
        }
    });
}

/**
 * Candidates for the caret's position.
 *
 * `resolved` carries the args resolved so far, which a dependent param needs - `form=` can only list
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
