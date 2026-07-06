import {
    Clock,
    Database,
    Eye,
    EyeOff,
    FileText,
    Image,
    Layers,
    MessageSquare,
    MonitorPlay,
    Move,
    Music,
    Palette,
    Puzzle,
    Route,
    Settings2,
    Sparkles,
    StickyNote,
    Type,
    UserRound,
    Variable,
    Video,
    Volume2,
} from "lucide-react";
import type { StoryBlock } from "@shared/types/story";

export type ActionCommandId =
    | "narration"
    | "dialogue"
    | "choice"
    | "choiceOption"
    | "condition"
    | "conditionBranch"
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
    | "setVariable"
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
    | "note"
    | "code";

export type ActionCommandCategoryId =
    | "all"
    | "character"
    | "scene"
    | "control"
    | "image"
    | "text"
    | "layer"
    | "video"
    | "data"
    | "media"
    | "effects"
    | "plugin"
    | "utils";

export type ActionCommandCategory = {
    id: ActionCommandCategoryId;
    label: string;
    icon: typeof Settings2;
    iconColor: string;
};

export type ActionCommandGroupCategoryId = Exclude<ActionCommandCategoryId, "all">;

export type ActionCommand = {
    id: ActionCommandId;
    category: ActionCommandGroupCategoryId;
    label: string;
    detail: string;
    icon: typeof Settings2;
    nlrCapability?: string;
    status?: "ready" | "comingSoon";
    /** Slash aliases that jump straight to this command, e.g. "//" → Note. */
    aliases?: string[];
};

export const ACTION_COMMAND_CATEGORIES: ActionCommandCategory[] = [
    { id: "all", label: "All", icon: Settings2, iconColor: "#a8adb5" },
    { id: "character", label: "Character", icon: UserRound, iconColor: "var(--narraleaf-accent, #40a8c4)" },
    { id: "scene", label: "Scene", icon: MonitorPlay, iconColor: "#8fa9c7" },
    { id: "control", label: "Control", icon: Settings2, iconColor: "#b2a6c9" },
    { id: "image", label: "Image", icon: Image, iconColor: "#96b8a0" },
    { id: "text", label: "Text", icon: Type, iconColor: "#9bb7d8" },
    { id: "layer", label: "Layer", icon: Layers, iconColor: "#92b9b0" },
    { id: "video", label: "Video", icon: Video, iconColor: "#b59dcc" },
    { id: "data", label: "Data", icon: Database, iconColor: "#b8aa86" },
    { id: "media", label: "Media", icon: Music, iconColor: "#bd97a3" },
    { id: "effects", label: "Effects", icon: Sparkles, iconColor: "#d1a176" },
    { id: "plugin", label: "Plugin", icon: Puzzle, iconColor: "#9aa3ad" },
    { id: "utils", label: "Utils", icon: StickyNote, iconColor: "#a8adb5" },
];

