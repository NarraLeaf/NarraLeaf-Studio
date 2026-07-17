/** `dashboard` — the project dashboard editor tab: scale, writing activity, builds, structure, cast, localization. */
export const dashboard = {
    loading: "Reading the project…",
    failed: "Could not read the project statistics.",
    retry: "Try again",

    header: {
        lastActive: "Last active",
        trackedSince: "Tracked since",
        never: "Not yet",
    },

    greeting: {
        lateNight: "Working late",
        morning: "Good morning",
        noon: "Good afternoon",
        afternoon: "Good afternoon",
        evening: "Good evening",
    },

    units: {
        words: {
            one: "{count} word",
            other: "{count} words",
        },
        lines: {
            one: "{count} line",
            other: "{count} lines",
        },
        nodes: {
            one: "{count} node",
            other: "{count} nodes",
        },
        days: {
            one: "{count} day",
            other: "{count} days",
        },
    },

    duration: {
        hoursMinutes: "{hours}h {minutes}m",
        minutes: "{minutes}m",
        minutesSeconds: "{minutes}m {seconds}s",
        seconds: "{seconds}s",
    },

    relative: {
        justNow: "Just now",
        minutesAgo: "{count}m ago",
        hoursAgo: "{count}h ago",
        daysAgo: "{count}d ago",
    },

    scale: {
        title: "Scale",
        scenes: "Scenes",
        dialogueLines: "Dialogue lines",
        totalWords: "Words",
        characters: "Characters",
        assets: "Assets",
        blueprints: "Blueprints",
        uiSurfaces: "Interface surfaces",
        variables: "Variables",
    },

    activity: {
        title: "Writing activity",
        description: "Words added per day over the last 30 days.",
        wordsWritten: "Words written",
        activeTime: "Active time",
        edits: "Edits",
        streak: "Streak",
        streakNone: "No streak",
        peak: "Peak {words}",
        empty: "Nothing written yet. Bars appear once a day of writing is recorded.",
        chartLabel: "Words written per day over the last 30 days",
        tooltip: {
            added: "{date} · {words} added",
            removed: "{date} · {words} removed",
            unchanged: "{date} · no change",
            start: "{date} · tracking started, so this day has no baseline to compare against",
            untracked: "{date} · before tracking started",
        },
    },

    builds: {
        title: "Build history",
        ok: "Succeeded",
        failed: "Failed",
        empty: "No builds recorded",
        emptyHint: "Builds you run for this project will be listed here.",
    },

    structure: {
        title: "Structure",
        chapters: "Outline",
        branches: "Branches",
        unreachable: "Unreachable scenes",
        unreachableHint: "No jump path leads to these scenes from the entry scene.",
        emptyScenes: "Empty scenes",
        emptyScenesHint: "These scenes contain no authored content yet.",
        healthy: "No unreachable or empty scenes.",
        more: "and {count} more",
    },

    cast: {
        title: "Cast",
        description: "Speaking characters by word count.",
        empty: "No character has spoken yet.",
    },

    scenes: {
        title: "Scenes",
        description: "Longest scenes by word count.",
        empty: "No scene contains any words yet.",
    },

    localization: {
        title: "Localization",
        translated: "Translated",
        reviewed: "Reviewed",
        untranslated: "Untranslated",
        summary: "{completed} of {total} translated",
    },

    footer: {
        openOnWorkspaceOpen: "Show this dashboard every time the workspace opens",
        clear: "Clear this project's statistics",
        clearConfirm: "Clear this project's statistics?",
        clearDetail:
            "Only the recorded activity history is erased: the writing curve, active time, edit counts and build history. Scene, word, character and localization counts are calculated from the project itself and will not change. This cannot be undone.",
    },
} as const;
