import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowLeftToLine,
  ArrowRight,
  ArrowRightToLine,
  ArrowUp,
  ArrowUpToLine,
  ChevronDown,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUp,
  CircleQuestionMark,
  ClipboardPaste,
  Columns2,
  Command,
  Copy,
  CopyPlus,
  Eraser,
  Flag,
  Group,
  History,
  IndentDecrease,
  IndentIncrease,
  Keyboard,
  Locate,
  Maximize2,
  MoveDown,
  MoveUp,
  PanelRightClose,
  PenLine,
  Pencil,
  Play,
  Plus,
  Redo2,
  Repeat,
  Rows2,
  Scissors,
  Search,
  SkipBack,
  SkipForward,
  SquareDashed,
  SquareDashedMousePointer,
  SquareX,
  Trash2,
  Undo2,
  Ungroup,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon
} from "lucide-react";
import type { TranslationKey } from "@shared/i18n";

/**
 * The declarative keybinding catalog - the full, static list of every customizable shortcut in
 * the workspace, independent of what is currently mounted.
 *
 * Why it exists: bindings *register* lazily (an editor's shortcuts appear when its tab mounts),
 * so a registry-driven settings table only ever showed a moment's snapshot. The catalog is the
 * display and customization source of truth: the settings table and the "?" cheat sheet render
 * it in full, and user overrides key on catalog ids - stable across per-tab registration ids
 * (see `Keybinding.catalogId`).
 *
 * Defaults also resolve through here: `KeybindingService.getEffectiveKey` prefers the catalog's
 * `key` over the inline registration key, so editing a default in this file is enough.
 *
 * Adding a binding: register it as before, give it a `catalogId` (or `catalogPrefix` on
 * `useKeybindings`), and add the entry here with an i18n label. A binding without an entry still
 * works - it just only shows up in the settings table while registered ("Other" group).
 */
export interface KeybindingCatalogEntry {
  /** Stable id: what overrides persist under and what registrations reference via catalogId. */
  id: string;
  /** Default chord (`mod` = ⌘ on macOS, Ctrl elsewhere). */
  key: string;
  labelKey: TranslationKey;
  categoryKey: TranslationKey;
  /**
   * Glyph for the command palette's icon column.
   *
   * Required, not optional: a shortcut reaches the palette through this catalog and nowhere else,
   * so an omitted icon is a blank row that nothing would flag. Making it a parameter of
   * {@link entry} means the compiler asks for one when a binding is added, which is the only
   * check that runs before the gap ships.
   *
   * Repeats are intended - the column says what *kind* of thing a row is, so every undo across
   * five editors wears the same glyph, exactly as the same verb wears the same word.
   */
  icon: LucideIcon;
}

const CATEGORY = {
  general: "workspace.shell.keybindings.categories.general" as TranslationKey,
  story: "workspace.shell.keybindings.categories.story" as TranslationKey,
  uiEditor: "workspace.shell.keybindings.categories.uiEditor" as TranslationKey,
  blueprint: "workspace.shell.keybindings.categories.blueprint" as TranslationKey,
  storyMotion: "workspace.shell.keybindings.categories.storyMotion" as TranslationKey,
  assets: "workspace.shell.keybindings.categories.assets" as TranslationKey
} as const;

function entry(
  id: string,
  key: string,
  labelKey: string,
  categoryKey: TranslationKey,
  icon: LucideIcon
): KeybindingCatalogEntry {
  return { id, key, labelKey: labelKey as TranslationKey, categoryKey, icon };
}

