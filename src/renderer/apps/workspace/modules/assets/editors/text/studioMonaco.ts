// The core editor, not the `monaco-editor` barrel. The barrel is `editor.main.js`, which pulls in
// every basic language plus the CSS/HTML/JSON/TypeScript *language services* - and each of those
// runs in a web worker. This window's document is a `file://` page whose scripts are served over
// `app://`, so a worker spawned from a relative path is a cross-origin request that Chromium
// refuses; the whole design below is "never ask for a worker".
//
// `edcore.main.js` is the level between the bare API (`editor.api.js`, which registers no editor
// contributions at all - no find widget, no bracket matching, no context menu) and the barrel. It
// is the complete editing experience with no language services attached, which is exactly the
// bargain this tab wants.
//
// Two imports rather than one because the two entries are two halves of the same module graph:
// `editor.api` is the typed API surface (and the only one monaco ships a `.d.ts` for), while
// `edcore.main` re-exports those same objects and, above that line, registers every contribution.
// Taking the API from the first and the registrations from the second gets both without a
// hand-written declaration that could drift.
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/editor/edcore.main.js";
// Monarch grammars for the extensions `textEditableFiles` maps. These tokenize on the main thread;
// none of them is a language *service*.
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js";
import "monaco-editor/esm/vs/basic-languages/ini/ini.contribution.js";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js";
import "monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js";
import { getInterface } from "@/lib/app/bridge";
import {
    normalizeTextEditorExtension,
    type PluginTextEditorLanguageDef,
} from "@/lib/workspace/services/ui/textEditorContributions";

export { monaco };

export const STUDIO_MONACO_THEME = "narraleaf-studio";

/**
 * Every editor feature that would reach for the editor web worker, switched off.
 *
 * This is the load-bearing half of the no-worker design, so each entry is here for a named reason
 * rather than as taste:
 *
 *  - `wordBasedSuggestions` / `quickSuggestions` - textual suggest is computed by the worker.
 *  - `links` - the link detector calls `computeLinks` on the worker, and would do it on every
 *    document containing a URL, which a shared plan file certainly does.
 *  - `unicodeHighlight.*` - `computeUnicodeHighlights` runs on the worker, and it would run on
 *    *every* CJK document, which is the case this feature exists to serve.
 *  - `occurrencesHighlight` - textual occurrences go through the worker.
 *  - `codeLens`, `colorDecorators`, `defaultColorDecorators` - the default colour provider asks the
 *    worker for document colours.
 *  - `inlineSuggest`, `parameterHints`, `suggestOnTriggerCharacters`, `hover` - no providers exist
 *    for plain text, so these are dead weight that can only produce an empty widget.
 *  - `dropIntoEditor` / `pasteAs` - same: provider-driven, nothing registered, and `pasteAs` puts a
 *    widget on screen after every paste for no gain.
 *  - `minimap.showMarkSectionHeaders` / `showRegionSectionHeaders` - **the one that actually bit.**
 *    `SectionHeaderDetector` reads these two and *not* `minimap.enabled`, so switching the minimap
 *    off left it running, and it calls `findSectionHeaders` on the worker the moment a model is
 *    attached. It was the only thing in this list that had to be found by watching the real app
 *    rather than by reading the option names.
 *
 * What is deliberately left ON: find/replace, multi-cursor, bracket matching, folding, undo,
 * the context menu. All main-thread, and all part of "a reasonably complete editor".
 */
export const WORKER_FREE_EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
    minimap: { enabled: false, showMarkSectionHeaders: false, showRegionSectionHeaders: false },
    wordBasedSuggestions: "off",
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    links: false,
    codeLens: false,
    colorDecorators: false,
    defaultColorDecorators: "never",
    occurrencesHighlight: "off",
    unicodeHighlight: {
        ambiguousCharacters: false,
        invisibleCharacters: false,
        nonBasicASCII: false,
        includeComments: false,
        includeStrings: false,
    },
    inlineSuggest: { enabled: false },
    parameterHints: { enabled: false },
    hover: { enabled: false },
    stickyScroll: { enabled: false },
    dropIntoEditor: { enabled: false },
    pasteAs: { enabled: false },
    formatOnPaste: false,
    formatOnType: false,
};

