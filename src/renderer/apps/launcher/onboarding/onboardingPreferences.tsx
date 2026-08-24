import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from "react";
import {
    EDITOR_FONT_FAMILY_DEFAULT,
    EDITOR_FONT_SIZE_DEFAULT,
    EDITOR_FONT_SIZE_MAX,
    EDITOR_FONT_SIZE_MIN,
    editorFontCssFamily,
} from "@/lib/settings/editorFontOptions";
import { LOCALIZED_COMMANDS_DEFAULT, LOCALIZED_COMMANDS_KEY } from "@/lib/settings/commandLanguageOptions";
import { HIDE_PARAM_NAMES_DEFAULT, HIDE_PARAM_NAMES_KEY } from "@/lib/settings/commandParamNameOptions";
import { SLASH_AT_ALIAS_KEY, slashAtAliasDefault } from "@/lib/settings/slashAliasOptions";
import {
    STORY_ROW_HIGHLIGHT_KEY,
    resolveStoryRowHighlight,
    type StoryRowHighlight,
} from "@/lib/settings/storyRowHighlightOptions";
import { ACCENT_COLOR_DEFAULT } from "@shared/constants/accent";
import { normalizeZoomPercent } from "@shared/constants/zoom";
import { useGlobalPreference } from "./useGlobalPreference";

/**
 * Every preference first-run setup can change, read once and shared by the whole flow.
 *
 * Hoisted rather than read where it is used, which is the one structural decision this file makes.
 * The control that changes a preference and the preview that shows what it did are two components on
 * one screen, and each reading the key for itself would put a round trip between them: the switch
 * would move, and the sample under it would follow a moment later. Reading once and handing both the
 * same value makes the pane what it claims to be - the same setting, seen.
 *
 * What is NOT here is the theme, the accent and the zoom's effect. Those are applied by the main
 * process to the window this flow is drawn in, so the window is the sample and no component has to
 * be told - see `AppearanceStep`. Their values still live here, because the controls have to show
 * what is currently chosen.
 *
 * Every resolver is the consumer's own: `resolveStoryRowHighlight`, `slashAtAliasDefault` and the
 * rest are imported from the modules the editor reads them through, so a value that is unset here
 * means exactly what it means there.
 */

/** The story editor's six preferences, as the preview needs them. */
export interface StoryPreferences {
    rowHighlight: StoryRowHighlight;
    fontSize: number;
    /** The stored value: a preset id, or the name of a family installed on this computer. */
    fontFamily: string;
    slashAtAlias: boolean;
    localizedCommands: boolean;
    hideParamNames: boolean;
}

export interface OnboardingPreferences {
    themeMode: string;
    setThemeMode: (next: string) => void;
    accentColor: string;
    setAccentColor: (next: string) => void;
    zoomPercent: number;
    setZoomPercent: (next: number) => void;
    /** Recorded on revisions - `versionControl.authorName` and its address. */
    authorName: string;
    setAuthorName: (next: string) => void;
    authorEmail: string;
    setAuthorEmail: (next: string) => void;
    /** Offered to each new project - `project.defaultAuthor`. */
    defaultAuthor: string;
    setDefaultAuthor: (next: string) => void;
    story: StoryPreferences;
    setStory: <K extends keyof StoryPreferences>(key: K, next: StoryPreferences[K]) => void;
    /** `fontSize` + `fontFamily` as the scene editor spreads them onto story text. */
    storyTextStyle: CSSProperties;
}

/** `STORY_DENSITY_METRICS.compact.lineHeight` - the leading the scene editor sets story text with. */
const PREVIEW_LINE_HEIGHT = 1.5;

function clampFontSize(stored: unknown): number {
    const numeric = typeof stored === "number" ? stored : Number(stored);
    if (!Number.isFinite(numeric)) {
        return EDITOR_FONT_SIZE_DEFAULT;
    }
    return Math.min(EDITOR_FONT_SIZE_MAX, Math.max(EDITOR_FONT_SIZE_MIN, Math.round(numeric)));
}

const STORY_KEYS: Record<keyof StoryPreferences, string> = {
    rowHighlight: STORY_ROW_HIGHLIGHT_KEY,
    fontSize: "editor.fontSize",
    fontFamily: "editor.fontFamily",
    slashAtAlias: SLASH_AT_ALIAS_KEY,
    localizedCommands: LOCALIZED_COMMANDS_KEY,
    hideParamNames: HIDE_PARAM_NAMES_KEY,
};

/**
 * How long a stream of changes has to stop before it is written down.
 *
 * Short enough that walking to the next screen has already recorded what was typed (and the flush on
 * unmount covers the rest), long enough that a name is one write rather than one per letter.
 */
const TEXT_WRITE_DELAY_MS = 400;

const OnboardingPreferencesContext = createContext<OnboardingPreferences | null>(null);

export function useOnboardingPreferences(): OnboardingPreferences {
    const value = useContext(OnboardingPreferencesContext);
    if (!value) {
        throw new Error("useOnboardingPreferences must be used inside OnboardingPreferencesProvider");
    }
    return value;
}

