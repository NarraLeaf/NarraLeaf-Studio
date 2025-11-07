// Module system types
export type {
    ModuleMetadata,
    ModuleAction,
    ModuleActionGroup,
    ModuleKeybinding,
    PanelComponentProps,
    PanelModule,
    EditorComponentProps,
    EditorModule,
    ModuleRegistration,
} from "./types";

// Built-in modules registry
export {
    builtInPanels,
    builtInEditors,
    builtInActions,
    builtInActionGroups,
    assetsModule,
    propertiesModule,
    consoleModule,
    welcomeModule,
    globalActions,
    globalActionGroups,
} from "./registry";