/**
 * Language ids `monaco.languages.register` has already been given. Monaco's own language list is
 * global and additive - calling `register` twice for one id declares the same language twice - so
 * the guard has to live here rather than at the call site, which is a React effect that runs per
 * tab. Never cleared: an id monaco knows about, it knows about for the life of the window.
 */
const registeredPluginLanguages = new Set<string>();

/**
 * The definition each installed language's grammar came from.
 *
 * Keyed on the *definition*, not just the id, because the id alone cannot answer "is what monaco
 * holds still what the registry says". A plugin that reloads registers a fresh object, and marking
 * the id installed forever would leave every window pinned to the grammar of the version that
 * happened to open the first document. Re-installing is cheap and safe: the tokens provider and the
 * language configuration are keyed registries in monaco, so setting them again replaces rather than
 * stacks.
 */
const installedPluginLanguages = new Map<string, PluginTextEditorLanguageDef>();

/**
 * Install a plugin's language into monaco, on the first document that needs it and again whenever
 * the registered definition is no longer the one that was installed.
 *
 * Deferred to here rather than done when the plugin registers because this module *is* monaco:
 * importing it at plugin-setup time would drag the whole editor into workspace startup for every
 * project, opened text file or not.
 *
 * A grammar that throws is logged and dropped, not rethrown: a plugin's malformed monarch rules
 * must not be the reason an author cannot open a shared plan. It is also not recorded as installed -
 * marking a failed install would make the caller's fallback to the built-in mapping permanent, and
 * would hand the *next* caller an id monaco has no grammar for, which degrades to plaintext with
 * nothing said.
 */
export function installPluginTextEditorLanguage(def: PluginTextEditorLanguageDef): string | null {
    if (installedPluginLanguages.get(def.id) === def) {
        return def.id;
    }
    try {
        if (!registeredPluginLanguages.has(def.id)) {
            monaco.languages.register({
                id: def.id,
                // Monaco wants the dot; the registry accepts either spelling from plugins.
                extensions: def.extensions.map(extension => `.${normalizeTextEditorExtension(extension)}`),
                aliases: def.aliases,
            });
            registeredPluginLanguages.add(def.id);
        }
        if (def.monarch) {
            monaco.languages.setMonarchTokensProvider(
                def.id,
                def.monarch as unknown as monaco.languages.IMonarchLanguage,
            );
        }
        if (def.configuration) {
            monaco.languages.setLanguageConfiguration(
                def.id,
                def.configuration as unknown as monaco.languages.LanguageConfiguration,
            );
        }
        installedPluginLanguages.set(def.id, def);
        return def.id;
    } catch (error) {
        console.error(`[text-editor] failed to install plugin language "${def.id}":`, error);
        installedPluginLanguages.delete(def.id);
        return null;
    }
}

function readChannels(styles: CSSStyleDeclaration, name: string, fallback: string): string {
    const raw = styles.getPropertyValue(name).trim();
    const parts = raw.split(/[\s,/]+/).filter(Boolean).slice(0, 3);
    if (parts.length !== 3) {
        return fallback;
    }
    const hex = parts
        .map(part => Math.max(0, Math.min(255, Number(part) || 0)).toString(16).padStart(2, "0"))
        .join("");
    return `#${hex}`;
}

function isDark(hex: string): boolean {
    const value = parseInt(hex.slice(1), 16);
    // Rec. 601 luma, the same rough test the accent contrast helper uses.
    const luma = 0.299 * ((value >> 16) & 0xff) + 0.587 * ((value >> 8) & 0xff) + 0.114 * (value & 0xff);
    return luma < 128;
}

