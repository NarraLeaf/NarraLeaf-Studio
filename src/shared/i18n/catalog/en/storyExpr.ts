/** `storyExpr` - the story expression language: per-issue messages for a expression that does not
 *  parse or does not resolve, shared by the command line and the condition editor. */
export const storyExpr = {
    /**
     * One message per `StoryExpressionIssue["code"]`. They are separate entries rather than one
     * generic "invalid expression" because the mistakes are genuinely different problems and the fix
     * differs: a misspelled variable is a name to correct, an unbalanced paren is a character to add.
     * Collapsing them into one badge is what the command line's `invalidHint` does, and it is the
     * reason a wrong expression there tells the author nothing.
     */
    issue: {
        unexpectedToken: "Unexpected \"{text}\" here.",
        unexpectedEnd: "The expression is unfinished.",
        unterminatedString: "A quote is never closed.",
        unbalancedParen: "A bracket is never closed.",
        unknownVariable: "No variable named \"{name}\".",
        unknownQualifiedVariable: "No \"{name}\" in the {scope} scope.",
        unknownScopePrefix: "\"{prefix}\" is not a scope. Use scene, saved or persis.",
        unknownFunction: "There is no \"{name}\" function.",
        badArity: "{fn} takes {expected} argument(s), not {received}.",
    },
    /** Checks the *command line* adds on top of parsing, where the slot expects a particular shape. */
    check: {
        notBoolean: "A condition has to be a true/false test, like gold >= 100.",
        typeMismatch: "This produces {received}, but the variable holds {expected}.",
        notConstant: "A default cannot read another variable — it is set before any of them exist.",
        duplicateVariable: "A variable with this name already exists in this scope.",
        compoundWithoutTarget: "There is no variable here to add to.",
    },
    /**
     * Why a line will not commit, said in the row while it is being typed.
     *
     * One entry per `StoryCommandResolutionIssue["code"]` plus the parser's own codes. These all used
     * to collapse into a single "won't build" badge, which is how an author could sit on
     * `/var gold 1` — a name collision — with no way to find out what was wrong with it.
     */
    reason: {
        unknownCommand: "There is no /{token} command.",
        unknownParam: "/{token} has no \"{key}\" option.",
        duplicateParam: "\"{key}\" is given twice.",
        extraPositional: "\"{value}\" is one argument too many.",
        badValue: "\"{value}\" does not fit this slot.",
        unterminatedQuote: "A quote is never closed.",
        unknownAsset: "No {assetType} named \"{value}\".",
        unknownCharacter: "No character named \"{value}\".",
        unknownScene: "No scene named \"{value}\".",
        unknownVariable: "No variable named \"{value}\".",
        unknownForm: "{characterName} has no \"{value}\" expression.",
        ambiguousName: "More than one thing is called \"{value}\" — rename one.",
        conflictingParams: "{keys} cannot both be set on one line — split it in two.",
        expressionError: "{message}",
        expressionNotBoolean: "A condition has to be a true/false test, like gold >= 100.",
        expressionTypeMismatch: "This produces {received}, but \"{value}\" holds {expected}.",
        duplicateVariable: "\"{value}\" already exists — pick another name, or use /set to change it.",
    },
};
