import { Code, FileText, MessageSquare, Music, Route, Settings2, StickyNote, UserRound, Variable } from "lucide-react";
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
    | "text"
    | "flow"
    | "stage"
    | "audio"
    | "state"
    | "tools";

export type ActionCommandCategory = {
    id: ActionCommandCategoryId;
    label: string;
};

export type ActionCommand = {
    id: ActionCommandId;
    category: ActionCommandCategoryId;
    label: string;
    detail: string;
    icon: typeof Settings2;
};

export const ACTION_COMMAND_CATEGORIES: ActionCommandCategory[] = [
    { id: "text", label: "Text" },
    { id: "flow", label: "Flow" },
    { id: "stage", label: "Stage" },
    { id: "audio", label: "Audio" },
    { id: "state", label: "State" },
    { id: "tools", label: "Tools" },
];

export const ACTION_COMMANDS: ActionCommand[] = [
    { id: "narration", category: "text", label: "Narration", detail: "Create a text narration row", icon: FileText },
    { id: "dialogue", category: "text", label: "Dialogue", detail: "Create a character dialogue row", icon: MessageSquare },
    { id: "choice", category: "flow", label: "Choice", detail: "Create a choice container", icon: Route },
    { id: "choiceOption", category: "flow", label: "Choice option", detail: "Create an option inside a choice", icon: Route },
    { id: "condition", category: "flow", label: "Condition", detail: "Create a condition container", icon: Settings2 },
    { id: "conditionBranch", category: "flow", label: "Condition branch", detail: "Create an if / else branch", icon: Settings2 },
    { id: "background", category: "stage", label: "Background", detail: "Set background asset or color", icon: FileText },
    { id: "characterEnter", category: "stage", label: "Character enter", detail: "Show a character on stage", icon: UserRound },
    { id: "characterMove", category: "stage", label: "Character move", detail: "Move an existing character", icon: UserRound },
    { id: "characterExit", category: "stage", label: "Character exit", detail: "Remove a character from stage", icon: UserRound },
    { id: "characterExpression", category: "stage", label: "Character expression", detail: "Change expression or sprite", icon: UserRound },
    { id: "bgm", category: "audio", label: "BGM", detail: "Set background music", icon: Music },
    { id: "sound", category: "audio", label: "Sound", detail: "Play sound effect", icon: Music },
    { id: "stopSound", category: "audio", label: "Stop sound", detail: "Stop sound effect", icon: Music },
    { id: "setVariable", category: "state", label: "Set variable", detail: "Write a variable value", icon: Variable },
    { id: "jump", category: "flow", label: "Jump scene", detail: "Transition to another scene", icon: Route },
    { id: "waitDuration", category: "tools", label: "Wait duration", detail: "Pause for milliseconds", icon: Settings2 },
    { id: "waitClick", category: "tools", label: "Wait click", detail: "Wait for player input", icon: Settings2 },
    { id: "note", category: "tools", label: "Note", detail: "Studio-only note", icon: StickyNote },
    { id: "code", category: "tools", label: "Code block", detail: "Advanced escape hatch", icon: Code },
];

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