export function OnboardingPreferencesProvider({ children }: { children: ReactNode }) {
    const [themeMode, setThemeMode] = useGlobalPreference("ui.themeMode", stored =>
        (stored === "light" || stored === "dark" || stored === "auto" ? stored : "auto"));
    const [accentColor, setAccentColor] = useGlobalPreference("ui.accentColor", stored =>
        (typeof stored === "string" && stored ? stored : ACCENT_COLOR_DEFAULT));
    const [zoomPercent, setZoomPercent] = useGlobalPreference("ui.zoomPercent", normalizeZoomPercent);

    // Typed into, so the store is written once the typing settles rather than once per keystroke.
    const [authorName, setAuthorName] = useGlobalPreference("versionControl.authorName", asText, TEXT_WRITE_DELAY_MS);
    const [authorEmail, setAuthorEmail] = useGlobalPreference("versionControl.authorEmail", asText, TEXT_WRITE_DELAY_MS);
    const [defaultAuthor, setDefaultAuthor] = useGlobalPreference("project.defaultAuthor", asText, TEXT_WRITE_DELAY_MS);

    const [rowHighlight, setRowHighlight] = useGlobalPreference(STORY_KEYS.rowHighlight, resolveStoryRowHighlight);
    // Dragged, so the same treatment as the fields above: the sample re-types on every pixel of the
    // drag, and the store hears about it when the thumb stops.
    const [fontSize, setFontSize] = useGlobalPreference(STORY_KEYS.fontSize, clampFontSize, TEXT_WRITE_DELAY_MS);
    const [fontFamily, setFontFamily] = useGlobalPreference(STORY_KEYS.fontFamily, stored =>
        (typeof stored === "string" && stored ? stored : EDITOR_FONT_FAMILY_DEFAULT));
    const [slashAtAlias, setSlashAtAlias] = useGlobalPreference(STORY_KEYS.slashAtAlias, stored =>
        (typeof stored === "boolean" ? stored : slashAtAliasDefault()));
    const [localizedCommands, setLocalizedCommands] = useGlobalPreference(STORY_KEYS.localizedCommands, stored =>
        (typeof stored === "boolean" ? stored : LOCALIZED_COMMANDS_DEFAULT));
    const [hideParamNames, setHideParamNames] = useGlobalPreference(STORY_KEYS.hideParamNames, stored =>
        (typeof stored === "boolean" ? stored : HIDE_PARAM_NAMES_DEFAULT));

    const value = useMemo<OnboardingPreferences>(() => {
        const story: StoryPreferences = {
            rowHighlight,
            fontSize,
            fontFamily,
            slashAtAlias,
            localizedCommands,
            hideParamNames,
        };
        const writers: { [K in keyof StoryPreferences]: (next: StoryPreferences[K]) => void } = {
            rowHighlight: setRowHighlight,
            fontSize: setFontSize,
            fontFamily: setFontFamily,
            slashAtAlias: setSlashAtAlias,
            localizedCommands: setLocalizedCommands,
            hideParamNames: setHideParamNames,
        };
        return {
            themeMode,
            setThemeMode,
            accentColor,
            setAccentColor,
            zoomPercent,
            setZoomPercent,
            authorName,
            setAuthorName,
            authorEmail,
            setAuthorEmail,
            defaultAuthor,
            setDefaultAuthor,
            story,
            setStory: (key, next) => (writers[key] as (value: typeof next) => void)(next),
            // The scene editor's own composition (`storyEditorTextStyle`), at the compact density
            // every editor opens at - so the number the author picks is the number they read.
            //
            // `lineHeight` is `STORY_DENSITY_METRICS.compact.lineHeight` restated (the preview
            // restates the editor's metrics rather than importing the workspace bundle for them; see
            // `StoryScenePreview`). It has to be a multiple of the size rather than a length: the
            // rows it lands on wear `text-sm`, whose leading is a fixed `1.25rem`, and a directive
            // row truncates - so at a large size the picked type was clipped above and below in the
            // one pane whose whole job is to show what that size looks like.
            storyTextStyle: { fontSize, fontFamily: editorFontCssFamily(fontFamily), lineHeight: PREVIEW_LINE_HEIGHT },
        };
    }, [
        themeMode, setThemeMode, accentColor, setAccentColor, zoomPercent, setZoomPercent,
        authorName, setAuthorName, authorEmail, setAuthorEmail, defaultAuthor, setDefaultAuthor,
        rowHighlight, setRowHighlight, fontSize, setFontSize, fontFamily, setFontFamily,
        slashAtAlias, setSlashAtAlias, localizedCommands, setLocalizedCommands,
        hideParamNames, setHideParamNames,
    ]);

    return (
        <OnboardingPreferencesContext.Provider value={value}>
            {children}
        </OnboardingPreferencesContext.Provider>
    );
}

/** A stored string, or "" - which is what every one of the three identity fields calls unset. */
function asText(stored: unknown): string {
    return typeof stored === "string" ? stored : "";
}
