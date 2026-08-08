/**
 * `lint` - project lint: rule titles and messages, the report tab, the console channel, and the
 * Project -> Linting settings section.
 *
 * Two conventions this namespace holds to, both enforced by tests elsewhere:
 *
 *  - Every rule has `title`, `description` and `message` under its camelCase slug
 *    (`lint.rule.<slug>`), and `registry.test.ts` fails if a registered rule is missing any of them
 *    in either catalogue. A rule's variant messages sit beside `message` as `message<Variant>`.
 *  - Titles are short noun phrases; descriptions are one clause and appear only in a hint popover.
 *    Nothing here is a sentence explaining the UI - the interface does not narrate itself.
 *
 * **A message never names the place it was found.** Every surface that prints one prints the site
 * beside it - the report tab in its own column, the build console through
 * `nonRedundantLintLocation` - so "First Day jumps to the undeclared label ending" said "First Day"
 * twice, and the half of the sentence that told the two findings apart was the half that got
 * ellipsed away. The message is the predicate; the locator is the subject.
 */
export const lint = {
    rule: {
        assetsUnused: {
            title: "Unused asset",
            description: "Nothing in the project references this asset",
            message: "{asset} is not used anywhere",
        },
        assetsMissing: {
            title: "Missing asset",
            description: "A reference names an asset the library no longer has",
            message: "{location} references a missing asset",
        },
        assetsUnreadable: {
            title: "Unreadable asset",
            description: "The file cannot be read or decoded",
            message: "{asset} cannot be decoded",
            messageMissingBytes: "{asset} cannot be read from disk",
        },
        portabilityAssetName: {
            title: "Unsafe file name",
            description: "Characters or names some filesystems reject",
            message: "{asset} cannot be written on every platform",
        },
        portabilityCaseCollision: {
            title: "Case collision",
            description: "Names that differ only by letter case",
            message: "{asset} collides with {other} on case-insensitive filesystems",
        },
        portabilityMediaFormat: {
            title: "Unplayable format",
            description: "A codec some selected build targets cannot play",
            message: "{asset} does not play on {platform}",
        },
        networkFetchDisallowed: {
            title: "Network node without network access",
            description: "A network node in a project that does not allow HTTP",
            message: "{blueprint} makes a network request, which this project does not allow",
        },
        storyInvalidCommand: {
            title: "Invalid command",
            description: "A row the compiler refuses",
            message: "This row does not compile",
        },
        storyGotoMissing: {
            title: "Missing label",
            description: "A goto naming a label the scene does not declare",
            message: "Jumps to {label}, which this scene never declares",
        },
        storyLabelDuplicate: {
            title: "Duplicate label",
            description: "Two declarations of one label; the first wins",
            message: "{label} is already declared above, so this one is never reached",
        },
        storyLabelUnused: {
            title: "Unused label",
            description: "A label nothing jumps to",
            message: "Nothing jumps to {label}",
        },
        storyJumpMissing: {
            title: "Missing scene",
            description: "A jump naming a scene the project does not have",
            message: "Jumps to a scene the story no longer has",
        },
        storyEmptyChoice: {
            title: "Empty choice",
            description: "A choice with nothing the player can pick",
            message: "This choice has no options",
            messageEmptyOption: "This option has no text",
        },
        storyDeadEnd: {
            title: "Dead end",
            description: "A scene that leaves on some paths and runs off the end on another",
            message: "Play runs off the end of the scene here",
        },
        storyUnreachableScene: {
            title: "Unreachable scene",
            description: "A scene nothing can reach from the start",
            message: "Nothing reaches this scene",
        },
        storyEmptyScene: {
            title: "Empty scene",
            description: "A scene with no content",
            message: "This scene has no rows",
        },
        variablesUndeclared: {
            title: "Undeclared variable",
            description: "A variable used without a declaration",
            message: "{variable} is used but never declared",
        },
        variablesUnused: {
            title: "Unused variable",
            description: "A variable declared but never read or written",
            message: "{variable} is declared but never used",
        },
        variablesNameCollision: {
            title: "Variable name collision",
            description: "One name declared in two places",
            message: "{variable} is declared twice as a persistent variable",
        },
        variablesRandomOutsideAssignment: {
            title: "Random outside an assignment",
            description: "A random value somewhere it is re-rolled instead of kept",
            message: "{fn}() is re-rolled every time this condition is tested, so the branch can change between checks. Roll it once with /set, then test that variable",
            messageChoiceOption: "{fn}() is re-rolled every time the menu draws, so this option flickers. Roll it once with /set, then test that variable",
            messageInterpolation: "{fn}() is re-rolled every time this line draws, so the value changes on every redraw. Roll it once with /set, then show that variable",
        },
        textOverlong: {
            title: "Overlong line",
            description: "A line wider than the dialogue box holds",
            message: "{width} characters wide, over {max}",
        },
        textEmpty: {
            title: "Empty line",
            description: "A dialogue row with no text",
            message: "This line has no text",
        },
        localizationMissing: {
            title: "Missing translation",
            description: "A line with no translation in a target language",
            message: "No {locale} translation",
        },
        localizationStale: {
            title: "Stale translation",
            description: "The source line changed after it was translated",
            message: "{locale} translation is older than the line",
        },
        localizationOrphan: {
            title: "Orphan translation",
            description: "A translation whose line no longer exists",
            message: "{count} {locale} translations have no line",
        },
        voiceMissing: {
            title: "Missing voice",
            description: "A line with no recording in a voiced language",
            message: "No {locale} recording",
        },
        voiceStale: {
            title: "Stale voice",
            description: "The line changed after it was recorded",
            message: "{locale} recording is older than the line",
        },
        voiceOrphan: {
            title: "Orphan voice",
            description: "A recording whose line no longer exists",
            message: "{count} {locale} recordings have no line",
        },
    },
    message: {
        ruleFailed: "{rule} could not run",
        storyLoadFailed: "{story} could not be opened",
    },
    category: {
        assets: "Assets",
        portability: "Portability",
        network: "Network",
        story: "Story",
        variables: "Variables",
        text: "Text",
        localization: "Localization",
        voice: "Voice",
    },
    severity: {
        error: "Error",
        warning: "Warning",
        info: "Info",
        off: "Off",
    },
    report: {
        title: "Problems",
        empty: "No problems found",
        running: "Checking…",
        summary: "{errors} errors, {warnings} warnings, {infos} info",
        filtered: "{shown} of {total}",
        rerun: "Run again",
        filterAll: "All",
        groupByRule: "By rule",
        groupByLocation: "By location",
        collapse: "Collapse",
        expand: "Expand",
        collapseAll: "Collapse all",
        expandAll: "Expand all",
        // The gutter number of the row, spoken. Screen readers get "line 12"; the column itself is
        // bare digits, because that is what the scene editor's own gutter shows and the reader is
        // matching one against the other.
        lineAria: "Line {line}",
    },
    command: {
        runProject: "Check project",
        category: "Lint",
    },
    console: {
        started: "Check started",
        finished: "{errors} errors, {warnings} warnings in {duration}",
        // Site first, then what is wrong, then the rule that says so - a compiler's line, and the
        // order a reader scans in. No severity slot: the console prints the level in its own column
        // beside every line, and this used to repeat it inside the sentence.
        finding: "{location} {message} ({rule})",
    },
    build: {
        blocked: "Build stopped by {count} problems",
        // Spelled out panel → page → row, because the gate is on by default: an author who never
        // opened this panel has no reason to know the setting exists, and "in the lint settings"
        // would leave them looking for it.
        blockedHint: "Change this in Project → Linting → Check before building",
        skipped: "Project check skipped",
    },
    settings: {
        runOnBuild: "Check before building",
        runOnBuildHint: "Runs the project check as part of a production build",
        failBuildOn: "Stop the build on",
        failBuildOnError: "Errors",
        failBuildOnWarning: "Warnings and errors",
        optionMaxChars: "Maximum width",
        optionCountMode: "Counting",
        // Short because they have to be: these are the options of a select in a sidebar panel,
        // inset under its rule, and a sentence-long label is one that gets ellipsed to nothing.
        // The pair carries the meaning - the unit is columns, and the question is what a wide
        // character costs.
        countModeEastAsianWidth: "Wide = 2 columns",
        countModeCodePoints: "All = 1 column",
    },
} as const;