export const ACTION_COMMANDS: ActionCommand[] = [
    { id: "dialogue", category: "character", label: "Dialogue", detail: "Character.say line", icon: MessageSquare, nlrCapability: "Character.say" },
    { id: "narration", category: "character", label: "Narration", detail: "Narrator.say line", icon: FileText, nlrCapability: "Narrator.say" },
    { id: "characterEnter", category: "character", label: "Character enter", detail: "Show a character portrait image", icon: UserRound, nlrCapability: "Image.char/show" },
    { id: "characterMove", category: "character", label: "Character move", detail: "Move an existing character image", icon: Move, nlrCapability: "Displayable.pos" },
    { id: "characterExpression", category: "character", label: "Character expression", detail: "Change form, variant, or sprite", icon: UserRound, nlrCapability: "Image.char" },
    { id: "characterExit", category: "character", label: "Character exit", detail: "Hide a character image", icon: EyeOff, nlrCapability: "Displayable.hide" },
    { id: "background", category: "scene", label: "Background", detail: "Scene.setBackground asset or color", icon: Image, nlrCapability: "Scene.setBackground" },
    { id: "jump", category: "scene", label: "Jump scene", detail: "Scene.jumpTo another scene", icon: Route, nlrCapability: "Scene.jumpTo" },
    { id: "choice", category: "control", label: "Menu choice", detail: "Menu.prompt choice container", icon: Route, nlrCapability: "Menu.prompt" },
    { id: "choiceOption", category: "control", label: "Menu option", detail: "Menu.choose option", icon: Route, nlrCapability: "Menu.choose" },
    { id: "condition", category: "control", label: "Condition", detail: "Condition.If branch container", icon: Settings2, nlrCapability: "Condition.If" },
    { id: "conditionBranch", category: "control", label: "Condition branch", detail: "If / else-if / else branch", icon: Settings2, nlrCapability: "Condition.ElseIf/Else" },
    { id: "waitDuration", category: "control", label: "Wait duration", detail: "Control.sleep milliseconds", icon: Clock, nlrCapability: "Control.sleep" },
    { id: "waitClick", category: "control", label: "Wait click", detail: "Control.waitForClick", icon: Clock, nlrCapability: "Control.waitForClick" },
    { id: "setVariable", category: "data", label: "Set variable", detail: "Scene local or Story persistent value", icon: Variable, nlrCapability: "Persistent.set" },
    { id: "imageCreate", category: "image", label: "Image", detail: "Create or update a named stage image", icon: Image, nlrCapability: "Image" },
    { id: "imageSetSource", category: "image", label: "Image source", detail: "Change a named image source", icon: Image, nlrCapability: "Image.char" },
    { id: "imageShow", category: "image", label: "Image show", detail: "Show a named image", icon: Eye, nlrCapability: "Displayable.show" },
    { id: "imageHide", category: "image", label: "Image hide", detail: "Hide a named image", icon: EyeOff, nlrCapability: "Displayable.hide" },
    { id: "displayableTransform", category: "image", label: "Transform displayable", detail: "Move, scale, rotate, opacity, or effect preset", icon: Move, nlrCapability: "Displayable.transform" },
    { id: "displayableShow", category: "image", label: "Displayable show", detail: "Show any named displayable", icon: Eye, nlrCapability: "Displayable.show" },
    { id: "displayableHide", category: "image", label: "Displayable hide", detail: "Hide any named displayable", icon: EyeOff, nlrCapability: "Displayable.hide" },
    { id: "displayableEffect", category: "effects", label: "Displayable effect", detail: "Mask, filter, clip, darken, circle reveal/close, or wipe", icon: Sparkles, nlrCapability: "Displayable.mask/filter/wipe" },
    { id: "textCreate", category: "text", label: "Text", detail: "Create or update named stage text", icon: Type, nlrCapability: "Text" },
    { id: "textSet", category: "text", label: "Set text", detail: "Change a named text overlay", icon: Type, nlrCapability: "Text.setText" },
    { id: "textShow", category: "text", label: "Text show", detail: "Show text overlay", icon: Eye, nlrCapability: "Text.show" },
    { id: "textHide", category: "text", label: "Text hide", detail: "Hide text overlay", icon: EyeOff, nlrCapability: "Text.hide" },
    { id: "textFont", category: "text", label: "Text style", detail: "Set font size or color", icon: Palette, nlrCapability: "Text.setFontSize/setFontColor" },
    { id: "layerCreate", category: "layer", label: "Layer", detail: "Create a named render layer", icon: Layers, nlrCapability: "Layer" },
    { id: "layerZIndex", category: "layer", label: "Layer z-index", detail: "Change layer ordering", icon: Layers, nlrCapability: "Layer.setZIndex" },
    { id: "videoCreate", category: "video", label: "Video", detail: "Create a named video element", icon: Video, nlrCapability: "Video" },
    { id: "videoShow", category: "video", label: "Video show", detail: "Show a video element", icon: Eye, nlrCapability: "Video.show" },
    { id: "videoHide", category: "video", label: "Video hide", detail: "Hide a video element", icon: EyeOff, nlrCapability: "Video.hide" },
    { id: "videoPlay", category: "video", label: "Video play", detail: "Play a video element", icon: Video, nlrCapability: "Video.play" },
    { id: "nvl", category: "scene", label: "NVL block", detail: "Scene.nvl stacked dialog block", icon: FileText, nlrCapability: "Scene.nvl" },
    { id: "screenBlink", category: "effects", label: "Blink", detail: "Built-in screen blink effect", icon: Sparkles, nlrCapability: "built-in.blink" },
    { id: "screenVignette", category: "effects", label: "Vignette", detail: "Built-in vignette effect", icon: Sparkles, nlrCapability: "built-in.vignette" },
    { id: "bgm", category: "media", label: "BGM", detail: "Scene.setBackgroundMusic", icon: Music, nlrCapability: "Scene.setBackgroundMusic" },
    { id: "sound", category: "media", label: "Sound", detail: "Play sound effect", icon: Music, nlrCapability: "Sound.play" },
    { id: "stopSound", category: "media", label: "Stop sound", detail: "Stop sound effect", icon: Music, nlrCapability: "Sound.stop" },
    { id: "pauseSound", category: "media", label: "Pause sound", detail: "Pause sound effect", icon: Music, nlrCapability: "Sound.pause" },
    { id: "resumeSound", category: "media", label: "Resume sound", detail: "Resume sound effect", icon: Music, nlrCapability: "Sound.resume" },
    { id: "soundVolume", category: "media", label: "Sound volume", detail: "Set sound volume", icon: Volume2, nlrCapability: "Sound.setVolume" },
    { id: "soundRate", category: "media", label: "Sound rate", detail: "Set playback rate", icon: Volume2, nlrCapability: "Sound.setRate" },
    { id: "muteSound", category: "media", label: "Mute sound", detail: "Mute or unmute sound", icon: Volume2, nlrCapability: "Sound.mute" },
    { id: "note", category: "utils", label: "Note", detail: "Studio-only note", icon: StickyNote, aliases: ["//"] },
];

