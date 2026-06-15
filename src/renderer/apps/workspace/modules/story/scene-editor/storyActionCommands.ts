import { Database, FileText, Image, MessageSquare, MonitorPlay, Music, Puzzle, Route, Settings2, StickyNote, UserRound, Variable } from "lucide-react";
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
    | "setVariable"
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
    | "data"
    | "media"
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
};

export const ACTION_COMMAND_CATEGORIES: ActionCommandCategory[] = [
    { id: "all", label: "All", icon: Settings2, iconColor: "#a8adb5" },
    { id: "character", label: "Character", icon: UserRound, iconColor: "var(--narraleaf-accent, #40a8c4)" },
    { id: "scene", label: "Scene", icon: MonitorPlay, iconColor: "#8fa9c7" },
    { id: "control", label: "Control", icon: Settings2, iconColor: "#b2a6c9" },
    { id: "image", label: "Image", icon: Image, iconColor: "#96b8a0" },
    { id: "data", label: "Data", icon: Database, iconColor: "#b8aa86" },
    { id: "media", label: "Media", icon: Music, iconColor: "#bd97a3" },
    { id: "plugin", label: "Plugin", icon: Puzzle, iconColor: "#9aa3ad" },
    { id: "utils", label: "Utils", icon: StickyNote, iconColor: "#a8adb5" },
];

export const ACTION_COMMANDS: ActionCommand[] = [
    { id: "dialogue", category: "character", label: "Dialogue", detail: "Create a character dialogue row", icon: MessageSquare },
    { id: "narration", category: "character", label: "Narration", detail: "Create a narration row", icon: FileText },
    { id: "characterEnter", category: "character", label: "Character enter", detail: "Show a character on stage", icon: UserRound },
    { id: "characterMove", category: "character", label: "Character move", detail: "Move an existing character", icon: UserRound },
    { id: "characterExpression", category: "character", label: "Character expression", detail: "Change expression or sprite", icon: UserRound },
    { id: "characterExit", category: "character", label: "Character exit", detail: "Remove a character from stage", icon: UserRound },
    { id: "background", category: "scene", label: "Background", detail: "Set scene background asset or color", icon: Image },
    { id: "jump", category: "scene", label: "Jump scene", detail: "Transition to another scene", icon: Route },
    { id: "choice", category: "control", label: "Menu choice", detail: "Create a choice menu container", icon: Route },
    { id: "choiceOption", category: "control", label: "Menu option", detail: "Create an option inside a choice", icon: Route },
    { id: "condition", category: "control", label: "Condition", detail: "Create a condition container", icon: Settings2 },
    { id: "conditionBranch", category: "control", label: "Condition branch", detail: "Create an if / else branch", icon: Settings2 },
    { id: "waitDuration", category: "control", label: "Wait duration", detail: "Pause for milliseconds", icon: Settings2 },
    { id: "waitClick", category: "control", label: "Wait click", detail: "Wait for player input", icon: Settings2 },
    { id: "setVariable", category: "data", label: "Set variable", detail: "Write scene, global, or persistent data", icon: Variable },
    { id: "bgm", category: "media", label: "BGM", detail: "Set background music", icon: Music },
    { id: "sound", category: "media", label: "Sound", detail: "Play sound effect", icon: Music },
    { id: "stopSound", category: "media", label: "Stop sound", detail: "Stop sound effect", icon: Music },
    { id: "note", category: "utils", label: "Note", detail: "Studio-only note", icon: StickyNote },
];

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
            return { ...base, kind: "action", payload: { action: "character", operation: "enter" } };
        case "characterMove":
            return { ...base, kind: "action", payload: { action: "character", operation: "move" } };
        case "characterExit":
            return { ...base, kind: "action", payload: { action: "character", operation: "exit" } };
        case "characterExpression":
            return { ...base, kind: "action", payload: { action: "character", operation: "expression" } };
        case "bgm":
            return { ...base, kind: "action", payload: { action: "audio", operation: "setBgm" } };
        case "sound":
            return { ...base, kind: "action", payload: { action: "audio", operation: "playSound" } };
        case "stopSound":
            return { ...base, kind: "action", payload: { action: "audio", operation: "stopSound" } };
        case "setVariable":
            return { ...base, kind: "action", payload: { action: "setVariable", target: { scope: "sceneLocal", key: "variable" }, value: initialText || true } };
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