export const KEYBINDING_CATALOG: readonly KeybindingCatalogEntry[] = [
  // --- Workspace-wide -----------------------------------------------------
  entry(
    "workspace-command-palette",
    "mod+shift+p",
    "workspace.shell.keybindings.catalog.commandPalette",
    CATEGORY.general,
    Command
  ),
  entry(
    "workspace-quick-open",
    "mod+p",
    "workspace.shell.keybindings.catalog.quickOpen",
    CATEGORY.general,
    Search
  ),
  entry(
    "workspace-keybinding-cheatsheet",
    "shift+?",
    "workspace.shell.keybindings.catalog.cheatSheet",
    CATEGORY.general,
    Keyboard
  ),
  // F1 is the conventional contextual-help key on Windows and Linux, and unused on macOS outside
  // the Help menu. It is `allowInEditable` where it registers: "what is this field" is a question
  // an author asks with the caret in the field.
  entry(
    "workspace-context-help",
    "f1",
    "workspace.shell.keybindings.catalog.contextHelp",
    CATEGORY.general,
    CircleQuestionMark
  ),
  entry(
    "workspace-reopen-closed-tab",
    "mod+shift+t",
    "workspace.shell.keybindings.catalog.reopenClosedTab",
    CATEGORY.general,
    History
  ),
  // Only fires outside an editor; inside one, that editor's own undo wins. See
  // `WorkspaceUndoKeybindings`.
  entry(
    "workspace.undo",
    "mod+z",
    "workspace.shell.keybindings.catalog.undo",
    CATEGORY.general,
    Undo2
  ),
  entry(
    "workspace.redo",
    "mod+shift+z",
    "workspace.shell.keybindings.catalog.redo",
    CATEGORY.general,
    Redo2
  ),
  entry(
    "workspace-editor-quick-switch-next",
    "ctrl+tab",
    "workspace.shell.keybindings.catalog.quickSwitchNext",
    CATEGORY.general,
    ArrowRight
  ),
  entry(
    "workspace-editor-quick-switch-previous",
    "ctrl+shift+tab",
    "workspace.shell.keybindings.catalog.quickSwitchPrevious",
    CATEGORY.general,
    ArrowLeft
  ),
  entry(
    "editor-split-right",
    "mod+\\",
    "workspace.shell.commandPalette.editor.splitRight",
    CATEGORY.general,
    Columns2
  ),
  entry(
    "editor-split-down",
    "mod+alt+\\",
    "workspace.shell.commandPalette.editor.splitDown",
    CATEGORY.general,
    Rows2
  ),
  // Registered per editor group (`editor-group-<id>-…`), hence the catalogIds — without them the
  // palette showed one untranslated row per group under its catch-all section.
  entry(
    "editor.close-active-tab",
    "mod+w",
    "workspace.shell.commandPalette.editor.closeTab",
    CATEGORY.general,
    X
  ),
  entry(
    "editor.close-selected-tabs",
    "mod+w",
    "workspace.shell.commandPalette.editor.closeSelectedTabs",
    CATEGORY.general,
    SquareX
  ),

  // --- Story scene editor (idle mode) ------------------------------------
  entry("story.find", "mod+f", "story.keybindings.find", CATEGORY.story, Search),
  entry(
    "story.close-inspector",
    "escape",
    "story.keybindings.closeInspector",
    CATEGORY.story,
    PanelRightClose
  ),
  entry("story.page-down", "pagedown", "story.keybindings.pageDown", CATEGORY.story, ChevronsDown),
  entry("story.page-up", "pageup", "story.keybindings.pageUp", CATEGORY.story, ChevronsUp),
  entry("story.edit-active", "enter", "story.keybindings.editRow", CATEGORY.story, Pencil),
  entry(
    "story.insert-blank-after-selection",
    "shift+enter",
    "story.keybindings.insertRow",
    CATEGORY.story,
    Plus
  ),
  entry("story.delete", "delete", "story.keybindings.deleteRows", CATEGORY.story, Trash2),
  entry(
    "story.backspace",
    "backspace",
    "story.keybindings.deleteRowsConfirm",
    CATEGORY.story,
    Trash2
  ),
  entry("story.undo", "mod+z", "story.keybindings.undo", CATEGORY.story, Undo2),
  entry("story.redo", "mod+shift+z", "story.keybindings.redo", CATEGORY.story, Redo2),
  entry("story.indent", "tab", "story.keybindings.indent", CATEGORY.story, IndentIncrease),
  entry("story.outdent", "shift+tab", "story.keybindings.outdent", CATEGORY.story, IndentDecrease),
  entry(
    "story.select-all",
    "mod+a",
    "story.keybindings.selectAll",
    CATEGORY.story,
    SquareDashedMousePointer
  ),
  entry("story.duplicate", "mod+d", "story.keybindings.duplicateRows", CATEGORY.story, CopyPlus),
  // Moving the *selection* is a cursor move (plain arrow); moving the *row* carries content with
  // it (the heavier `Move` glyph); extending stretches one end of the selection (chevron).
  entry(
    "story.move-selection-down",
    "arrowdown",
    "story.keybindings.moveSelectionDown",
    CATEGORY.story,
    ArrowDown
  ),
  entry(
    "story.move-selection-up",
    "arrowup",
    "story.keybindings.moveSelectionUp",
    CATEGORY.story,
    ArrowUp
  ),
  entry(
    "story.extend-selection-down",
    "shift+arrowdown",
    "story.keybindings.extendSelectionDown",
    CATEGORY.story,
    ChevronDown
  ),
  entry(
    "story.extend-selection-up",
    "shift+arrowup",
    "story.keybindings.extendSelectionUp",
    CATEGORY.story,
    ChevronUp
  ),
  entry(
    "story.move-row-down",
    "alt+arrowdown",
    "story.keybindings.moveRowDown",
    CATEGORY.story,
    MoveDown
  ),
  entry("story.move-row-up", "alt+arrowup", "story.keybindings.moveRowUp", CATEGORY.story, MoveUp),
  entry(
    "story.select-first",
    "home",
    "story.keybindings.selectFirst",
    CATEGORY.story,
    ArrowUpToLine
  ),
  entry(
    "story.select-last",
    "end",
    "story.keybindings.selectLast",
    CATEGORY.story,
    ArrowDownToLine
  ),
  entry(
    "story.select-first-mod",
    "mod+home",
    "story.keybindings.selectFirst",
    CATEGORY.story,
    ArrowUpToLine
  ),
  entry(
    "story.select-last-mod",
    "mod+end",
    "story.keybindings.selectLast",
    CATEGORY.story,
    ArrowDownToLine
  ),

  // --- UI editor ----------------------------------------------------------
  entry(
    "ui-editor.undo",
    "mod+z",
    "workspace.shell.keybindings.catalog.uiEditor.undo",
    CATEGORY.uiEditor,
    Undo2
  ),
  entry(
    "ui-editor.redo",
    "mod+shift+z",
    "workspace.shell.keybindings.catalog.uiEditor.redo",
    CATEGORY.uiEditor,
    Redo2
  ),
  entry(
    "ui-editor.copy",
    "mod+c",
    "workspace.shell.keybindings.catalog.uiEditor.copy",
    CATEGORY.uiEditor,
    Copy
  ),
  entry(
    "ui-editor.cut",
    "mod+x",
    "workspace.shell.keybindings.catalog.uiEditor.cut",
    CATEGORY.uiEditor,
    Scissors
  ),
  entry(
    "ui-editor.paste",
    "mod+v",
    "workspace.shell.keybindings.catalog.uiEditor.paste",
    CATEGORY.uiEditor,
    ClipboardPaste
  ),
  entry(
    "ui-editor.dup",
    "mod+d",
    "workspace.shell.keybindings.catalog.uiEditor.duplicate",
    CATEGORY.uiEditor,
    CopyPlus
  ),
  entry(
    "ui-editor.group",
    "mod+g",
    "workspace.shell.keybindings.catalog.uiEditor.group",
    CATEGORY.uiEditor,
    Group
  ),
  entry(
    "ui-editor.ungroup",
    "mod+shift+g",
    "workspace.shell.keybindings.catalog.uiEditor.ungroup",
    CATEGORY.uiEditor,
    Ungroup
  ),
  entry(
    "ui-editor.selall",
    "mod+a",
    "workspace.shell.keybindings.catalog.uiEditor.selectAll",
    CATEGORY.uiEditor,
    SquareDashedMousePointer
  ),
  entry(
    "ui-editor.delete",
    "delete",
    "workspace.shell.keybindings.catalog.uiEditor.delete",
    CATEGORY.uiEditor,
    Trash2
  ),
  entry(
    "ui-editor.backspace",
    "backspace",
    "workspace.shell.keybindings.catalog.uiEditor.delete",
    CATEGORY.uiEditor,
    Trash2
  ),
  entry(
    "ui-editor.f2",
    "f2",
    "workspace.shell.keybindings.catalog.uiEditor.rename",
    CATEGORY.uiEditor,
    PenLine
  ),
  entry(
    "ui-editor.escape",
    "escape",
    "workspace.shell.keybindings.catalog.uiEditor.escape",
    CATEGORY.uiEditor,
    X
  ),
  // Alignment follows Figma's Alt row, with WASD standing in for the four edges so the two
  // centring chords keep their mnemonic letters (H and V). The glyphs are the same eight the
  // canvas toolbar uses (`SurfaceAlignMenu`), so the palette row and the button match.
  entry(
    "ui-editor.align-left",
    "alt+a",
    "workspace.shell.keybindings.catalog.uiEditor.alignLeft",
    CATEGORY.uiEditor,
    AlignStartVertical
  ),
  entry(
    "ui-editor.align-horizontal-center",
    "alt+h",
    "workspace.shell.keybindings.catalog.uiEditor.alignHorizontalCenter",
    CATEGORY.uiEditor,
    AlignCenterVertical
  ),
  entry(
    "ui-editor.align-right",
    "alt+d",
    "workspace.shell.keybindings.catalog.uiEditor.alignRight",
    CATEGORY.uiEditor,
    AlignEndVertical
  ),
  entry(
    "ui-editor.align-top",
    "alt+w",
    "workspace.shell.keybindings.catalog.uiEditor.alignTop",
    CATEGORY.uiEditor,
    AlignStartHorizontal
  ),
  entry(
    "ui-editor.align-vertical-center",
    "alt+v",
    "workspace.shell.keybindings.catalog.uiEditor.alignVerticalCenter",
    CATEGORY.uiEditor,
    AlignCenterHorizontal
  ),
  entry(
    "ui-editor.align-bottom",
    "alt+s",
    "workspace.shell.keybindings.catalog.uiEditor.alignBottom",
    CATEGORY.uiEditor,
    AlignEndHorizontal
  ),
  entry(
    "ui-editor.distribute-horizontal",
    "alt+shift+h",
    "workspace.shell.keybindings.catalog.uiEditor.distributeHorizontal",
    CATEGORY.uiEditor,
    AlignHorizontalDistributeCenter
  ),
  entry(
    "ui-editor.distribute-vertical",
    "alt+shift+v",
    "workspace.shell.keybindings.catalog.uiEditor.distributeVertical",
    CATEGORY.uiEditor,
    AlignVerticalDistributeCenter
  ),

  // --- Blueprint editor ----------------------------------------------------
  entry(
    "blueprint.undo",
    "mod+z",
    "workspace.shell.keybindings.catalog.blueprint.undo",
    CATEGORY.blueprint,
    Undo2
  ),
  entry(
    "blueprint.redo",
    "mod+shift+z",
    "workspace.shell.keybindings.catalog.blueprint.redo",
    CATEGORY.blueprint,
    Redo2
  ),
  entry(
    "blueprint.copy",
    "mod+c",
    "workspace.shell.keybindings.catalog.blueprint.copy",
    CATEGORY.blueprint,
    Copy
  ),
  entry(
    "blueprint.cut",
    "mod+x",
    "workspace.shell.keybindings.catalog.blueprint.cut",
    CATEGORY.blueprint,
    Scissors
  ),
  entry(
    "blueprint.paste",
    "mod+v",
    "workspace.shell.keybindings.catalog.blueprint.paste",
    CATEGORY.blueprint,
    ClipboardPaste
  ),

  // --- Story motion editor -------------------------------------------------
  entry(
    "story-motion.undo",
    "mod+z",
    "workspace.shell.keybindings.catalog.storyMotion.undo",
    CATEGORY.storyMotion,
    Undo2
  ),
  entry(
    "story-motion.redo",
    "mod+shift+z",
    "workspace.shell.keybindings.catalog.storyMotion.redo",
    CATEGORY.storyMotion,
    Redo2
  ),
  entry(
    "story-motion.delete",
    "delete",
    "workspace.shell.keybindings.catalog.storyMotion.delete",
    CATEGORY.storyMotion,
    Trash2
  ),
  entry(
    "story-motion.backspace",
    "backspace",
    "workspace.shell.keybindings.catalog.storyMotion.delete",
    CATEGORY.storyMotion,
    Trash2
  ),
  // These six registered without catalog entries, so they were unrebindable and invisible in the
  // settings table and cheat sheet - found by `keybindingCatalog.test.ts`, not by hand.
  entry(
    "story-motion.prev-frame",
    "arrowleft",
    "workspace.shell.keybindings.catalog.storyMotion.prevFrame",
    CATEGORY.storyMotion,
    ChevronLeft
  ),
  entry(
    "story-motion.next-frame",
    "arrowright",
    "workspace.shell.keybindings.catalog.storyMotion.nextFrame",
    CATEGORY.storyMotion,
    ChevronRight
  ),
  entry(
    "story-motion.prev-frames",
    "shift+arrowleft",
    "workspace.shell.keybindings.catalog.storyMotion.prevFrames",
    CATEGORY.storyMotion,
    ChevronsLeft
  ),
  entry(
    "story-motion.next-frames",
    "shift+arrowright",
    "workspace.shell.keybindings.catalog.storyMotion.nextFrames",
    CATEGORY.storyMotion,
    ChevronsRight
  ),
  entry(
    "story-motion.playhead-start",
    "home",
    "workspace.shell.keybindings.catalog.storyMotion.playheadStart",
    CATEGORY.storyMotion,
    SkipBack
  ),
  entry(
    "story-motion.playhead-end",
    "end",
    "workspace.shell.keybindings.catalog.storyMotion.playheadEnd",
    CATEGORY.storyMotion,
    SkipForward
  ),

  // --- Assets panel --------------------------------------------------------
  entry("assets.copy", "mod+c", "assets.shortcuts.copy", CATEGORY.assets, Copy),
  entry("assets.cut", "mod+x", "assets.shortcuts.cut", CATEGORY.assets, Scissors),
  entry("assets.paste", "mod+v", "assets.shortcuts.paste", CATEGORY.assets, ClipboardPaste),
  entry("assets.rename", "f2", "assets.shortcuts.rename", CATEGORY.assets, PenLine),

  // --- Audio preview -------------------------------------------------------
  entry(
    "assets.audio.play-pause",
    "space",
    "assets.audio.keybindings.playPause",
    CATEGORY.assets,
    Play
  ),
  entry(
    "assets.audio.to-start",
    "home",
    "assets.audio.keybindings.toStart",
    CATEGORY.assets,
    SkipBack
  ),
  entry(
    "assets.audio.to-end",
    "end",
    "assets.audio.keybindings.toEnd",
    CATEGORY.assets,
    SkipForward
  ),
  entry(
    "assets.audio.nudge-back",
    "arrowleft",
    "assets.audio.keybindings.nudgeBack",
    CATEGORY.assets,
    ChevronLeft
  ),
  entry(
    "assets.audio.nudge-forward",
    "arrowright",
    "assets.audio.keybindings.nudgeForward",
    CATEGORY.assets,
    ChevronRight
  ),
  entry(
    "assets.audio.nudge-back-coarse",
    "shift+arrowleft",
    "assets.audio.keybindings.nudgeBackCoarse",
    CATEGORY.assets,
    ChevronsLeft
  ),
  entry(
    "assets.audio.nudge-forward-coarse",
    "shift+arrowright",
    "assets.audio.keybindings.nudgeForwardCoarse",
    CATEGORY.assets,
    ChevronsRight
  ),
  // The transport's repeat toggle sits on `r` so the three markers can own I, L and O - one
  // letter each, bare to set, shift to jump, mod+shift to clear. The glyphs follow that same
  // three-verb shape: set / jump to / clear, so a marker row is read by its verb first.
  entry("assets.audio.loop", "r", "assets.audio.keybindings.loop", CATEGORY.assets, Repeat),
  entry(
    "assets.audio.mark-in",
    "i",
    "assets.audio.keybindings.markIn",
    CATEGORY.assets,
    ArrowRightToLine
  ),
  entry("assets.audio.mark-loop", "l", "assets.audio.keybindings.markLoop", CATEGORY.assets, Flag),
  entry(
    "assets.audio.mark-out",
    "o",
    "assets.audio.keybindings.markOut",
    CATEGORY.assets,
    ArrowLeftToLine
  ),
  entry(
    "assets.audio.go-to-in",
    "shift+i",
    "assets.audio.keybindings.goToIn",
    CATEGORY.assets,
    ChevronFirst
  ),
  entry(
    "assets.audio.go-to-loop",
    "shift+l",
    "assets.audio.keybindings.goToLoop",
    CATEGORY.assets,
    Locate
  ),
  entry(
    "assets.audio.go-to-out",
    "shift+o",
    "assets.audio.keybindings.goToOut",
    CATEGORY.assets,
    ChevronLast
  ),
  entry(
    "assets.audio.clear-in",
    "mod+shift+i",
    "assets.audio.keybindings.clearIn",
    CATEGORY.assets,
    Eraser
  ),
  entry(
    "assets.audio.clear-loop",
    "mod+shift+l",
    "assets.audio.keybindings.clearLoop",
    CATEGORY.assets,
    Eraser
  ),
  entry(
    "assets.audio.clear-out",
    "mod+shift+o",
    "assets.audio.keybindings.clearOut",
    CATEGORY.assets,
    Eraser
  ),
  entry("assets.audio.undo", "mod+z", "assets.audio.keybindings.undo", CATEGORY.assets, Undo2),
  entry(
    "assets.audio.redo",
    "mod+shift+z",
    "assets.audio.keybindings.redo",
    CATEGORY.assets,
    Redo2
  ),
  entry(
    "assets.audio.select-all",
    "mod+a",
    "assets.audio.keybindings.selectAll",
    CATEGORY.assets,
    SquareDashedMousePointer
  ),
  entry(
    "assets.audio.clear-selection",
    "escape",
    "assets.audio.keybindings.clearSelection",
    CATEGORY.assets,
    SquareDashed
  ),
  entry("assets.audio.zoom-in", "=", "assets.audio.keybindings.zoomIn", CATEGORY.assets, ZoomIn),
  entry("assets.audio.zoom-out", "-", "assets.audio.keybindings.zoomOut", CATEGORY.assets, ZoomOut),
  entry(
    "assets.audio.zoom-fit",
    "0",
    "assets.audio.keybindings.zoomFit",
    CATEGORY.assets,
    Maximize2
  )
];

const CATALOG_BY_ID = new Map(KEYBINDING_CATALOG.map((item) => [item.id, item]));

export function getKeybindingCatalogEntry(id: string): KeybindingCatalogEntry | undefined {
  return CATALOG_BY_ID.get(id);
}
