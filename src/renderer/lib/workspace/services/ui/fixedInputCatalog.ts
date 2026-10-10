import type { TranslationKey } from "@shared/i18n";
import { formatKeybinding } from "./keybindingFormat";
import { getKeybindingCatalogEntry, KEYBINDING_CATEGORY } from "./keybindingCatalog";

/**
 * The inputs an author cannot rebind: mouse gestures, and the handful of keys that belong to a browser
 * event or a library rather than to the keybinding service (a paste that skips the wizard is the paste
 * event itself; React Flow owns the blueprint canvas's Delete).
 *
 * Why it exists: the keybinding catalog can only describe a chord, so every gesture whose meaning
 * depends on a modifier - Ctrl+drag pans the blueprint canvas, Alt+drag suspends snapping - was
 * written down nowhere an author could find it. The cheat sheet and the help topics read this list
 * beside the keybinding catalog, under the same per-editor groups, so an editor's keys and its
 * gestures read as one section.
 *
 * Display only. Nothing here registers or dispatches anything; the handlers stay where they are. That
 * makes it a second description of behaviour that lives elsewhere, which is what
 * `fixedInputCatalog.test.ts` answers: it pins every entry to the line of code that implements it,
 * so changing a gesture without changing its entry here fails the suite.
 */

/** One way to perform an entry. An entry with several is read "any of these". */
export type FixedInput =
    /** A chord, written the way a keybinding is (`mod+shift+v`), so it renders the same way. */
    | { key: string }
    /**
     * A pointer gesture: a phrase naming the gesture and what it lands on ("Double-click a wire"), and
     * the modifiers held with it. The phrase is a whole translated string rather than a verb and a
     * noun assembled here, because the languages order the two differently.
     */
    | { gesture: TranslationKey; modifiers?: string };

export interface FixedInputEntry {
    /** Stable id. `fixedInputCatalog.test.ts` keys its code anchors on it. */
    id: string;
    inputs: readonly FixedInput[];
    /**
     * The keybinding catalog entry this adds inputs to, when the gesture is another way to run a
     * command that already has a row (middle-click and Ctrl+W both close a tab). The row then shows
     * every way to run the command, and `labelKey`/`categoryKey` come from that entry.
     */
    extends?: string;
    labelKey?: TranslationKey;
    categoryKey?: TranslationKey;
    /**
     * A keybinding of the same surface, for a group that spans several (Assets is the panel, the audio
     * preview and the video preview). The cheat sheet lists a gesture among what works where focus is
     * when its group is in focus; with this set, only when that binding is live, so the panel's
     * gestures are not offered over a waveform.
     */
    liveWith?: string;
}

const CATEGORY = KEYBINDING_CATEGORY;
const LABEL = "workspace.shell.keybindings.fixed.";
const GESTURE = "workspace.shell.keybindings.gestures.";

function label(key: string): TranslationKey {
    return `${LABEL}${key}` as TranslationKey;
}

function gesture(key: string, modifiers?: string): FixedInput {
    return modifiers
        ? { gesture: `${GESTURE}${key}` as TranslationKey, modifiers }
        : { gesture: `${GESTURE}${key}` as TranslationKey };
}

function key(chord: string): FixedInput {
    return { key: chord };
}

function entry(id: string, category: TranslationKey, labelKey: TranslationKey, ...inputs: FixedInput[]): FixedInputEntry {
    return { id, inputs, labelKey, categoryKey: category };
}

/** A label the interface already uses for the same command, so the two places read alike. */
function existing(key: string): TranslationKey {
    return key as TranslationKey;
}

function extend(id: string, bindingId: string, ...inputs: FixedInput[]): FixedInputEntry {
    return { id, inputs, extends: bindingId };
}

/** The entry, counted as working where focus is only while `bindingId` is live; see `liveWith`. */
function on(bindingId: string, item: FixedInputEntry): FixedInputEntry {
    return { ...item, liveWith: bindingId };
}