/**
 * Shared match used by both the inline "/" creator and the sidebar action palette.
 *
 * A query that begins with "/" means the author is typing a slash alias (e.g. "//" for Note). In the
 * inline creator the leading "/" is consumed as the action trigger, so the alias arrives here as "/";
 * in the sidebar search box it arrives as "//". Either way we match aliases exclusively so the alias
 * lands directly on its command instead of every action whose label/detail happens to contain "/".
 */
export function actionCommandMatchesQuery(command: ActionCommand, rawQuery: string): boolean {
    const query = rawQuery.trim().toLowerCase();
    if (!query) {
        return true;
    }
    if (query.startsWith("/")) {
        return (command.aliases ?? []).some(alias => {
            const normalized = alias.toLowerCase();
            return normalized.startsWith(query) || query.startsWith(normalized);
        });
    }
    return command.label.toLowerCase().includes(query) ||
        command.id.toLowerCase().includes(query) ||
        command.detail.toLowerCase().includes(query) ||
        Boolean(command.nlrCapability?.toLowerCase().includes(query)) ||
        (command.aliases ?? []).some(alias => alias.toLowerCase().includes(query));
}

export function getActionCommandCategory(categoryId: ActionCommandCategoryId): ActionCommandCategory {
    return ACTION_COMMAND_CATEGORIES.find(category => category.id === categoryId) ?? ACTION_COMMAND_CATEGORIES[0];
}

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
        case "setVariable":
            return { ...base, kind: "action", payload: { action: "setVariable", target: { scope: "scene", variableId: "" }, value: initialText || true } };
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
            return { ...base, kind: "action", payload: { action: "layer", operation: "setZIndex", objectName: "layer", zIndex: 1 } };
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
        case "code":
            return { ...base, kind: "code", payload: { language: "narraleaf", source: initialText, advanced: true, folded: false } };
        case "narration":
        default:
            return { ...base, kind: "nodeAction", payload: { action: "narration", text: { textId, role: "narration", value: initialText } } };
    }
}

export function isInspectorFirstCommand(commandId: ActionCommandId): boolean {
    return !["narration", "dialogue", "note", "choiceOption"].includes(commandId);
}
