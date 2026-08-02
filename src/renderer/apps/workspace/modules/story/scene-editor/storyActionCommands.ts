import { Puzzle, Settings2 } from "lucide-react";
import type { StoryBlock } from "@shared/types/story";
import { translate } from "@/lib/i18n";
import type { StoryCommandGroupId } from "./storyCommandCategories";

/**
 * Block construction, and nothing else.
 *
 * This file used to also carry `ACTION_COMMANDS` - a 57-entry sidebar catalogue organised as an
 * "object type × verb" matrix, which put `show`/`hide` behind ten separate entries while the slash
 * layer had exactly two. Two menus were teaching two mutually exclusive mental models. A1 deleted it:
 * the sidebar is now a second rendering of the spec registry (see `commands/specSidebar.ts`), so the
 * catalogue is singular by construction and `createBlockForCommand` is an implementation detail the
 * specs' `build` functions call - no longer a menu entry point.
 */

export type ActionCommandId =
    | "narration"
    | "dialogue"
    | "choice"
    | "choiceOption"
    | "condition"
    | "conditionBranch"
    | "repeat"
    | "parallel"
    | "race"
    | "sequence"
    | "background"
    | "characterEnter"
    | "characterMove"
    | "characterExit"
    | "characterExpression"
    | "bgm"
    | "sound"
    | "stopSound"
    | "pauseSound"
    | "resumeSound"
    | "soundVolume"
    | "soundRate"
    | "muteSound"
    | "seekSound"
    | "setVariable"
    | "incrementVariable"
    | "decrementVariable"
    | "toggleVariable"
    | "resetVariable"
    // Declaration-only: these build no block. See `STORY_DECLARATION_COMMANDS`.
    | "declareSceneVariable"
    | "declareSavedVariable"
    | "declarePersistentVariable"
    | "executeScript"
    | "imageCreate"
    | "imageSetSource"
    | "imageShow"
    | "imageHide"
    | "displayableTransform"
    | "displayableShow"
    | "displayableHide"
    | "displayableEffect"
    | "textCreate"
    | "textSet"
    | "textShow"
    | "textHide"
    | "textFont"
    | "layerCreate"
    | "layerZIndex"
    | "videoCreate"
    | "videoShow"
    | "videoHide"
    | "videoPlay"
    | "nvl"
    | "screenBlink"
    | "screenVignette"
    | "jump"
    | "waitDuration"
    | "waitClick"
    | "note";

/**
 * One entry in a command menu, from either source: a spec (see `commands/specPalette.ts`) or a
 * plugin story action, whose id is a namespaced string rather than a member of any union.
 */
export type PaletteActionCommand = {
    id: string;
    group: StoryCommandGroupId;
    label: string;
    detail: string;
    icon: typeof Settings2;
    nlrCapability?: string;
    /** Slash spellings that jump straight to this command, e.g. "//" → Note. */
    aliases?: string[];
};

/**
 * Project a plugin story action registration onto the palette command shape.
 *
 * Plugin actions file under 工具 (§4.1): they are tools, and a "plugin" category would have been a
 * ninth cut by *origin* rather than by subject - exactly the mixed-criteria problem 13→8 removed.
 * The Puzzle icon keeps them recognisable inside that group.
 */
export function pluginActionToPaletteCommand(registration: {
    id: string;
    label: string;
    detail?: string;
}): PaletteActionCommand {
    return {
        id: registration.id,
        group: "utils",
        label: registration.label,
        detail: registration.detail ?? translate("story.pluginActionFallbackDetail"),
        icon: Puzzle,
    };
}

// Command-name matching for both the inline "/" creator and the sidebar palette lives in
// `storyCommandSearch.ts` (`searchActionCommands`), which bridges the grammar's short tokens (`/bg`,
// `/show`) that a palette command's own fields never carry, and ranks fuzzy hits. Keeping it there,
// not here, avoids storyActionCommands depending on the grammar and keeps the two menus single-source.

