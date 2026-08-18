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
    unexpectedToken: 'Unexpected "{text}" here.',
    unexpectedEnd: "The expression is unfinished.",
    unterminatedString: "A quote is never closed.",
    unbalancedParen: "A bracket is never closed.",
    unknownVariable: 'No variable named "{name}".',
    unknownQualifiedVariable: 'No "{name}" in the {scope} scope.',
    unknownScopePrefix: '"{prefix}" is not a scope. Use scene, saved or persis.',
    unknownFunction: 'There is no "{name}" function.',
    badArity: "Wrong argument count for {fn}: {received} given, {expected} expected.",
    unknownVisitedTarget: '{call} does not know anything called "{name}".',
    unknownBlueprint: 'There is no story value blueprint named "{name}".',
    blueprintTakesNoArguments: '"{name}" is a blueprint, and a blueprint call takes no arguments.',
    ambiguousReference: 'More than one thing is called "{name}". Rename one of them.',
    blueprintShadowsFunction:
      "\"{name}\" is a built-in function, so it cannot also name a blueprint. Rename the blueprint, or write '{name}'() to call it.",
    // Advisory: the line is fine and commits. What it says is that this content is in no build.
    unknownAppTagName: 'No build variant is named "{name}", so this is never true.'
  },
  /** Checks the *command line* adds on top of parsing, where the slot expects a particular shape. */
  check: {
    notBoolean: "A condition has to be a true/false test, like gold >= 100.",
    typeMismatch: "This produces {received}, but the variable holds {expected}.",
    notConstant:
      "A default cannot read another variable. Defaults are set before any variable exists.",
    duplicateVariable: "A variable with this name already exists in this scope.",
    compoundWithoutTarget: "There is no variable here to add to."
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
    unknownParam: '/{token} has no "{key}" option.',
    duplicateParam: '"{key}" is given twice.',
    extraPositional: '"{value}" is one argument too many.',
    badValue: '"{value}" does not fit this slot.',
    unterminatedQuote: "A quote is never closed.",
    unknownAsset: 'No {assetType} named "{value}".',
    unknownCharacter: 'No character named "{value}".',
    unknownScene: 'No scene named "{value}".',
    unknownAudioTrack: 'No audio track named "{value}".',
    unknownLabel: 'No label named "{value}" in this scene.',
    unknownAppTag: 'No build variant named "{value}".',
    unknownVariable: 'No variable named "{value}".',
    unknownForm: '{characterName} has no "{value}" expression.',
    notPuppetCharacter: "{value} is not drawn by a runtime, so it has no motion or skin to set.",
    ambiguousName: 'More than one thing is called "{value}". Rename one of them.',
    conflictingParams: "{keys} cannot both be set on one line. Split the line in two.",
    repeatTimesAndUntil:
      "A repeat runs a set number of times or until a condition, not both. Remove one of them.",
    expressionError: "{message}",
    expressionNotBoolean: "A condition has to be a true/false test, like gold >= 100.",
    // `{variable}` is the assignment target, never the expression source: the variable is the only
    // side of `/set` that HOLDS a declared type. Both `{expected}` and `{received}` are always one
    // of boolean/number/string here (a `json` target accepts anything and an undecidable
    // expression infers `unknown`, and neither reaches this message), so the articles always read.
    expressionTypeMismatch: '"{variable}" holds a {expected}, so it cannot take a {received}.',
    duplicateVariable:
      '"{value}" already exists. Choose another name, or use /set to change its value.',
    reservedVariableName: '"{value}" is the build variant in an expression. Choose another name.',
    unknownTarget: 'Nothing on stage is named "{value}".',
    unsupportedOption: '"{value}" does not apply here. Allowed values: {allowed}.',
    missingCore: "/{token} still needs its {slot}."
  }
};
