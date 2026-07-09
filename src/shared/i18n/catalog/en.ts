/**
 * English catalog — the source of truth for every translatable string.
 *
 * Rules:
 *   - Namespaced by top-level key (`common`, `menu`, `settings`, `launcher`, …).
 *     Add a namespace per app/surface so the tree stays navigable as it grows.
 *   - Leaves are strings. Interpolate with `{name}` placeholders.
 *   - Plurals: give a key `.one` / `.other` (and `.few`/`.many`/… where a locale
 *     needs them) and read it with `translator.tn(baseKey, count)`.
 *   - `as const` is required: the key type and interpolation checks derive from it.
 */
export const en = {
    common: {
        appName: "NarraLeaf Studio",
        ok: "OK",
        cancel: "Cancel",
        save: "Save",
        reset: "Reset",
        close: "Close",
        loading: "Loading…",
    },
    menu: {
        app: {
            preferences: "Preferences…",
        },
        file: {
            title: "File",
            new: "New Workspace",
            open: "Open Workspace",
            export: "Export Project",
            close: "Close Workspace",
        },
        view: {
            title: "View",
        },
        window: {
            title: "Window",
        },
        help: {
            title: "Help",
            welcome: "Open Welcome",
            docs: "Documentation",
        },
    },
    settings: {
        title: "Settings",
        subtitle: "Editor Settings",
        searchPlaceholder: "Search settings…",
        loading: "Loading settings…",
        noResults: "No settings match your search.",
        empty: "No settings available.",
        noneExposed: "No implemented settings are currently exposed.",
        // Category chrome — keys mirror the category `key` in appSettings.ts.
        categories: {
            general: {
                label: "General",
                description: "Application defaults, language, and notifications.",
            },
            appearance: {
                label: "Appearance",
                description: "Interface theme, accent colors, and motion preferences.",
            },
            editor: {
                label: "Editor",
                description: "Font rendering, lines, wrapping and layout defaults.",
            },
            workspace: {
                label: "Workspace",
                description: "Startup behavior, workspace history, and auto-save helpers.",
            },
            sync: {
                label: "Sync",
                description: "Local backup cadence and synchronization helpers.",
            },
            advanced: {
                label: "Advanced",
                description: "Telemetry, developer helpers and experimental toggles.",
            },
        },
        // Individual settings — keyed by the setting they localize.
        items: {
            language: {
                label: "Language",
                description: "Display language for the Studio interface.",
            },
        },
    },
    workspace: {
        localization: {
            panel: {
                languagesTitle: "Languages",
                languagesHint: "Languages of the game itself. The source language is the one you write in; every other language is translated against it.",
                empty: "No languages yet. Add the source language first.",
                addLanguage: "Add language",
                codePlaceholder: "Code (en, ja, zh-CN…)",
                namePlaceholder: "Display name",
                invalidCode: "Language codes may only contain letters, digits, and hyphens.",
                sourceBadge: "Source",
                more: "More",
                confirm: "Confirm",
                setSource: "Set as source language",
                removeLanguage: "Remove language",
                removeConfirm: "Remove {name}?",
                removeConfirmDetail: "Translations stay on disk and come back if the language is added again.",
                openTable: "Open translation table",
                progress: "{completed}/{total} translated",
                staleCount: "{count} to review",
                exportCsv: "Export CSV",
                importCsv: "Import CSV",
                exportDone: "Exported to {path}",
                importSummary: "Imported {applied} translations ({unchanged} unchanged, {unknown} unknown, {skippedEmpty} empty skipped)",
                importFailed: "Could not read the CSV file",
            },
            table: {
                storyLabel: "Source",
                sourceUi: "Interface text",
                sourceKeys: "Named keys",
                emptyUi: "No interface text is marked for localization yet. Enable \"Localize text\" on a text or button widget.",
                modeTranslate: "Translate",
                modeReview: "Review",
                filterAll: "All",
                filterUntranslated: "Untranslated",
                filterStale: "To review",
                filterCompleted: "Translated",
                reviewFilterReviewed: "Reviewed",
                reviewFilterUnreviewed: "Unreviewed",
                charactersGroup: "Characters",
                characterSpeaker: "Character",
                addKey: "Add",
                keyNamePlaceholder: "Key (menu.start…)",
                keySourcePlaceholder: "Source text",
                invalidKeyName: "Key names may contain letters, digits, and dots/underscores/hyphens between them.",
                removeKey: "Remove key",
                removeKeyConfirm: "Remove {name}?",
                removeKeyConfirmDetail: "Existing translations of this key stay in the language files.",
                sourceColumn: "Source",
                targetColumn: "Translation",
                targetPlaceholder: "Translate…",
                narrationSpeaker: "Narration",
                choiceSpeaker: "Choice",
                markReviewed: "Mark as reviewed",
                unmarkReviewed: "Back to translated",
                reviewApprove: "Approve",
                reviewReturn: "Return",
                reviewPendingCount: "{count} pending",
                reviewAllClear: "All caught up — nothing left to review.",
                staleHint: "The source line changed after this translation. Review it, then save to re-anchor.",
                placeholderHint: "Keep the {n} placeholders — they render inline values.",
                emptyStory: "This story has no translatable lines yet.",
                emptyFilter: "Nothing matches this filter.",
                noStories: "Create a story first — its lines appear here for translation.",
                statusUntranslated: "Untranslated",
                statusMachine: "Machine",
                statusTranslated: "Translated",
                statusReviewed: "Reviewed",
                statusStale: "To review",
            },
        },
    },
    launcher: {
        nav: {
            projects: "Projects",
            plugins: "Plugins",
            learning: "Learning",
            settings: "Settings",
        },
        projects: {
            title: "Projects",
            newProject: "New Project",
            openProject: "Open Project",
            import: "Import",
            recentTitle: "Recent Projects",
            empty: "No recent projects yet.",
        },
        // Plural example — read with translator.tn("launcher.recentCount", count).
        recentCount: {
            one: "{count} recent project",
            other: "{count} recent projects",
        },
    },
} as const;
