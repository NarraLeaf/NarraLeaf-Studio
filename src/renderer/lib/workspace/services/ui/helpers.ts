import { ReactNode, ComponentType } from "react";
import { 
    EditorTab, 
    EditorTabComponentProps,
    PanelDefinition,
    PanelComponentProps,
    PanelPosition,
    Keybinding,
    FocusArea,
} from "./types";

/**
 * Helper: Create a type-safe editor tab definition
 * 
 * @example
 * ```ts
 * interface FileEditorPayload {
 *   filePath: string;
 *   content: string;
 * }
 * 
 * const tab = createEditorTab<FileEditorPayload>({
 *   id: "file-editor:main.ts",
 *   title: "main.ts",
 *   component: FileEditor,
 *   payload: { filePath: "/src/main.ts", content: "..." }
 * });
 * ```
 */
export function createEditorTab<TPayload = any>(
    config: Omit<EditorTab<TPayload>, 'closable'> & { closable?: boolean }
): EditorTab<TPayload> {
    return {
        closable: true,
        ...config,
    };
}

/**
 * Helper: Create a type-safe panel definition
 * 
 * @example
 * ```ts
 * interface ProjectPanelPayload {
 *   projectPath: string;
 * }
 * 
 * const panel = createPanel<ProjectPanelPayload>({
 *   id: "project-explorer",
 *   title: "Project",
 *   icon: <FolderIcon />,
 *   position: PanelPosition.Left,
 *   component: ProjectExplorer,
 *   payload: { projectPath: "/path/to/project" }
 * });
 * ```
 */
export function createPanel<TPayload = any>(
    config: PanelDefinition<TPayload>
): PanelDefinition<TPayload> {
    return config;
}

/**
 * Helper: Create a keybinding with type safety
 * 
 * @example
 * ```ts
 * const saveBinding = createKeybinding({
 *   id: "save-file",
 *   key: "ctrl+s",
 *   description: "Save current file",
 *   handler: async (context) => {
 *     if (context.area === FocusArea.Editor) {
 *       // Save logic
 *     }
 *   },
 *   when: (context) => context.area === FocusArea.Editor
 * });
 * ```
 */
export function createKeybinding(config: Keybinding): Keybinding {
    return config;
}

/**
 * Helper: Create multiple keybindings at once
 * 
 * @example
 * ```ts
 * const bindings = createKeybindings([
 *   { id: "save", key: "ctrl+s", handler: save },
 *   { id: "open", key: "ctrl+o", handler: open },
 * ]);
 * ```
 */
export function createKeybindings(configs: Keybinding[]): Keybinding[] {
    return configs;
}

/**
 * Helper: Parse a keybinding string
 * 
 * @example
 * ```ts
 * parseKey("ctrl+shift+s") // { ctrl: true, shift: true, key: "s" }
 * ```
 */
export function parseKey(binding: string): {
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    meta: boolean;
    key: string;
} {
    const parts = binding.toLowerCase().split("+");
    const result = {
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        key: "",
    };

    for (const part of parts) {
        switch (part) {
            case "ctrl":
            case "control":
                result.ctrl = true;
                break;
            case "alt":
            case "option":
                result.alt = true;
                break;
            case "shift":
                result.shift = true;
                break;
            case "cmd":
            case "meta":
            case "super":
                result.meta = true;
                break;
            default:
                result.key = part;
        }
    }

    return result;
}

/**
 * Helper: Create a unique ID for editor tabs
 */
export function createEditorTabId(prefix: string, identifier: string): string {
    return `${prefix}:${identifier}`;
}

/**
 * Helper: Create a unique ID for panels
 */
export function createPanelId(prefix: string, name: string): string {
    return `${prefix}:${name}`;
}

/**
 * Type guard: Check if a value is a valid EditorTab
 */
export function isEditorTab(value: any): value is EditorTab {
    return (
        value &&
        typeof value === "object" &&
        typeof value.id === "string" &&
        typeof value.title === "string" &&
        typeof value.component === "function"
    );
}

/**
 * Type guard: Check if a value is a valid PanelDefinition
 */
export function isPanelDefinition(value: any): value is PanelDefinition {
    return (
        value &&
        typeof value === "object" &&
        typeof value.id === "string" &&
        typeof value.title === "string" &&
        typeof value.component === "function" &&
        Object.values(PanelPosition).includes(value.position)
    );
}

