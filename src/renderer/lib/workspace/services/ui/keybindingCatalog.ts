import type { TranslationKey } from "@shared/i18n";

/**
 * The declarative keybinding catalog — the full, static list of every customizable shortcut in
 * the workspace, independent of what is currently mounted.
 *
 * Why it exists: bindings *register* lazily (an editor's shortcuts appear when its tab mounts),
 * so a registry-driven settings table only ever showed a moment's snapshot. The catalog is the
 * display and customization source of truth: the settings table and the "?" cheat sheet render
 * it in full, and user overrides key on catalog ids — stable across per-tab registration ids
 * (see `Keybinding.catalogId`).
 *
 * Defaults also resolve through here: `KeybindingService.getEffectiveKey` prefers the catalog's
 * `key` over the inline registration key, so editing a default in this file is enough.
 *
 * Adding a binding: register it as before, give it a `catalogId` (or `catalogPrefix` on
 * `useKeybindings`), and add the entry here with an i18n label. A binding without an entry still
 * works — it just only shows up in the settings table while registered ("Other" group).
 */
export interface KeybindingCatalogEntry {
    /** Stable id: what overrides persist under and what registrations reference via catalogId. */
    id: string;
    /** Default chord (`mod` = ⌘ on macOS, Ctrl elsewhere). */
    key: string;
    labelKey: TranslationKey;
    categoryKey: TranslationKey;
}

const CATEGORY = {
    general: "workspace.shell.keybindings.categories.general" as TranslationKey,
    story: "workspace.shell.keybindings.categories.story" as TranslationKey,
    uiEditor: "workspace.shell.keybindings.categories.uiEditor" as TranslationKey,
    blueprint: "workspace.shell.keybindings.categories.blueprint" as TranslationKey,
    storyMotion: "workspace.shell.keybindings.categories.storyMotion" as TranslationKey,
    assets: "workspace.shell.keybindings.categories.assets" as TranslationKey,
} as const;

function entry(id: string, key: string, labelKey: string, categoryKey: TranslationKey): KeybindingCatalogEntry {
    return { id, key, labelKey: labelKey as TranslationKey, categoryKey };
}

