// Module loader hook
export { useModuleLoader } from "./useModuleLoader";
export { useWorkspacePlugins } from "./useWorkspacePlugins";

// Editor layout preferences
export { useMaxActiveEditors } from "./useMaxActiveEditors";

// Current project display name
export { useProjectDisplayName } from "./useProjectDisplayName";

// UI Service hooks
export {
    useUIService,
    useNotifications,
    useActionBarItems,
    usePanels,
    usePanelVisibility,
    useEditorTabs,
    useActiveEditorTab,
    useDialogs,
    useStatusBarItems,
} from "./useUIService";

// Focus management hooks
export { useFocus, useIsFocused, type UseFocusResult } from "./useFocus";

// Keybinding hooks and utilities
export {
    // Hooks
    useKeybinding,
    useKeybindings,
    useKeybindingRegistry,
    // Types
    type UseKeybindingOptions,
    type UseKeybindingsOptions,
    type KeybindingDefinition,
    type KeybindingCondition,
    // Condition utilities
    whenFocused,
    whenTargetFocused,
    whenEditorFocused,
    whenEditorTabsFocused,
    whenNoDialog,
    whenNotIn,
    always,
    never,
    and,
    or,
    not,
    fromGetter,
    contextual,
} from "./keybinding";
