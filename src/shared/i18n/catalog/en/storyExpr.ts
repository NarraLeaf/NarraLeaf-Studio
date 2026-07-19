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
};