/** The assets panel's F2 is registered whether or not its clipboard keys are. */
const ASSETS_PANEL = "assets.rename";
const AUDIO_PREVIEW = "assets.audio.play-pause";
const VIDEO_PREVIEW = "assets.video.play-pause";

/*
 * Modifiers follow the handler they describe: `mod` where the code reads `ctrlKey || metaKey`, and a
 * literal `ctrl` where it reads `ctrlKey` alone - those are the trackpad-pinch paths, which macOS also
 * reports as Control.
 */
export const FIXED_INPUT_CATALOG: readonly FixedInputEntry[] = [
    // --- Workspace ----------------------------------------------------------
    extend("workspace.tab.middle-click-close", "editor.close-tab", gesture("middleClickTab")),
    entry("workspace.tab.keep-open", CATEGORY.general, label("general.keepTabOpen"), gesture("doubleClickTab")),
    entry(
        "workspace.tab.multi-select",
        CATEGORY.general,
        label("general.selectTabs"),
        gesture("clickTab", "mod"),
        gesture("clickTab", "shift"),
    ),
    entry("workspace.split.reset", CATEGORY.general, label("general.resetSplit"), gesture("doubleClickDivider")),

    // --- Story editor --------------------------------------------------------
    extend("story.row.double-click-edit", "story.edit-active", gesture("doubleClickRow")),
    entry("story.row.toggle-select", CATEGORY.story, label("toggleSelection"), gesture("clickRow", "mod")),
    entry(
        "story.row.range-select",
        CATEGORY.story,
        label("story.selectRowRange"),
        gesture("clickRow", "shift"),
        gesture("dragAcrossRows"),
    ),
    entry("story.row.drag-move", CATEGORY.story, label("story.moveRows"), gesture("dragRowHandle")),
    entry("story.row.follow-reference", CATEGORY.story, label("story.followReference"), gesture("clickName", "mod")),
    entry("story.edit.enter", CATEGORY.story, label("story.continueRow"), key("enter")),
    entry("story.edit.shift-enter", CATEGORY.story, label("story.blankRow"), key("shift+enter")),
    entry("story.edit.escape", CATEGORY.story, label("story.finishEditing"), key("escape")),
    entry("story.paste-plain", CATEGORY.story, label("story.pastePlain"), key("mod+shift+v")),
    entry("story.easing.snap", CATEGORY.story, label("easingSnap"), gesture("dragHandle", "shift")),
    entry("story.easing.nudge", CATEGORY.story, label("easingNudge"), gesture("arrowKeys")),

    // --- UI editor -----------------------------------------------------------
    entry(
        "ui-editor.pan",
        CATEGORY.uiEditor,
        label("panCanvas"),
        gesture("middleDrag"),
        gesture("scroll"),
        gesture("scroll", "shift"),
    ),
    entry("ui-editor.zoom", CATEGORY.uiEditor, label("zoomAtPointer"), gesture("scroll", "ctrl")),
    entry("ui-editor.toggle-select", CATEGORY.uiEditor, label("toggleSelection"), gesture("clickElement", "mod")),
    entry("ui-editor.add-select", CATEGORY.uiEditor, label("addToSelection"), gesture("clickElement", "shift")),
    entry("ui-editor.select-inside", CATEGORY.uiEditor, label("uiEditor.selectInside"), gesture("doubleClickContainer")),
    entry("ui-editor.edit-text", CATEGORY.uiEditor, label("uiEditor.editText"), gesture("doubleClickText")),
    entry("ui-editor.discard-text", CATEGORY.uiEditor, label("uiEditor.discardText"), key("escape")),
    entry("ui-editor.crop", CATEGORY.uiEditor, label("uiEditor.crop"), gesture("doubleClickImage")),
    entry("ui-editor.suspend-snap", CATEGORY.uiEditor, label("uiEditor.suspendSnap"), gesture("drag", "alt")),
    entry("ui-editor.drop-image", CATEGORY.uiEditor, label("uiEditor.dropImage"), gesture("dragImageAsset")),
    extend("ui-editor.outline.rename", "ui-editor.f2", gesture("doubleClickOutlineItem")),
    entry("ui-editor.outline.reorder", CATEGORY.uiEditor, label("uiEditor.reorder"), gesture("dragOutlineItem")),

    // --- Blueprint editor ------------------------------------------------------
    entry(
        "blueprint.pan",
        CATEGORY.blueprint,
        label("panCanvas"),
        gesture("middleDrag"),
        gesture("drag", "ctrl"),
        gesture("scroll"),
    ),
    entry("blueprint.zoom", CATEGORY.blueprint, label("zoomAtPointer"), gesture("scroll", "ctrl")),
    entry("blueprint.add-select", CATEGORY.blueprint, label("addToSelection"), gesture("clickNode", "shift")),
    entry("blueprint.add-node", CATEGORY.blueprint, label("blueprint.addNode"), gesture("rightClickCanvas")),
    entry("blueprint.add-connected-node", CATEGORY.blueprint, label("blueprint.addConnectedNode"), gesture("dragPinToCanvas")),
    entry("blueprint.delete-wire", CATEGORY.blueprint, label("blueprint.deleteWire"), gesture("doubleClickWire")),
    entry("blueprint.delete", CATEGORY.blueprint, label("blueprint.deleteSelection"), key("delete"), key("backspace")),
    entry("blueprint.rename-group", CATEGORY.blueprint, label("blueprint.renameGroup"), gesture("doubleClickGroupTitle")),
    entry("blueprint.detach", CATEGORY.blueprint, existing("blueprint.header.detach"), gesture("middleClickTitle")),

    // --- Story motion editor ---------------------------------------------------
    entry("story-motion.no-snap", CATEGORY.storyMotion, label("storyMotion.noFrameSnap"), gesture("drag", "alt")),
    entry("story-motion.add-keyframe", CATEGORY.storyMotion, label("storyMotion.addKeyframe"), gesture("doubleClickTrack")),
    entry("story-motion.move-keyframes", CATEGORY.storyMotion, label("storyMotion.moveKeyframes"), gesture("dragKeyframe")),
    entry(
        "story-motion.toggle-select",
        CATEGORY.storyMotion,
        label("toggleSelection"),
        gesture("clickKeyframe", "shift"),
        gesture("clickKeyframe", "mod"),
    ),
    entry("story-motion.box-select", CATEGORY.storyMotion, label("storyMotion.boxSelect"), gesture("dragAcrossTracks")),
    entry("story-motion.library.open", CATEGORY.storyMotion, label("storyMotion.openMotion"), key("enter"), gesture("doubleClick")),
    entry("story-motion.library.toggle-select", CATEGORY.storyMotion, label("toggleSelection"), gesture("clickMotion", "mod")),
    entry("story-motion.library.range-select", CATEGORY.storyMotion, label("storyMotion.selectMotionRange"), gesture("clickMotion", "shift")),
    entry("story-motion.library.select-all", CATEGORY.storyMotion, label("storyMotion.selectAllMotions"), key("mod+a")),
    entry("story-motion.select-track", CATEGORY.storyMotion, label("storyMotion.selectTrack"), gesture("clickName")),
    entry("story-motion.pan-preview", CATEGORY.storyMotion, label("storyMotion.panPreview"), gesture("middleDrag")),
    entry("story-motion.zoom", CATEGORY.storyMotion, label("storyMotion.zoom"), gesture("scroll", "ctrl")),
    entry("story-motion.scroll-timeline", CATEGORY.storyMotion, label("storyMotion.scrollTimeline"), gesture("scroll", "shift")),
    entry("story-motion.easing.snap", CATEGORY.storyMotion, label("easingSnap"), gesture("dragHandle", "shift")),
    entry(
        "story-motion.easing.nudge",
        CATEGORY.storyMotion,
        label("easingNudge"),
        gesture("arrowKeys"),
    ),

    // --- Assets ----------------------------------------------------------------
    on(ASSETS_PANEL, entry("assets.toggle-select", CATEGORY.assets, label("toggleSelection"), gesture("clickAsset", "mod"))),
    on(ASSETS_PANEL, entry("assets.range-select", CATEGORY.assets, label("assets.selectAssetRange"), gesture("clickAsset", "shift"))),
    on(ASSETS_PANEL, entry(
        "assets.open",
        CATEGORY.assets,
        label("assets.open"),
        key("enter"),
        gesture("doubleClick"),
        gesture("dragToEditorArea"),
    )),
    on(ASSETS_PANEL, entry("assets.up", CATEGORY.assets, existing("assets.backToParent"), key("backspace"), key("alt+arrowup"))),
    on(ASSETS_PANEL, entry("assets.move-to-group", CATEGORY.assets, label("assets.moveToGroup"), gesture("dragOntoGroup"))),
    on(ASSETS_PANEL, entry("assets.tile-size", CATEGORY.assets, label("assets.tileSize"), gesture("scroll", "ctrl"))),
    on(AUDIO_PREVIEW, entry("assets.audio.scroll", CATEGORY.assets, label("assets.audioScroll"), gesture("scroll"))),
    on(AUDIO_PREVIEW, entry("assets.audio.zoom-time", CATEGORY.assets, label("assets.audioZoomTime"), gesture("scroll", "mod"))),
    on(AUDIO_PREVIEW, entry("assets.audio.zoom-amplitude", CATEGORY.assets, label("assets.audioZoomAmplitude"), gesture("scroll", "alt"))),
    on(AUDIO_PREVIEW, entry("assets.audio.select-range", CATEGORY.assets, label("assets.selectAudioRange"), gesture("dragWaveform"))),
    extend("assets.audio.select-all", "assets.audio.select-all", gesture("doubleClickWaveform")),
    on(AUDIO_PREVIEW, entry("assets.audio.clear-point", CATEGORY.assets, label("assets.clearMarker"), gesture("doubleClickMarker"))),
    on(VIDEO_PREVIEW, entry("assets.video.zoom", CATEGORY.assets, label("assets.videoZoom"), gesture("scroll", "mod"))),
    on(VIDEO_PREVIEW, entry("assets.video.actual-size", CATEGORY.assets, label("assets.videoActualSize"), gesture("doubleClickPicture"))),
    extend("assets.video.select-all", "assets.video.select-all", gesture("doubleClickTimeline")),
];