export const KEYBINDING_CATALOG: readonly KeybindingCatalogEntry[] = [
    // --- Workspace-wide -----------------------------------------------------
    entry("workspace-command-palette", "mod+shift+p", "workspace.shell.keybindings.catalog.commandPalette", CATEGORY.general),
    entry("workspace-quick-search", "mod+p", "workspace.shell.keybindings.catalog.quickSearch", CATEGORY.general),
    entry("workspace-keybinding-cheatsheet", "shift+?", "workspace.shell.keybindings.catalog.cheatSheet", CATEGORY.general),
    entry("workspace-reopen-closed-tab", "mod+shift+t", "workspace.shell.keybindings.catalog.reopenClosedTab", CATEGORY.general),
    entry("workspace-editor-quick-switch-next", "ctrl+tab", "workspace.shell.keybindings.catalog.quickSwitchNext", CATEGORY.general),
    entry("workspace-editor-quick-switch-previous", "ctrl+shift+tab", "workspace.shell.keybindings.catalog.quickSwitchPrevious", CATEGORY.general),

    // --- Story scene editor (idle mode) ------------------------------------
    entry("story.edit-active", "enter", "story.keybindings.editRow", CATEGORY.story),
    entry("story.insert-blank-after-selection", "shift+enter", "story.keybindings.insertRow", CATEGORY.story),
    entry("story.delete", "delete", "story.keybindings.deleteRows", CATEGORY.story),
    entry("story.backspace", "backspace", "story.keybindings.deleteRowsConfirm", CATEGORY.story),
    entry("story.undo", "mod+z", "story.keybindings.undo", CATEGORY.story),
    entry("story.redo", "mod+shift+z", "story.keybindings.redo", CATEGORY.story),
    entry("story.indent", "tab", "story.keybindings.indent", CATEGORY.story),
    entry("story.outdent", "shift+tab", "story.keybindings.outdent", CATEGORY.story),
    entry("story.select-all", "mod+a", "story.keybindings.selectAll", CATEGORY.story),
    entry("story.duplicate", "mod+d", "story.keybindings.duplicateRows", CATEGORY.story),
    entry("story.move-selection-down", "arrowdown", "story.keybindings.moveSelectionDown", CATEGORY.story),
    entry("story.move-selection-up", "arrowup", "story.keybindings.moveSelectionUp", CATEGORY.story),
    entry("story.extend-selection-down", "shift+arrowdown", "story.keybindings.extendSelectionDown", CATEGORY.story),
    entry("story.extend-selection-up", "shift+arrowup", "story.keybindings.extendSelectionUp", CATEGORY.story),
    entry("story.move-row-down", "alt+arrowdown", "story.keybindings.moveRowDown", CATEGORY.story),
    entry("story.move-row-up", "alt+arrowup", "story.keybindings.moveRowUp", CATEGORY.story),
    entry("story.select-first", "home", "story.keybindings.selectFirst", CATEGORY.story),
    entry("story.select-last", "end", "story.keybindings.selectLast", CATEGORY.story),
    entry("story.select-first-mod", "mod+home", "story.keybindings.selectFirst", CATEGORY.story),
    entry("story.select-last-mod", "mod+end", "story.keybindings.selectLast", CATEGORY.story),

    // --- UI editor ----------------------------------------------------------
    entry("ui-editor.undo", "mod+z", "workspace.shell.keybindings.catalog.uiEditor.undo", CATEGORY.uiEditor),
    entry("ui-editor.redo", "mod+shift+z", "workspace.shell.keybindings.catalog.uiEditor.redo", CATEGORY.uiEditor),
    entry("ui-editor.copy", "mod+c", "workspace.shell.keybindings.catalog.uiEditor.copy", CATEGORY.uiEditor),
    entry("ui-editor.cut", "mod+x", "workspace.shell.keybindings.catalog.uiEditor.cut", CATEGORY.uiEditor),
    entry("ui-editor.paste", "mod+v", "workspace.shell.keybindings.catalog.uiEditor.paste", CATEGORY.uiEditor),
    entry("ui-editor.dup", "mod+d", "workspace.shell.keybindings.catalog.uiEditor.duplicate", CATEGORY.uiEditor),
    entry("ui-editor.group", "mod+g", "workspace.shell.keybindings.catalog.uiEditor.group", CATEGORY.uiEditor),
    entry("ui-editor.selall", "mod+a", "workspace.shell.keybindings.catalog.uiEditor.selectAll", CATEGORY.uiEditor),
    entry("ui-editor.delete", "delete", "workspace.shell.keybindings.catalog.uiEditor.delete", CATEGORY.uiEditor),
    entry("ui-editor.backspace", "backspace", "workspace.shell.keybindings.catalog.uiEditor.delete", CATEGORY.uiEditor),
    entry("ui-editor.f2", "f2", "workspace.shell.keybindings.catalog.uiEditor.rename", CATEGORY.uiEditor),
    entry("ui-editor.escape", "escape", "workspace.shell.keybindings.catalog.uiEditor.escape", CATEGORY.uiEditor),

    // --- Blueprint editor ----------------------------------------------------
    entry("blueprint.undo", "mod+z", "workspace.shell.keybindings.catalog.blueprint.undo", CATEGORY.blueprint),
    entry("blueprint.redo", "mod+shift+z", "workspace.shell.keybindings.catalog.blueprint.redo", CATEGORY.blueprint),
    entry("blueprint.copy", "mod+c", "workspace.shell.keybindings.catalog.blueprint.copy", CATEGORY.blueprint),
    entry("blueprint.cut", "mod+x", "workspace.shell.keybindings.catalog.blueprint.cut", CATEGORY.blueprint),
    entry("blueprint.paste", "mod+v", "workspace.shell.keybindings.catalog.blueprint.paste", CATEGORY.blueprint),

    // --- Story motion editor -------------------------------------------------
    entry("story-motion.undo", "mod+z", "workspace.shell.keybindings.catalog.storyMotion.undo", CATEGORY.storyMotion),
    entry("story-motion.redo", "mod+shift+z", "workspace.shell.keybindings.catalog.storyMotion.redo", CATEGORY.storyMotion),
    entry("story-motion.delete", "delete", "workspace.shell.keybindings.catalog.storyMotion.delete", CATEGORY.storyMotion),
    entry("story-motion.backspace", "backspace", "workspace.shell.keybindings.catalog.storyMotion.delete", CATEGORY.storyMotion),

    // --- Assets panel --------------------------------------------------------
    entry("assets.copy", "mod+c", "assets.shortcuts.copy", CATEGORY.assets),
    entry("assets.cut", "mod+x", "assets.shortcuts.cut", CATEGORY.assets),
    entry("assets.paste", "mod+v", "assets.shortcuts.paste", CATEGORY.assets),
    entry("assets.rename", "f2", "assets.shortcuts.rename", CATEGORY.assets),
];

const CATALOG_BY_ID = new Map(KEYBINDING_CATALOG.map(item => [item.id, item]));

export function getKeybindingCatalogEntry(id: string): KeybindingCatalogEntry | undefined {
    return CATALOG_BY_ID.get(id);
}
