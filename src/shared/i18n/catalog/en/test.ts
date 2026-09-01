/**
 * `test` - the test pipeline: the Run > Test picker, the report tab, the status-bar phase, the
 * console channel, and Studio's own built-in tests.
 *
 * "Test" here means a check an author runs against *their game* (does it reach an ending, does it
 * survive with no network). Nothing in this namespace has anything to do with the repo's own unit
 * tests.
 *
 * Two conventions, both load-bearing:
 *
 *  - A built-in test's strings live under `builtin.<slug>`, where the slug is what
 *    `deriveBuiltInTestSlug` produces from its id - so a renamed id cannot leave dead keys behind.
 *  - Titles are short noun phrases and a description is one clause. Nothing here is a sentence
 *    explaining the UI: the interface does not narrate itself.
 */
export const test = {
    action: {
        // The Run dropdown row, beside Production Build. Ellipsis for the same reason: it opens a
        // picker rather than starting anything.
        open: "Test…",
        // The palette entry that opens that same picker.
        run: "Run a test",
        stop: "Stop the test",
    },
    // The mode name in the status bar's run cell, which reads "<mode> | <phase>". The phase itself
    // comes from `workspace.shell.statusBar.phase.*`, shared with the other run kinds.
    statusBar: {
        label: "Test",
    },
    category: {
        integrity: "Integrity",
        runtime: "Runtime",
        compatibility: "Compatibility",
        custom: "Custom",
    },
    // Badged on every picker row: whether a game window is about to appear.
    presentation: {
        headless: "Headless",
        windowed: "Windowed",
    },
    picker: {
        title: "Run a test",
        start: "Start",
        empty: "No tests are registered",
        // Names the row of controls the selected test asks the author to fill in. Not drawn as a
        // heading - it is there so the group reaches assistive tech with a name.
        parameters: "Parameters",
    },
    status: {
        running: "Running",
        passed: "Passed",
        failed: "Failed",
        skipped: "Skipped",
        cancelled: "Cancelled",
        errored: "Errored",
    },
    severity: {
        error: "Error",
        warning: "Warning",
        info: "Info",
    },
    report: {
        title: "Test Report",
        // Two different silences: a finished run that found nothing, and a tab with no run behind it.
        empty: "No findings",
        none: "No run yet",
        rerun: "Run again",
        severityFilter: "Severity",
        filterAll: "All",
        findings: "{errors} errors, {warnings} warnings, {infos} info",
        durationSeconds: "{seconds}s",
        durationMinutes: "{minutes}m {seconds}s",
    },
    // Why a picker row is greyed out. An unavailable test is a normal state, not an error.
    reason: {
        // The project arrived from a package or a remote source and nobody has vouched for it yet.
        // Names the remedy, because there is one and it is where the author would look for it.
        distrusted: "Not available until this project is trusted in Settings",
        frozen: "Not available while the workspace is frozen",
        alreadyRunning: "Another run is in progress",
        // A test that asks which one, in a project that has none yet. `parameter` is the
        // parameter's own label, so the row reads "Ending has no values in this project".
        parameterEmpty: "{parameter} has no values in this project",
    },
    console: {
        channel: "Test",
        started: "{title} started",
        finished: "{title} {status} in {duration}",
        finding: "{severity} {message}",
    },
    toast: {
        passed: "{title} passed",
        failed: "{title} failed",
        skipped: "{title} skipped",
        cancelled: "{title} cancelled",
        errored: "{title} could not run",
    },
    builtin: {
        projectDiagnostics: {
            title: "Project diagnostics",
            description: "All project check rules, run as one test",
            summary: {
                passed: "No problems found",
                failed: "{errors} errors, {warnings} warnings",
            },
        },
        walkthrough: {
            title: "Ending walkthrough",
            // States where the run begins, because that is the one thing about it an author cannot
            // see from the title and would otherwise have to guess.
            description: "Plays the game to one ending, starting the story at its own entry scene",
            parameter: {
                ending: {
                    label: "Ending",
                    description: "The ending to walk to",
                    // Story, scene and name together: no one of them tells two endings apart.
                    option: "{story} / {scene} / {ending}",
                    unnamed: "Unnamed ending",
                },
            },
            log: {
                planned: "Route planned: {scenes} scenes, {decisions} decisions",
                choosing: "{scene}: choosing \"{option}\"",
                improvised: "Answered an unplanned choice with \"{option}\"",
            },
            finding: {
                endingMissing: "That ending is no longer in the story",
                noEntryPoint: "Nothing names a scene for {story} to begin at",
                unreachable: "No route reaches {ending} from where {story} begins",
                optionMissing: "{scene} did not offer \"{option}\", so this route is not walkable",
                otherEnding: "Reached {reached} instead of {ending}",
                endedWithoutEnding: "The story ended without reaching {ending}",
                stalled: "Stopped advancing after {steps} steps without reaching {ending}",
                cancelled: "Cancelled after {steps} steps",
                exit: {
                    closed: "The game closed before reaching {ending}",
                    stopped: "The game was stopped before reaching {ending}",
                    crashed: "The game crashed before reaching {ending}",
                    failedToStart: "The game could not start",
                },
            },
            summary: {
                passed: "Reached {ending}",
            },
        },
        routeCoverage: {
            title: "Route coverage",
            description: "Whether every scene, option and ending can be reached once conditions are read",
            skipped: {
                noEntryPoint: "No story marks where play begins",
                undecidableEntry: "A Start Story node picks its scene while the game runs, so where play begins cannot be read",
                storiesUnread: "A story could not be read",
            },
            // Each of these means the same thing in a different unit: the rows lead here, and the
            // numbers never do. Worded so an author can tell that from a structural dead end.
            finding: {
                sceneUnreachable: "No path can satisfy the conditions leading to \"{scene}\"",
                optionUnreachable: "No path can satisfy the condition for offering \"{option}\"",
                branchUnreachable: "No path can satisfy the condition for taking this branch",
                endingUnreachable: "\"{name}\" is written but no path can satisfy the conditions to reach it",
                endingUnreachableUnnamed: "This ending is written but no path can satisfy the conditions to reach it",
            },
            summary: {
                passed: "Everything the script leads to can be reached",
                failed: "Unreachable: scenes {scenes}, options {options}, endings {endings}",
            },
        },
        reachableEndings: {
            title: "Reachable endings",
            description: "Whether every way through the story reaches an /ending",
            // Declining is a normal state, so each of these says what the project is in rather than
            // what the author did wrong, and names the one thing that would let the test run.
            skipped: {
                noEndings: "No story with an entry point marks an /ending",
                noEntryPoint: "No story marks where play begins",
                undecidableEntry: "A Start Story node picks its scene while the game runs, so where play begins cannot be read",
                storiesUnread: "A story could not be read",
            },
            finding: {
                pathRunsOut: "Play stops here without reaching an ending",
                optionRunsOut: "\"{option}\" stops without reaching an ending",
                endingUnreached: "No path reaches \"{name}\"",
                endingUnreachedUnnamed: "No path reaches this ending",
            },
            // Noun-first so the numbers read at any count, and both halves are stated either way:
            // an ending nothing reaches is worth knowing about a run that passed.
            summary: {
                passed: "Every path reaches an ending. Endings never reached: {unreached} of {endings}",
                failed: "Paths that run out: {errors}. Endings never reached: {unreached} of {endings}",
            },
        },
    },
} as const;
