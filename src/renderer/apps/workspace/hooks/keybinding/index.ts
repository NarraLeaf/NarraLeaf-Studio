// Keybinding hooks
export {
    useKeybinding,
    useKeybindings,
    useKeybindingRegistry,
    type UseKeybindingOptions,
    type UseKeybindingsOptions,
    type KeybindingDefinition,
} from "./useKeybinding";

// Condition utilities
export {
    // Types
    type KeybindingCondition,
    // Focus conditions
    whenFocused,
    whenTargetFocused,
    whenEditorFocused,
    whenEditorTabsFocused,
    whenNoDialog,
    whenNotIn,
    // Constant conditions
    always,
    never,
    // Combinators
    and,
    or,
    not,
    // Dynamic conditions
    fromGetter,
    contextual,
} from "./conditions";