/**
 * Define (or redefine) the Studio Monaco theme from the workspace's own CSS variables.
 *
 * Reading the live custom properties rather than hard-coding two palettes is what keeps the editor
 * from being the one surface in Studio that ignores the user's accent and theme - and it means a
 * palette change in `styles.css` reaches here with no second edit.
 *
 * Monaco themes are global, not per-editor, so this is idempotent by construction: calling it again
 * after a theme switch repaints every open text tab.
 */
export function defineStudioMonacoTheme(): void {
    const styles = getComputedStyle(document.documentElement);
    const background = readChannels(styles, "--nl-surface-sunken", "#0b0d12");
    const foreground = readChannels(styles, "--nl-fg", "#eef1f5");
    const subtle = readChannels(styles, "--nl-fg-subtle", "#6b7480");
    const muted = readChannels(styles, "--nl-fg-muted", "#9aa3ae");
    const accent = readChannels(styles, "--nl-primary", "#40a8c4");
    const success = readChannels(styles, "--nl-success", "#6db094");
    const warning = readChannels(styles, "--nl-warning", "#ccaa5c");
    const dark = isDark(background);

    monaco.editor.defineTheme(STUDIO_MONACO_THEME, {
        base: dark ? "vs-dark" : "vs",
        // Inherit, then override: the base themes carry rules for token types no plain-text or
        // Markdown document produces, and re-deriving all of them here would be a palette nobody
        // maintains.
        inherit: true,
        rules: [
            { token: "comment", foreground: subtle.slice(1) },
            { token: "keyword", foreground: accent.slice(1) },
            { token: "string", foreground: success.slice(1) },
            { token: "number", foreground: warning.slice(1) },
            { token: "attribute.name", foreground: accent.slice(1) },
            { token: "tag", foreground: accent.slice(1) },
        ],
        colors: {
            "editor.background": background,
            "editor.foreground": foreground,
            "editorLineNumber.foreground": subtle,
            "editorLineNumber.activeForeground": muted,
            "editorCursor.foreground": foreground,
            "editorIndentGuide.background1": subtle,
            "editorWidget.background": readChannels(styles, "--nl-surface-raised", "#1e1f22"),
            "editorWidget.foreground": foreground,
            "input.background": readChannels(styles, "--nl-surface", "#0f1115"),
            "input.foreground": foreground,
            "focusBorder": accent,
        },
    });
}

const THEME_SETTINGS_KEY = "ui.themeMode";

let themeWatchers = 0;
let releaseThemeWatch: (() => void) | null = null;

/**
 * Keep the Monaco theme in step with Studio's, for as long as at least one text tab is open.
 *
 * **Refcounted, and shared.** A Monaco theme is global - repainting it once repaints every open
 * editor - so a subscription per tab would be pure duplication. It would also be a slow leak in
 * disguise: the global-state emitter warns past ten listeners, and Studio is already close to that
 * with its zoom, locale and appearance subscribers, so two or three open plan files were enough to
 * push a `MaxListenersExceededWarning` into the console.
 *
 * Both sources are watched because neither is sufficient on its own: Electron drives
 * `prefers-color-scheme` from `nativeTheme.themeSource`, but on some versions it updates the media
 * query's value *without* dispatching `change` (the note in `lib/appearance` records that), and the
 * setting broadcast covers exactly that case.
 */
export function watchStudioMonacoTheme(): () => void {
    themeWatchers += 1;
    if (themeWatchers === 1) {
        const repaint = () => {
            defineStudioMonacoTheme();
            monaco.editor.setTheme(STUDIO_MONACO_THEME);
        };
        const query = window.matchMedia("(prefers-color-scheme: dark)");
        query.addEventListener("change", repaint);
        const token = getInterface().app.state.onGlobalStateChanged?.(change => {
            if (change.key === THEME_SETTINGS_KEY) {
                repaint();
            }
        });
        releaseThemeWatch = () => {
            query.removeEventListener("change", repaint);
            token?.cancel();
        };
    }
    let released = false;
    return () => {
        if (released) {
            return;
        }
        released = true;
        themeWatchers -= 1;
        if (themeWatchers === 0) {
            releaseThemeWatch?.();
            releaseThemeWatch = null;
        }
    };
}
