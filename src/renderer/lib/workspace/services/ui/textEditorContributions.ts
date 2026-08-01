import type { ComponentType, ReactNode } from "react";
import type { TranslationKey } from "@shared/i18n";
import type { TextEncodingId } from "@shared/types/textEncoding";

/**
 * What a plugin may add to Studio's built-in text editor.
 *
 * Studio ships the editor and nothing on top of it: no Markdown preview, no lint, no formatter.
 * Those are plugin work, and this module is the whole of what a plugin needs to do them - a
 * grammar, a preview pane, a command. The host registry is
 * `TextEditorContributionService`; the plugin-facing names are re-exported from
 * `@/plugin` and published in the `narraleaf-studio` types package.
 *
 * Two rules the rest of the design follows from:
 *
 *  - **Imperative, not declarative.** There is no `contributes.textEditor` manifest key, for the
 *    same reason `ui.panels` has none: nothing outside the editor session needs to know these
 *    exist, so a static declaration would be bookkeeping with no reader.
 *  - **Nothing is rendered for an empty registry.** A preview toggle with no preview behind it is
 *    a dead control, and the editor's status bar is values-only by design. The consumer shows the
 *    toggles for the previews that match *this* document's extension and nothing otherwise.
 */

/** The character encoding a document is currently being read and written in. */
export type PluginTextEditorEncodingId = TextEncodingId;

/**
 * A Monarch grammar - monaco's `languages.IMonarchLanguage`.
 *
 * Typed structurally rather than by importing monaco's declarations: the published
 * `narraleaf-studio` types package would otherwise have to carry monaco's entire `.d.ts` surface,
 * and a plugin would need monaco installed to write a twenty-line grammar. The host casts on the
 * way into `monaco.languages.setMonarchTokensProvider`.
 */
export type PluginTextEditorMonarchGrammar = {
    tokenizer: Record<string, unknown>;
    [key: string]: unknown;
};

/** A monaco `languages.LanguageConfiguration` (comments, brackets, auto-closing pairs, folding). */
export type PluginTextEditorLanguageConfiguration = Record<string, unknown>;

/**
 * A language the built-in editor should colour.
 *
 * Registered into monaco **lazily** - the first time a document with one of these extensions is
 * opened, not when the plugin's `setup` runs. Monaco is a large module that Studio loads on the
 * first text tab and never before; a language registration at setup time would drag it into
 * startup for every workspace, whether or not a text file is ever opened.
 */
export type PluginTextEditorLanguageDef = {
    /** Monaco language id. Must be prefixed with the plugin id. */
    id: string;
    /** File extensions, with or without the leading dot; matched case-insensitively. */
    extensions: string[];
    aliases?: string[];
    monarch?: PluginTextEditorMonarchGrammar;
    configuration?: PluginTextEditorLanguageConfiguration;
};

/**
 * What a preview component is handed on every render.
 *
 * `text` is the live buffer, not the bytes on disk: a preview that lagged behind the last save
 * would be a preview of the wrong document. `active` is the *tab's* active flag, so a preview
 * that animates or polls can stand down while its tab is in the background.
 */
export type PluginTextEditorPreviewProps = {
    text: string;
    encoding: PluginTextEditorEncodingId;
    fileName: string;
    assetId: string;
    active: boolean;
};

/**
 * A rendered view of the document, shown beside the editor.
 *
 * The toggle for it appears in the editor's status bar **if and only if** this document's
 * extension matches - so a project with no such plugin has no preview control anywhere.
 */
export type PluginTextEditorPreviewDef = {
    /** Must be prefixed with the plugin id. */
    id: string;
    /** File extensions this preview can render, with or without the leading dot. */
    extensions: string[];
    title: string;
    /** i18n key for the title; resolved at render, so it follows a live language switch. */
    titleKey?: TranslationKey;
    icon?: ReactNode;
    component: ComponentType<PluginTextEditorPreviewProps>;
};

/**
 * The document, as an action sees it. `getText`/`setText` address the live buffer; writing
 * through `setText` marks the tab modified and rides the editor's own debounced autosave, so an
 * action never has to know how a text asset is persisted.
 */
export type PluginTextEditorActionContext = {
    assetId: string;
    fileName: string;
    encoding: PluginTextEditorEncodingId;
    getText(): string;
    setText(text: string): void;
};

/**
 * A command over the open document - format, sort, insert a table of contents.
 *
 * `extensions` omitted means every document Studio's text editor can open. Like previews, an
 * action's control exists only while at least one action matches the open document.
 */
export type PluginTextEditorActionDef = {
    /** Must be prefixed with the plugin id. */
    id: string;
    title: string;
    /** i18n key for the title; resolved at render, so it follows a live language switch. */
    titleKey?: TranslationKey;
    icon?: ReactNode;
    /** Restrict to these extensions; omit to offer the action on every text document. */
    extensions?: string[];
    run(ctx: PluginTextEditorActionContext): void | Promise<void>;
};

/**
 * An extension in the one form the registry compares: lowercased, no leading dot.
 *
 * Both spellings have to be accepted on the way in. Monaco's own language registrations write
 * `".md"`, `textEditableFiles` writes `"md"`, and a plugin author will copy whichever they saw
 * last - a registry that quietly matched only one of them would leave the other silently dead.
 */
export function normalizeTextEditorExtension(extension: string): string {
    return extension.trim().replace(/^\.+/, "").toLowerCase();
}

/**
 * Whether a contribution declaring `extensions` applies to a file with this extension.
 *
 * `undefined` means "every text document" - only actions may omit the list; languages and
 * previews are meaningless without one.
 */
export function textEditorContributionMatches(
    extensions: readonly string[] | undefined,
    extension: string,
): boolean {
    if (!extensions) {
        return true;
    }
    const wanted = normalizeTextEditorExtension(extension);
    if (!wanted) {
        return false;
    }
    return extensions.some(candidate => normalizeTextEditorExtension(candidate) === wanted);
}