export function createBlockForCommand(commandId: ActionCommandId, generateId: () => string, initialText = "", characterId?: string): StoryBlock {
    const blockId = generateId();
    const textId = generateId();
    const base = { id: blockId, parentId: null, childrenIds: [] };

    switch (commandId) {
        case "dialogue":
            return { ...base, kind: "nodeAction", payload: { action: "dialogue", characterId, text: { textId, role: "dialogue", value: initialText } } };
        case "choice":
            return { ...base, kind: "nodeAction", payload: { action: "choice", prompt: { textId, role: "choicePrompt", value: initialText } } };
        case "choiceOption":
            return { ...base, kind: "nodeAction", payload: { action: "choiceOption", text: { textId, role: "choiceText", value: initialText } } };
        case "condition":
            return { ...base, kind: "control", payload: { control: "condition" } };
        case "conditionBranch":
            return { ...base, kind: "control", payload: { control: "conditionBranch", branch: "if" } };
        case "repeat":
            return { ...base, kind: "control", payload: { control: "repeat", times: 2 } };
        case "parallel":
            return { ...base, kind: "control", payload: { control: "parallel", mode: "all" } };
        case "race":
            return { ...base, kind: "control", payload: { control: "race", mode: "any" } };
        case "sequence":
            return { ...base, kind: "control", payload: { control: "sequence", mode: "do" } };
        case "background":
            return { ...base, kind: "action", payload: { action: "setBackground" } };
        case "characterEnter":
            return { ...base, kind: "action", payload: { action: "character", operation: "enter", transform: { preset: "center", durationMs: 300 } } };
        case "characterMove":
            return { ...base, kind: "action", payload: { action: "character", operation: "move", transform: { preset: "center", durationMs: 300 } } };
        case "characterExit":
            return { ...base, kind: "action", payload: { action: "character", operation: "exit", transform: { preset: "fadeOut", durationMs: 250 } } };
        case "characterExpression":
            return { ...base, kind: "action", payload: { action: "character", operation: "expression" } };
        case "bgm":
            return { ...base, kind: "action", payload: { action: "audio", operation: "setBgm" } };
        case "sound":
            return { ...base, kind: "action", payload: { action: "audio", operation: "playSound", objectName: "sound" } };
        case "stopSound":
            return { ...base, kind: "action", payload: { action: "audio", operation: "stopSound", objectName: "sound" } };
        case "pauseSound":
            return { ...base, kind: "action", payload: { action: "audio", operation: "pauseSound", objectName: "sound" } };
        case "resumeSound":
            return { ...base, kind: "action", payload: { action: "audio", operation: "resumeSound", objectName: "sound" } };
        case "soundVolume":
            return { ...base, kind: "action", payload: { action: "audio", operation: "setVolume", objectName: "sound", volume: 0.8, fadeMs: 250 } };
        case "soundRate":
            return { ...base, kind: "action", payload: { action: "audio", operation: "setRate", objectName: "sound", rate: 1 } };
        case "muteSound":
            return { ...base, kind: "action", payload: { action: "audio", operation: "muteSound", objectName: "sound", muted: true } };
        case "seekSound":
            return { ...base, kind: "action", payload: { action: "audio", operation: "seekSound", objectName: "sound", timeMs: 0 } };
        // The four assignment sugars build the same block `/set` does - they differ only in the
        // expression `applyCommandArgs` writes onto it, so they must not diverge here.
        case "setVariable":
        case "incrementVariable":
        case "decrementVariable":
        case "toggleVariable":
        case "resetVariable":
            return { ...base, kind: "action", payload: { action: "setVariable", target: { scope: "scene", variableId: "" }, value: initialText || true } };
        // v6: a declaration IS a row - the block id doubles as the variable id and storage key.
        case "declareSceneVariable":
            return { ...base, kind: "declaration", payload: { scope: "scene", name: "variable", valueType: "boolean", storageKey: blockId } };
        case "declareSavedVariable":
            return { ...base, kind: "declaration", payload: { scope: "saved", name: "variable", valueType: "boolean", storageKey: blockId } };
        case "declarePersistentVariable":
            return { ...base, kind: "declaration", payload: { scope: "persistent", name: "variable", valueType: "boolean", storageKey: blockId } };
        case "executeScript":
            return { ...base, kind: "action", payload: { action: "blueprint", blueprintId: "" } };
        case "imageCreate":
            return { ...base, kind: "action", payload: { action: "image", operation: "create", objectName: "image", transform: { preset: "center" } } };
        case "imageSetSource":
            return { ...base, kind: "action", payload: { action: "image", operation: "setSource", objectName: "image" } };
        case "imageShow":
            return { ...base, kind: "action", payload: { action: "image", operation: "show", objectName: "image", transform: { preset: "fadeIn", durationMs: 250 } } };
        case "imageHide":
            return { ...base, kind: "action", payload: { action: "image", operation: "hide", objectName: "image", transform: { preset: "fadeOut", durationMs: 250 } } };
        case "displayableTransform":
            return { ...base, kind: "action", payload: { action: "displayable", operation: "transform", target: { name: "image" }, transform: { preset: "center", durationMs: 300 } } };
        case "displayableShow":
            return { ...base, kind: "action", payload: { action: "displayable", operation: "show", target: { name: "image" }, transform: { preset: "fadeIn", durationMs: 250 } } };
        case "displayableHide":
            return { ...base, kind: "action", payload: { action: "displayable", operation: "hide", target: { name: "image" }, transform: { preset: "fadeOut", durationMs: 250 } } };
        case "displayableEffect":
            return { ...base, kind: "action", payload: { action: "displayable", operation: "circleReveal", target: { name: "image" }, durationMs: 600 } };
        case "textCreate":
            return { ...base, kind: "action", payload: { action: "text", operation: "create", objectName: "text", text: initialText || "Text", fontSize: 32, fontColor: "#ffffff", transform: { preset: "center" } } };
        case "textSet":
            return { ...base, kind: "action", payload: { action: "text", operation: "setText", objectName: "text", text: initialText || "Text" } };
        case "textShow":
            return { ...base, kind: "action", payload: { action: "text", operation: "show", objectName: "text", transform: { preset: "fadeIn", durationMs: 250 } } };
        case "textHide":
            return { ...base, kind: "action", payload: { action: "text", operation: "hide", objectName: "text", transform: { preset: "fadeOut", durationMs: 250 } } };
        case "textFont":
            return { ...base, kind: "action", payload: { action: "text", operation: "setFontSize", objectName: "text", fontSize: 32 } };
        case "layerCreate":
            return { ...base, kind: "action", payload: { action: "layer", operation: "create", objectName: "layer", zIndex: 1 } };
        case "layerZIndex":
            return { ...base, kind: "action", payload: { action: "layer", operation: "setZIndex", objectName: "", target: { kind: "default", layer: "displayable" }, zIndex: 1 } };
        case "videoCreate":
            return { ...base, kind: "action", payload: { action: "video", operation: "create", objectName: "video", muted: false } };
        case "videoShow":
            return { ...base, kind: "action", payload: { action: "video", operation: "show", objectName: "video" } };
        case "videoHide":
            return { ...base, kind: "action", payload: { action: "video", operation: "hide", objectName: "video" } };
        case "videoPlay":
            return { ...base, kind: "action", payload: { action: "video", operation: "play", objectName: "video" } };
        case "nvl":
            return { ...base, kind: "action", payload: { action: "nvl", transition: { preset: "fadeIn", durationMs: 250 } } };
        case "screenBlink":
            return { ...base, kind: "action", payload: { action: "screenEffect", effect: "blink", durationMs: 180, holdMs: 100, easing: "easeInOut", color: "#000000" } };
        case "screenVignette":
            return { ...base, kind: "action", payload: { action: "screenEffect", effect: "vignette", durationMs: 300, holdMs: 600, easing: "easeInOut", color: "#000000", opacity: 0.72 } };
        case "jump":
            return { ...base, kind: "jump", payload: { targetSceneId: "" } };
        case "waitDuration":
            return { ...base, kind: "action", payload: { action: "wait", mode: "duration", durationMs: 1000 } };
        case "waitClick":
            return { ...base, kind: "action", payload: { action: "wait", mode: "click" } };
        case "note":
            return { ...base, kind: "note", payload: { text: { textId, role: "note", value: initialText } } };
        case "narration":
        default:
            return { ...base, kind: "nodeAction", payload: { action: "narration", text: { textId, role: "narration", value: initialText } } };
    }
}


