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
        storyInvalidCommand: {
            title: "Invalid command",
            description: "A row the compiler refuses",
            message: "{scene} has an invalid command",
        },
        storyGotoMissing: {
            title: "Missing label",
            description: "A goto naming a label the scene does not declare",
            message: "{scene} jumps to the undeclared label {label}",
        },
        storyLabelDuplicate: {
            title: "Duplicate label",
            description: "Two declarations of one label; the first wins",
            message: "{scene} declares {label} more than once",
        },
        storyLabelUnused: {
            title: "Unused label",
            description: "A label nothing jumps to",
            message: "{label} is never used in {scene}",
        },
        storyJumpMissing: {
            title: "Missing scene",
            description: "A jump naming a scene the project does not have",
            message: "{scene} jumps to a missing scene",
        },
        storyEmptyChoice: {
            title: "Empty choice",
            description: "A choice with nothing the player can pick",
            message: "{scene} has a choice with no options",
            messageEmptyOption: "{scene} has a choice option with no text",
        },
        storyDeadEnd: {
            title: "Dead end",
            description: "A scene that leaves on some paths and runs off the end on another",
            message: "{scene} runs off the end",
        },
        storyUnreachableScene: {
            title: "Unreachable scene",
            description: "A scene nothing can reach from the start",
            message: "{scene} cannot be reached",
        },
        storyEmptyScene: {
            title: "Empty scene",
            description: "A scene with no content",
            message: "{scene} is empty",
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
        textOverlong: {
            title: "Overlong line",
            description: "A line wider than the dialogue box holds",
            message: "{width} characters wide, over {max}",
        },
        textEmpty: {
            title: "Empty line",
            description: "A dialogue row with no text",
            message: "{scene} has a line with no text",
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
        rerun: "Run again",
        filterAll: "All",
        groupByRule: "By rule",
        groupByLocation: "By location",
    },
    command: {
        runProject: "Check project",
        category: "Lint",
    },
    console: {
        started: "Check started",
        finished: "{errors} errors, {warnings} warnings in {duration}",
        finding: "{severity} {rule} {location} {message}",
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
