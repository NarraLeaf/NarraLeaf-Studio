import { AppSettingDefinition, SettingCategory, SettingScope } from "@/lib/settings/models";
import { SettingValueType } from "@/lib/settings/types";
import {
    EDITOR_FONT_FAMILY_DEFAULT,
    EDITOR_FONT_FAMILY_OPTIONS,
    EDITOR_FONT_SIZE_DEFAULT,
    EDITOR_FONT_SIZE_MAX,
    EDITOR_FONT_SIZE_MIN,
} from "@/lib/settings/editorFontOptions";

/**
 * Category metadata used by the shared settings UI.
 */
export const AppSettingCategories: SettingCategory[] = [
    {
        key: "general",
        label: "General",
        description: "Application defaults, language, and notifications.",
        order: 0,
    },
    {
        key: "appearance",
        label: "Appearance",
        description: "Interface theme, accent colors, and motion preferences.",
        order: 1,
    },
    {
        key: "editor",
        label: "Editor",
        description: "Font rendering, lines, wrapping and layout defaults.",
        order: 2,
    },
    {
        key: "workspace",
        label: "Workspace",
        description: "Startup behavior, workspace history, and auto-save helpers.",
        order: 3,
    },
    {
        key: "sync",
        label: "Sync",
        description: "Local backup cadence and synchronization helpers.",
        order: 4,
    },
    {
        key: "advanced",
        label: "Advanced",
        description: "Telemetry, developer helpers and experimental toggles.",
        order: 5,
    },
];

/**
 * Implemented application-wide settings.
 *
 * Do not add placeholders here. A setting belongs in this list only after
 * production code reads the stored value and applies it to real behavior.
 */
export const AppSettings: AppSettingDefinition[] = [
    {
        // Applied by the Story scene editor via `storyEditorTextStyle.tsx`.
        key: "editor.fontSize",
        category: "editor",
        scope: SettingScope.Global,
        type: SettingValueType.Integer,
        label: "Story editor font size",
        description: `Font size (px) for dialogue, narration, and choice text in the story scene editor (${EDITOR_FONT_SIZE_MIN}–${EDITOR_FONT_SIZE_MAX}).`,
        defaultValue: EDITOR_FONT_SIZE_DEFAULT,
    },
    {
        // Applied by the Story scene editor via `storyEditorTextStyle.tsx`.
        key: "editor.fontFamily",
        category: "editor",
        scope: SettingScope.Global,
        type: SettingValueType.Enum,
        label: "Story editor font",
        description: "Typeface used for story text in the scene editor.",
        defaultValue: EDITOR_FONT_FAMILY_DEFAULT,
        options: [...EDITOR_FONT_FAMILY_OPTIONS],
    },
];
