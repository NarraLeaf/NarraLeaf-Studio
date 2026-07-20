import type { TranslationKey } from "@shared/i18n";
import { missingCoreParams, parseCommandLine, type StoryCommandIssue, type StoryCommandLine } from "./storyCommandParser";
import type { StoryExpressionIssue } from "@shared/utils/storyExpressionParser";
import { resolveCommandLine, type StoryCommandContext, type StoryCommandResolutionIssue } from "./storyCommandResolution";

/**
 * Why a command line will not commit, in one sentence.
 *
 * Every issue the parser and the resolver can raise used to collapse into a single "won't build"
 * badge. That is fine as a *verdict* and useless as *feedback*: an author sitting on `/var gold 1`
 * where `gold` is already taken has no way to learn that from the editor, and the failure looks
 * identical to a syntax error. So the same issue objects that already decide committability are now
 * also read for their reason.
 *
 * Returns a translation key plus its params rather than a string: this file is pure, the catalog is
 * compile-time checked, and the caller already holds `t`.
 */

export type StoryCommandReason = {
    key: TranslationKey;
    params: Record<string, string | number>;
    /** When set, the caller translates this hint key and substitutes it for `params.slot`. */
    paramHintKey?: TranslationKey;
};

const reasonKey = (code: string): TranslationKey => `storyExpr.reason.${code}` as TranslationKey;

/** The first problem with this line, or null when it is fine (or is not a command at all). */
export function getCommandLineReason(source: string, context: StoryCommandContext): StoryCommandReason | null {
    if (!source.startsWith("/")) {
        return null;
    }
    const line = parseCommandLine(source);
    if (line.kind !== "command") {
        return null;
    }
    // An unfinished command token is not an error — the author is still choosing. Complaining about
    // `/va` while they type toward `/var` would put a red line under every keystroke.
    if (!line.def) {
        const unknown = line.issues.find(issue => issue.code === "unknownCommand");
        return unknown && looksComplete(source) ? parserReason(line, unknown) : null;
    }
    const parserIssue = line.issues[0];
    if (parserIssue) {
        return parserReason(line, parserIssue);
    }
    const resolutionIssue = resolveCommandLine(line, context).issues[0];
    return resolutionIssue ? resolutionReason(resolutionIssue) : null;
}

/**
 * Why this line landed as a draft instead of a row - the reason a draft row shows.
 *
 * A superset of {@link getCommandLineReason}: an error-free line can still be missing its required
 * core (bible B9), which is not worth a red line while typing (the ghost hint already names the next
 * slot) but is exactly what the draft row must say. `paramHintKey` names the missing slot's hint for
 * the caller to translate.
 */
export function getCommandLineDraftReason(source: string, context: StoryCommandContext): StoryCommandReason | null {
    const live = getCommandLineReason(source, context);
    if (live) {
        return live;
    }
    const line = parseCommandLine(source);
    if (line.kind !== "command" || !line.def) {
        return null;
    }
    const missing = missingCoreParams(line);
    if (missing.length === 0) {
        return null;
    }
    return {
        key: "storyExpr.reason.missingCore" as TranslationKey,
        params: { token: line.token ?? "", slot: missing[0].hint ?? missing[0].name },
        paramHintKey: `story.paramHint.${missing[0].hint ?? missing[0].name}` as TranslationKey,
    };
}

/**
 * Whether the author has stopped typing the command token.
 *
 * A trailing space is the signal: `/va` is in progress, `/va ` is a decision. Without this the row
 * would report "there is no /v command" on the first keystroke after the slash.
 */
function looksComplete(source: string): boolean {
    return source.trimEnd().length < source.length;
}

function parserReason(line: Extract<StoryCommandLine, { kind: "command" }>, issue: StoryCommandIssue): StoryCommandReason {
    const token = line.token ?? "";
    switch (issue.code) {
        case "unknownCommand":
            return { key: reasonKey(issue.code), params: { token: issue.token } };
        case "unknownParam":
        case "duplicateParam":
            return { key: reasonKey(issue.code), params: { token, key: issue.key } };
        case "extraPositional":
        case "badValue":
            return { key: reasonKey(issue.code), params: { token, value: issue.value } };
        case "unterminatedQuote":
            return { key: reasonKey(issue.code), params: {} };
    }
}

/** The expression language's own issues, which carry their own params. */
function expressionReason(issue: StoryExpressionIssue): StoryCommandReason {
    const key = `storyExpr.issue.${issue.code}` as TranslationKey;
    switch (issue.code) {
        case "unexpectedToken":
            return { key, params: { text: issue.text } };
        case "unknownVariable":
        case "unknownFunction":
            return { key, params: { name: issue.name } };
        case "unknownQualifiedVariable":
            return { key, params: { name: issue.name, scope: issue.scope } };
        case "unknownScopePrefix":
            return { key, params: { prefix: issue.prefix } };
        case "badArity":
            return { key, params: { fn: issue.fn, expected: issue.expected, received: issue.received } };
        case "unexpectedEnd":
        case "unterminatedString":
        case "unbalancedParen":
            return { key, params: {} };
    }
}

function resolutionReason(issue: StoryCommandResolutionIssue): StoryCommandReason {
    switch (issue.code) {
        case "unknownAsset":
            return { key: reasonKey(issue.code), params: { value: issue.value, assetType: issue.assetType } };
        case "unknownCharacter":
        case "unknownScene":
        case "unknownVariable":
        case "duplicateVariable":
            return { key: reasonKey(issue.code), params: { value: issue.value } };
        case "unknownForm":
            return { key: reasonKey(issue.code), params: { value: issue.value, characterName: issue.characterName } };
        case "unknownTarget":
        case "ambiguousName":
            return { key: reasonKey(issue.code), params: { value: issue.value } };
        case "unsupportedOption":
            return { key: reasonKey(issue.code), params: { value: issue.value, allowed: issue.allowed.join(", ") } };
        case "conflictingParams":
            return { key: reasonKey(issue.code), params: { keys: issue.keys.join(" / ") } };
        case "expressionError":
            // Report the *inner* issue directly rather than wrapping it: "no variable named gold" is
            // the whole message, and a generic "invalid expression: …" prefix adds nothing.
            return expressionReason(issue.issue);
        case "expressionNotBoolean":
            return { key: reasonKey(issue.code), params: {} };
        case "compoundWithoutTarget":
            return { key: "storyExpr.check.compoundWithoutTarget" as TranslationKey, params: {} };
        case "expressionTypeMismatch":
            return { key: reasonKey(issue.code), params: { value: issue.value, expected: issue.expected, received: issue.received } };
    }
}