const CATALOG_BY_ID = new Map(FIXED_INPUT_CATALOG.map(item => [item.id, item]));

export function getFixedInputEntry(id: string): FixedInputEntry | undefined {
    return CATALOG_BY_ID.get(id);
}

/** The label and group an entry is shown under: its own, or those of the binding it extends. */
export function resolveFixedInputDisplay(item: FixedInputEntry): { labelKey: TranslationKey; categoryKey: TranslationKey } | null {
    if (item.extends) {
        const binding = getKeybindingCatalogEntry(item.extends);
        return binding ? { labelKey: binding.labelKey, categoryKey: binding.categoryKey } : null;
    }
    return item.labelKey && item.categoryKey ? { labelKey: item.labelKey, categoryKey: item.categoryKey } : null;
}

/** Entries that add inputs to an existing keybinding row, by that binding's id. */
export function getFixedInputsExtending(bindingId: string): FixedInput[] {
    return FIXED_INPUT_CATALOG.filter(item => item.extends === bindingId).flatMap(item => item.inputs);
}

/**
 * Render one input for a chip: a chord the way every shortcut is drawn, a gesture as its phrase with
 * the held modifiers in front ("Ctrl+Click a row", "Alt+Drag").
 */
export function formatFixedInput(
    input: FixedInput,
    isMac: boolean,
    t: (key: TranslationKey, params?: Record<string, string>) => string,
): string {
    if ("key" in input) {
        return formatKeybinding(input.key, isMac);
    }
    const phrase = t(input.gesture);
    if (!input.modifiers) {
        return phrase;
    }
    return t("workspace.shell.keybindings.gestures.withModifiers" as TranslationKey, {
        keys: formatKeybinding(input.modifiers, isMac),
        gesture: phrase,
    });
}
